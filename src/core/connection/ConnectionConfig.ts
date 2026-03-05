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
  /** Password is stored separately in SecretStorage */
  /** Currently selected graph name */
  graph?: string;
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
