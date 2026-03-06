import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionPool } from '../../src/core/connection/ConnectionPool';
import { ConnectionCredentials } from '../../src/core/connection/ConnectionConfig';

// Mock the pg module
vi.mock('pg', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };

  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    end: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Pool: vi.fn(() => mockPool),
    Client: vi.fn(),
    types: {
      setTypeParser: vi.fn(),
    },
    __mockPool: mockPool,
    __mockClient: mockClient,
  };
});

// Mock the ProxyConnector module
vi.mock('../../src/core/connection/ProxyConnector', () => ({
  createProxyClientClass: vi.fn().mockReturnValue(class FakeProxyClient {}),
}));

// Mock fs for SSL cert reading
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue('FAKE-CA-CERT'),
}));

// Access mocks
import { Pool, types, __mockPool, __mockClient } from 'pg';

const TEST_CREDENTIALS: ConnectionCredentials = {
  name: 'test',
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
};

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new ConnectionPool(TEST_CREDENTIALS);

    // Default mock responses for initializeAge flow
    (__mockClient as any).query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('CREATE EXTENSION')) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('pg_type')) {
        return Promise.resolve({ rows: [{ typelem: 10000 }] });
      }
      if (typeof sql === 'string' && sql.includes('SHOW server_version')) {
        return Promise.resolve({ rows: [{ server_version: '15.4' }] });
      }
      return Promise.resolve({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
    });
  });

  describe('connect', () => {
    it('should create a pool and test connection', async () => {
      await pool.connect();
      expect(Pool).toHaveBeenCalledOnce();
      expect(pool.isConnected).toBe(true);
    });

    it('should discover server version on connect', async () => {
      await pool.connect();
      expect(pool.version).toBe('15.4');
    });

    it('should compute major version correctly', async () => {
      await pool.connect();
      expect(pool.majorVersion).toBe(15);
    });

    it('should initialize AGE extension on connect', async () => {
      await pool.connect();
      const calls = (__mockClient as any).query.mock.calls;
      const initCall = calls.find((c: string[]) => typeof c[0] === 'string' && c[0].includes('CREATE EXTENSION'));
      expect(initCall).toBeDefined();
    });

    it('should register agtype type parser on connect', async () => {
      await pool.connect();
      expect(types.setTypeParser).toHaveBeenCalledWith(10000, expect.any(Function));
    });

    it('should be a no-op if already connected', async () => {
      await pool.connect();
      await pool.connect();
      expect(Pool).toHaveBeenCalledOnce();
    });

    it('should release the test client after connect', async () => {
      await pool.connect();
      expect((__mockClient as any).release).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should close the pool', async () => {
      await pool.connect();
      await pool.disconnect();
      expect(pool.isConnected).toBe(false);
      expect((__mockPool as any).end).toHaveBeenCalled();
    });

    it('should reset version and OID', async () => {
      await pool.connect();
      expect(pool.version).toBe('15.4');
      await pool.disconnect();
      expect(pool.version).toBeNull();
      expect(pool.majorVersion).toBe(0);
    });

    it('should be safe to call when not connected', async () => {
      await pool.disconnect(); // should not throw
      expect(pool.isConnected).toBe(false);
    });
  });

  describe('query', () => {
    it('should execute a query and return results', async () => {
      await pool.connect();

      (__mockClient as any).query.mockImplementation((sql: string) => {
        if (typeof sql === 'string' && sql.includes('CREATE EXTENSION')) {
          return Promise.resolve({ rows: [] });
        }
        if (typeof sql === 'string' && sql.includes('pg_type')) {
          return Promise.resolve({ rows: [{ typelem: 10000 }] });
        }
        return Promise.resolve({
          rows: [{ name: 'Alice' }],
          fields: [{ name: 'name' }],
          rowCount: 1,
          command: 'SELECT',
        });
      });

      const result = await pool.query('SELECT 1');
      expect(result.rows).toEqual([{ name: 'Alice' }]);
      expect(result.rowCount).toBe(1);
      expect(result.command).toBe('SELECT');
    });

    it('should release client after query', async () => {
      await pool.connect();
      vi.clearAllMocks();

      (__mockClient as any).query.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'SELECT',
      });
      (__mockPool as any).connect.mockResolvedValue(__mockClient);

      await pool.query('SELECT 1');
      expect((__mockClient as any).release).toHaveBeenCalled();
    });

    it('should throw if not connected', async () => {
      await expect(pool.query('SELECT 1')).rejects.toThrow('Connection pool not initialized');
    });

    it('should release client even if query throws', async () => {
      await pool.connect();
      vi.clearAllMocks();

      (__mockPool as any).connect.mockResolvedValue(__mockClient);
      // After connect(), agtypeOid is cached so initializeAge only runs the
      // CREATE EXTENSION/LOAD/SET query (no pg_type query).
      (__mockClient as any).query
        .mockResolvedValueOnce({ rows: [] }) // initializeAge (extension load)
        .mockRejectedValueOnce(new Error('query failed'));

      await expect(pool.query('BAD SQL')).rejects.toThrow('query failed');
      expect((__mockClient as any).release).toHaveBeenCalled();
    });
  });

  describe('getClient', () => {
    it('should throw if not connected', async () => {
      await expect(pool.getClient()).rejects.toThrow('Connection pool not initialized');
    });

    it('should initialize AGE on the returned client', async () => {
      await pool.connect();
      vi.clearAllMocks();

      (__mockPool as any).connect.mockResolvedValue(__mockClient);
      (__mockClient as any).query.mockResolvedValue({ rows: [] });

      const client = await pool.getClient();
      expect(client).toBeDefined();
      const calls = (__mockClient as any).query.mock.calls;
      const initCall = calls.find((c: string[]) => typeof c[0] === 'string' && c[0].includes('CREATE EXTENSION'));
      expect(initCall).toBeDefined();
    });
  });

  describe('pool configuration', () => {
    it('should use provided credentials', async () => {
      await pool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.host).toBe('localhost');
      expect(poolConfig.port).toBe(5432);
      expect(poolConfig.database).toBe('testdb');
      expect(poolConfig.user).toBe('testuser');
      expect(poolConfig.password).toBe('testpass');
    });

    it('should use default pool config', async () => {
      await pool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.max).toBe(10);
      expect(poolConfig.idleTimeoutMillis).toBe(30000);
      expect(poolConfig.connectionTimeoutMillis).toBe(2000);
    });

    it('should use custom pool config', async () => {
      const customPool = new ConnectionPool(TEST_CREDENTIALS, {
        max: 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
      });
      await customPool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.max).toBe(5);
    });
  });

  describe('managed server mode', () => {
    it('should only run SET search_path when managedServer is true', async () => {
      const managedPool = new ConnectionPool({ ...TEST_CREDENTIALS, managedServer: true });
      await managedPool.connect();

      const calls = (__mockClient as any).query.mock.calls;
      const setPathCall = calls.find((c: string[]) =>
        typeof c[0] === 'string' && c[0].includes('SET search_path') && !c[0].includes('CREATE EXTENSION'),
      );
      expect(setPathCall).toBeDefined();

      const createExtCall = calls.find((c: string[]) =>
        typeof c[0] === 'string' && c[0].includes('CREATE EXTENSION'),
      );
      expect(createExtCall).toBeUndefined();
    });

    it('should run full init when managedServer is false', async () => {
      const standardPool = new ConnectionPool({ ...TEST_CREDENTIALS, managedServer: false });
      await standardPool.connect();

      const calls = (__mockClient as any).query.mock.calls;
      const createExtCall = calls.find((c: string[]) =>
        typeof c[0] === 'string' && c[0].includes('CREATE EXTENSION'),
      );
      expect(createExtCall).toBeDefined();
    });

    it('should run full init when managedServer is undefined', async () => {
      await pool.connect();

      const calls = (__mockClient as any).query.mock.calls;
      const createExtCall = calls.find((c: string[]) =>
        typeof c[0] === 'string' && c[0].includes('CREATE EXTENSION'),
      );
      expect(createExtCall).toBeDefined();
    });
  });

  describe('SSL configuration', () => {
    it('should set ssl to false when sslMode is disable', async () => {
      const sslPool = new ConnectionPool({ ...TEST_CREDENTIALS, sslMode: 'disable' });
      await sslPool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.ssl).toBe(false);
    });

    it('should set ssl to false when sslMode is undefined', async () => {
      await pool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.ssl).toBe(false);
    });

    it('should set ssl with rejectUnauthorized=false for require mode', async () => {
      const sslPool = new ConnectionPool({ ...TEST_CREDENTIALS, sslMode: 'require' });
      await sslPool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.ssl).toEqual({ rejectUnauthorized: false });
    });

    it('should set ssl with rejectUnauthorized=true and CA cert for verify-ca', async () => {
      const sslPool = new ConnectionPool({
        ...TEST_CREDENTIALS,
        sslMode: 'verify-ca',
        sslCaCertPath: '/path/to/ca.pem',
      });
      await sslPool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.ssl).toEqual({ rejectUnauthorized: true, ca: 'FAKE-CA-CERT' });
    });

    it('should set ssl with rejectUnauthorized=true for verify-full', async () => {
      const sslPool = new ConnectionPool({
        ...TEST_CREDENTIALS,
        sslMode: 'verify-full',
        sslCaCertPath: '/path/to/ca.pem',
      });
      await sslPool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.ssl).toEqual({ rejectUnauthorized: true, ca: 'FAKE-CA-CERT' });
    });
  });

  describe('proxy configuration', () => {
    it('should pass custom Client class when proxyUrl is set', async () => {
      const proxyPool = new ConnectionPool({ ...TEST_CREDENTIALS, proxyUrl: 'http://proxy:8080' });
      await proxyPool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.Client).toBeDefined();
    });

    it('should not set Client when proxyUrl is not set', async () => {
      await pool.connect();
      const poolConfig = (Pool as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(poolConfig.Client).toBeUndefined();
    });
  });
});
