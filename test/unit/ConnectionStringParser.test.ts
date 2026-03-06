import { describe, it, expect } from 'vitest';
import {
  isConnectionString,
  parseConnectionString,
} from '../../src/core/connection/ConnectionStringParser';

describe('ConnectionStringParser', () => {
  describe('isConnectionString', () => {
    it('should return true for postgresql:// prefix', () => {
      expect(isConnectionString('postgresql://localhost/db')).toBe(true);
    });

    it('should return true for postgres:// prefix', () => {
      expect(isConnectionString('postgres://localhost/db')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isConnectionString('POSTGRESQL://HOST/db')).toBe(true);
    });

    it('should trim whitespace', () => {
      expect(isConnectionString('  postgresql://localhost/db  ')).toBe(true);
    });

    it('should return false for non-connection strings', () => {
      expect(isConnectionString('localhost')).toBe(false);
      expect(isConnectionString('http://postgres')).toBe(false);
      expect(isConnectionString('')).toBe(false);
    });
  });

  describe('parseConnectionString', () => {
    it('should parse a full connection URI', () => {
      const result = parseConnectionString('postgresql://admin:secret@db.example.com:5433/mydb');
      expect(result).toEqual({
        host: 'db.example.com',
        port: 5433,
        user: 'admin',
        password: 'secret',
        database: 'mydb',
      });
    });

    it('should accept the postgres:// scheme alias', () => {
      const result = parseConnectionString('postgres://user:pw@host:5432/testdb');
      expect(result.host).toBe('host');
      expect(result.user).toBe('user');
      expect(result.database).toBe('testdb');
    });

    it('should URL-decode username and password', () => {
      const result = parseConnectionString('postgresql://my%40user:p%40ss%23word@localhost/db');
      expect(result.user).toBe('my@user');
      expect(result.password).toBe('p@ss#word');
    });

    it('should default port to 5432 when omitted', () => {
      const result = parseConnectionString('postgresql://user:pw@host/db');
      expect(result.port).toBe(5432);
    });

    it('should handle missing password', () => {
      const result = parseConnectionString('postgresql://user@host/db');
      expect(result.user).toBe('user');
      expect(result.password).toBeUndefined();
    });

    it('should handle missing user and password', () => {
      const result = parseConnectionString('postgresql://host/db');
      expect(result.host).toBe('host');
      expect(result.user).toBeUndefined();
      expect(result.password).toBeUndefined();
    });

    it('should handle missing database', () => {
      const result = parseConnectionString('postgresql://host:5432');
      expect(result.host).toBe('host');
      expect(result.port).toBe(5432);
      expect(result.database).toBeUndefined();
    });

    it('should map sslmode query parameter', () => {
      const result = parseConnectionString('postgresql://host/db?sslmode=require');
      expect(result.sslMode).toBe('require');
    });

    it('should map sslmode verify-full', () => {
      const result = parseConnectionString('postgresql://host/db?sslmode=verify-full');
      expect(result.sslMode).toBe('verify-full');
    });

    it('should ignore invalid sslmode values', () => {
      const result = parseConnectionString('postgresql://host/db?sslmode=invalid');
      expect(result.sslMode).toBeUndefined();
    });

    it('should map sslrootcert query parameter', () => {
      const result = parseConnectionString(
        'postgresql://host/db?sslmode=verify-ca&sslrootcert=/path/to/ca.pem',
      );
      expect(result.sslCaCertPath).toBe('/path/to/ca.pem');
      expect(result.sslMode).toBe('verify-ca');
    });

    it('should throw for non-connection strings', () => {
      expect(() => parseConnectionString('http://host/db')).toThrow(
        'Invalid connection string',
      );
    });

    it('should throw for malformed URIs', () => {
      expect(() => parseConnectionString('postgresql://:')).toThrow();
    });
  });
});
