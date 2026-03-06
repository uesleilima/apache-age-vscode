/**
 * SSL mode for PostgreSQL connections.
 */
export type SslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';

/**
 * Connection configuration for an Apache AGE database.
 */
export interface ConnectionConfig {
  /** User-defined display name for this connection */
  name: string;
  /** PostgreSQL host */
  host: string;
  /** PostgreSQL port */
  port: number;
  /** PostgreSQL database name */
  database: string;
  /** PostgreSQL user */
  user: string;
  /** Currently selected graph name */
  graph?: string;
  /** When true, skip CREATE EXTENSION and LOAD 'age' — only SET search_path (for Azure/managed servers) */
  managedServer?: boolean;
  /** SSL mode for the connection */
  sslMode?: SslMode;
  /** Path to CA certificate file (used when sslMode is 'verify-ca' or 'verify-full') */
  sslCaCertPath?: string;
  /** Proxy URL (e.g. http://host:port, socks5://host:port) */
  proxyUrl?: string;
}

/**
 * Stored connection profile (without password — that's in SecretStorage).
 */
export interface ConnectionProfile extends ConnectionConfig {
  /** Unique identifier for this connection */
  id: string;
}

/**
 * Full connection info including password (runtime only, never persisted in plain text).
 */
export interface ConnectionCredentials extends ConnectionConfig {
  password: string;
}

/**
 * Pool configuration matching AGE Viewer defaults.
 */
export interface PoolConfig {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

export const DEFAULT_POOL_CONFIG: PoolConfig = {
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};
