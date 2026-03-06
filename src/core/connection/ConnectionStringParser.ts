import { ConnectionCredentials, SslMode } from './ConnectionConfig';

const VALID_SSL_MODES: SslMode[] = ['disable', 'require', 'verify-ca', 'verify-full'];

/**
 * Checks whether the input looks like a PostgreSQL connection URI.
 *
 * @param input - String to test
 * @returns true if input starts with `postgresql://` or `postgres://`
 */
export function isConnectionString(input: string): boolean {
  const lower = input.trim().toLowerCase();
  return lower.startsWith('postgresql://') || lower.startsWith('postgres://');
}

/**
 * Parses a PostgreSQL connection URI into partial connection credentials.
 *
 * Supported format: `postgresql://user:password@host:port/database?sslmode=require&sslrootcert=/path`
 * Also accepts the `postgres://` scheme alias.
 *
 * Query parameters mapped:
 * - `sslmode` → `sslMode` (disable, require, verify-ca, verify-full)
 * - `sslrootcert` → `sslCaCertPath`
 *
 * @param uri - A PostgreSQL connection URI
 * @returns Partial credentials — caller fills in defaults for missing fields
 * @throws Error if the URI is malformed or uses an unsupported scheme
 */
export function parseConnectionString(uri: string): Partial<ConnectionCredentials> {
  const trimmed = uri.trim();

  if (!isConnectionString(trimmed)) {
    throw new Error(
      'Invalid connection string. Must start with postgresql:// or postgres://',
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Malformed connection string. Could not parse as a valid URL.');
  }

  const result: Partial<ConnectionCredentials> = {};

  if (url.hostname) {
    result.host = url.hostname;
  }

  if (url.port) {
    const port = parseInt(url.port, 10);
    if (port > 0 && port < 65536) {
      result.port = port;
    }
  } else {
    result.port = 5432;
  }

  if (url.username) {
    result.user = decodeURIComponent(url.username);
  }

  if (url.password) {
    result.password = decodeURIComponent(url.password);
  }

  // Database is the pathname without the leading slash
  const dbName = url.pathname.replace(/^\//, '');
  if (dbName) {
    result.database = decodeURIComponent(dbName);
  }

  // Map query parameters
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) {
    const normalized = sslmode.toLowerCase().replace('_', '-') as SslMode;
    if (VALID_SSL_MODES.includes(normalized)) {
      result.sslMode = normalized;
    }
  }

  const sslrootcert = url.searchParams.get('sslrootcert');
  if (sslrootcert) {
    result.sslCaCertPath = sslrootcert;
  }

  return result;
}
