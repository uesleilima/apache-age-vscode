import * as fs from 'fs';
import { Pool, PoolClient, PoolConfig as PgPoolConfig, types } from 'pg';
import {
  ConnectionCredentials,
  PoolConfig,
  DEFAULT_POOL_CONFIG,
  SslMode,
} from './ConnectionConfig';
import { deserializeAgtype } from '../parser/AgtypeDeserializer';
import { createProxyClientClass } from './ProxyConnector';

/**
 * Wraps a pg.Pool with Apache AGE–specific initialization.
 *
 * On every client acquisition:
 * 1. Ensures the `age` extension is loaded
 * 2. Sets the search_path to include ag_catalog
 * 3. Registers a custom type parser for agtype so results are auto-deserialized
 *
 * This mirrors the setAGETypes() pattern from AGE Viewer's AGEParser.js.
 */
export class ConnectionPool {
  private pool: Pool | null = null;
  private serverVersion: string | null = null;
  private agtypeOid: number | null = null;

  constructor(
    private readonly credentials: ConnectionCredentials,
    private readonly poolConfig: PoolConfig = DEFAULT_POOL_CONFIG,
  ) {}

  /**
   * Lazily create the underlying pg.Pool and perform initial connection test.
   */
  async connect(): Promise<void> {
    if (this.pool) return;

    const pgConfig: PgPoolConfig = {
      host: this.credentials.host,
      port: this.credentials.port,
      database: this.credentials.database,
      user: this.credentials.user,
      password: this.credentials.password,
      max: this.poolConfig.max,
      idleTimeoutMillis: this.poolConfig.idleTimeoutMillis,
      connectionTimeoutMillis: this.poolConfig.connectionTimeoutMillis,
      ssl: this.buildSslConfig(),
    };

    if (this.credentials.proxyUrl) {
      (pgConfig as any).Client = createProxyClientClass(this.credentials.proxyUrl);
    }

    this.pool = new Pool(pgConfig);

    // Test the connection and discover server version + agtype OID
    const client = await this.pool.connect();
    try {
      await this.initializeAge(client);
      const versionResult = await client.query('SHOW server_version');
      this.serverVersion = versionResult.rows[0].server_version;
    } finally {
      client.release();
    }
  }

  /**
   * Get a client from the pool with AGE types already configured.
   */
  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error('Connection pool not initialized. Call connect() first.');
    }

    const client = await this.pool.connect();
    await this.initializeAge(client);
    return client;
  }

  /**
   * Execute a query using a pooled client. Handles acquire/release automatically.
   */
  async query(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; fields: { name: string }[]; rowCount: number; command: string }> {
    const client = await this.getClient();
    try {
      const result = await client.query(sql, params);
      return {
        rows: result.rows ?? [],
        fields: result.fields ?? [],
        rowCount: result.rowCount ?? 0,
        command: result.command ?? '',
      };
    } finally {
      client.release();
    }
  }

  /**
   * Build the SSL config object for pg.Pool from the credentials' sslMode.
   */
  private buildSslConfig(): boolean | { rejectUnauthorized: boolean; ca?: string } {
    const mode: SslMode | undefined = this.credentials.sslMode;
    if (!mode || mode === 'disable') {
      return false;
    }
    if (mode === 'require') {
      return { rejectUnauthorized: false };
    }
    // verify-ca and verify-full both require certificate validation.
    // pg driver verifies hostname automatically when rejectUnauthorized is true.
    const config: { rejectUnauthorized: boolean; ca?: string } = { rejectUnauthorized: true };
    if (this.credentials.sslCaCertPath) {
      config.ca = fs.readFileSync(this.credentials.sslCaCertPath, 'utf-8');
    }
    return config;
  }

  /**
   * Initialize AGE extension and register agtype parser on a client.
   *
   * In managed server mode (e.g. Azure), only SET search_path is executed
   * since the AGE extension is pre-loaded by the server.
   */
  private async initializeAge(client: PoolClient): Promise<void> {
    if (this.credentials.managedServer) {
      await client.query('SET search_path = ag_catalog, "$user", public;');
    } else {
      await client.query(`
        CREATE EXTENSION IF NOT EXISTS age;
        LOAD 'age';
        SET search_path = ag_catalog, "$user", public;
      `);
    }

    // Discover the agtype OID if we haven't yet
    if (this.agtypeOid === null) {
      const oidResult = await client.query(
        "SELECT typelem FROM pg_type WHERE typname = '_agtype'"
      );
      if (oidResult.rows.length > 0) {
        this.agtypeOid = oidResult.rows[0].typelem;
      }
    }

    // Register the custom type parser for agtype
    if (this.agtypeOid !== null) {
      types.setTypeParser(this.agtypeOid, deserializeAgtype);
    }
  }

  /**
   * Close the pool and release all connections.
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.serverVersion = null;
      this.agtypeOid = null;
    }
  }

  get isConnected(): boolean {
    return this.pool !== null;
  }

  get version(): string | null {
    return this.serverVersion;
  }

  /**
   * PostgreSQL major version number (e.g. 14, 15, 16).
   */
  get majorVersion(): number {
    if (!this.serverVersion) return 0;
    return parseInt(this.serverVersion.split('.')[0], 10);
  }
}
