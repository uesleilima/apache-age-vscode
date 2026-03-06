# Plan: Enterprise-Ready Connection (Azure/Proxy/SSL)

## TL;DR

Make connections enterprise-ready by adding: **managed server mode** (skip `CREATE EXTENSION` + `LOAD 'age'` for Azure), **proxy support** (HTTP CONNECT + SOCKS5), **SSL configuration** (disable/require/verify-ca/verify-full), and **connection string import** (paste a `postgresql://` URI to auto-fill all fields). All settings are stored per-connection profile, not as global VS Code settings.

---

## Phase 1: Config Types

*No dependencies*

1. In `ConnectionConfig.ts`, add to `ConnectionConfig` interface:
   - `managedServer?: boolean` — when true, skip `CREATE EXTENSION` and `LOAD 'age'`, only run `SET search_path`
   - `sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full'` — maps to pg `ssl` config
   - `sslCaCertPath?: string` — path to CA cert file (used when sslMode is `verify-ca` or `verify-full`)
   - `proxyUrl?: string` — proxy URL, e.g. `http://host:port`, `socks5://host:port`; supports Basic auth in URL
   - Export `SslMode` type alias

## Phase 2: Proxy Connector

*Depends on Phase 1*

1. Add `socks` `^2.8.0` to `package.json` dependencies and `@types/socks` to devDependencies (if needed — `socks` v2 ships its own types)
2. Create `src/core/connection/ProxyConnector.ts`:
   - `connectThroughProxy(proxyUrl: string, host: string, port: number): Promise<net.Socket>` — auto-detects scheme:
     - `http://` or `https://` → HTTP CONNECT tunnel using Node's built-in `http.request` with method `CONNECT`, supports Basic auth from URL credentials
     - `socks5://` or `socks4://` → SOCKS tunnel via `SocksClient.createConnection()` from `socks` package
   - `createProxyClientClass(proxyUrl: string): typeof Client` — returns a `pg.Client` subclass that overrides `connect()` to establish proxy tunnel first, then calls `super.connect()`. This class is passed to `pg.Pool({ Client: ProxyClient })` so each pooled client connects through the proxy.

## Phase 3: ConnectionPool Changes

*Depends on Phase 1 & 2*

1. Modify `ConnectionPool.initializeAge()`:
   - If `this.credentials.managedServer === true`: run only `SET search_path = ag_catalog, "$user", public;`
   - Otherwise: run the existing full init (`CREATE EXTENSION IF NOT EXISTS age; LOAD 'age'; SET search_path = ...`)

2. Modify `ConnectionPool.connect()`:
   - Build pg `ssl` config from `credentials.sslMode`:
     - `'disable'` / undefined → `ssl: false`
     - `'require'` → `ssl: { rejectUnauthorized: false }`
     - `'verify-ca'` → `ssl: { rejectUnauthorized: true, ca: fs.readFileSync(credentials.sslCaCertPath) }`
     - `'verify-full'` → same as verify-ca (pg driver verifies hostname when `rejectUnauthorized: true`)
   - If `credentials.proxyUrl` is set: import `createProxyClientClass` from `ProxyConnector`, pass to Pool config as `Client`
   - Update `PgPoolConfig` construction to include `ssl`

## Phase 4: ConnectionManager Persistence

*Depends on Phase 1*

1. Modify `ConnectionManager.addProfile()`: include `managedServer`, `sslMode`, `sslCaCertPath`, `proxyUrl` in the persisted `ConnectionProfile` object
2. Modify `ConnectionManager.updateProfile()`: handle the four new fields in the spread/merge logic

## Phase 5: Connection String Parser

*Depends on Phase 1, parallel with Phase 3 & 4*

1. Create `src/core/connection/ConnectionStringParser.ts`:
   - `parseConnectionString(uri: string): Partial<ConnectionCredentials>` — parses standard PostgreSQL connection URIs:
     - Format: `postgresql://user:password@host:port/database?param=value&...`
     - Also accepts `postgres://` scheme (alias)
     - Uses Node's built-in `URL` class for parsing — no new dependency
     - Extracts: `user`, `password` (URL-decoded), `host`, `port`, `database` (from pathname, strip leading `/`)
     - Maps query parameters to config fields:
       - `sslmode` → `sslMode` (`disable`, `require`, `verify-ca`, `verify-full`)
       - `sslrootcert` → `sslCaCertPath`
       - `options` → ignored (AGE-specific search_path is managed internally)
     - Returns a `Partial<ConnectionCredentials>` — caller fills in defaults for missing fields
   - `isConnectionString(input: string): boolean` — returns true if input starts with `postgresql://` or `postgres://`
   - Throws typed error for malformed URIs with clear message

## Phase 6: Connection UI Prompts

*Depends on Phase 1 & 5*

1. Modify `connectionCommands.ts` → `addConnection()`:
   - Before calling `promptConnectionDetails()`, show a Quick Pick: **"Enter details manually"** / **"Paste connection string"**
   - If "Paste connection string": show input box → parse with `parseConnectionString()` → pre-fill `promptConnectionDetails(defaults)` so user can review/adjust (name still prompted, managed server + proxy still prompted since they're not in standard PG URIs)
   - If "Enter details manually": existing flow unchanged
2. Modify `promptConnectionDetails()` — add prompts after the existing `graph` field:

- **Managed server**: Quick Pick — "No (standard)" / "Yes (Azure, managed)" — default "No"
- **SSL mode**: Quick Pick — "Disable" / "Require" / "Verify CA" / "Verify Full" — default "Disable"
- **CA cert path** *(shown only if SSL mode is verify-ca or verify-full)*: `vscode.window.showOpenDialog()` file picker for `.pem`/`.crt` files
- **Proxy URL** *(optional)*: Input box with placeholder `http://proxy:port or socks5://proxy:port`, validateInput checks URL scheme
- Pass `defaults` for all new fields in `promptConnectionDetails()` to support editing

## Phase 7: UI Indicators

*Depends on Phase 4*

1. Modify `ConnectionTreeProvider.ts` → tooltip rendering:

- Show "Managed: Yes" when `profile.managedServer`
- Show "SSL: {mode}" when not `disable`
- Show "Proxy: {url}" when proxy is configured (redact credentials)

## Phase 8: Tests

*Depends on Phase 3 & 5*

1. In `test/unit/ConnectionPool.test.ts`:
    - Test that `initializeAge` with `managedServer: true` runs only `SET search_path`
    - Test that `initializeAge` with `managedServer: false`/undefined runs full init
    - Test that SSL config is correctly built for each mode
    - Test that proxy config results in custom Client class being passed to Pool
2. Create `test/unit/ProxyConnector.test.ts`:
    - Test URL scheme detection (http, https, socks5, socks4)
    - Test `createProxyClientClass` returns a properly extended Client class
    - Test invalid URL throws meaningful error
3. Create `test/unit/ConnectionStringParser.test.ts`:
    - Test full URI: `postgresql://user:pass@host:5432/mydb?sslmode=require` → all fields extracted
    - Test `postgres://` alias works identically
    - Test URL-encoded password: `postgresql://user:p%40ss%23word@host/db` → `p@ss#word`
    - Test missing optional parts: no port (default 5432), no password, no database (default from user)
    - Test sslmode query param maps correctly to `sslMode` values
    - Test sslrootcert query param maps to `sslCaCertPath`
    - Test `isConnectionString()` returns true/false correctly
    - Test malformed URI throws descriptive error

---

## Relevant Files

- `src/core/connection/ConnectionConfig.ts` — add `managedServer`, `sslMode`, `sslCaCertPath`, `proxyUrl` fields
- `src/core/connection/ConnectionPool.ts` — modify `initializeAge()` for managed mode, modify `connect()` for SSL + proxy Pool config
- `src/core/connection/ProxyConnector.ts` (NEW) — proxy tunnel logic (`connectThroughProxy`, `createProxyClientClass`)
- `src/core/connection/ConnectionStringParser.ts` (NEW) — `parseConnectionString()`, `isConnectionString()`
- `src/core/connection/ConnectionManager.ts` — persist new fields in `addProfile()` and `updateProfile()`
- `src/commands/connectionCommands.ts` — connection string Quick Pick entry point + enterprise prompts in `promptConnectionDetails()`
- `src/providers/ConnectionTreeProvider.ts` — show enterprise settings in tooltip
- `package.json` — add `socks` dependency
- `test/unit/ConnectionPool.test.ts` — managed mode + SSL tests
- `test/unit/ProxyConnector.test.ts` (NEW) — proxy connector unit tests
- `test/unit/ConnectionStringParser.test.ts` (NEW) — connection string parsing tests

---

## Verification

1. `npm run lint` — zero TypeScript errors with new fields and imports
2. `npm test` — all existing tests pass, new managed/ssl/proxy/connection-string tests pass
3. `npm run build` — bundle builds successfully with `socks` bundled
4. **Manual F5 test — Managed mode**: Create connection with managedServer=true → verify only `SET search_path` is sent (check pg query log or mock)
5. **Manual F5 test — SSL**: Connect to Azure PostgreSQL with SSL=require → verify connection succeeds over TLS
6. **Manual F5 test — Proxy**: Connect through a test HTTP proxy → verify connection tunnels correctly
7. **Manual F5 test — Connection string**: Add Connection → "Paste connection string" → paste `postgresql://user:pass@myhost:5432/mydb?sslmode=require` → verify all fields pre-filled, SSL set to Require, and connection succeeds
8. **Manual F5 test — Edit**: Edit existing connection to toggle enterprise settings → verify settings persist and reconnect uses new config

---

## Decisions

- **Per-connection, not global**: All enterprise settings are stored in the connection profile (globalState), not in VS Code workspace/user settings. This allows mixing managed and self-hosted connections.
- **Backward compatible**: All new fields are optional with falsy defaults. Existing saved profiles continue to work identically (full AGE init, no SSL, no proxy).
- **`socks` is the only new dependency**: HTTP CONNECT proxy uses Node's built-in `http` module. SOCKS proxy requires `socks` ^2.8.0 (pure JS, ~25KB, ships own types).
- **Proxy via pg Client subclass**: The `pg.Pool` `Client` option accepts a custom Client constructor, allowing per-client proxy tunneling without abandoning connection pooling.
- **CA cert as file path**: Stored as absolute path string in the profile. Read at connect time via `fs.readFileSync`. Users select via file dialog.
- **Connection string uses `URL` class**: No external parser needed. Node's built-in `URL` handles `postgresql://` URIs correctly. Only `postgresql://` and `postgres://` schemes are accepted — key/value format (`host=... dbname=...`) is out of scope.
- **Connection string is a shortcut, not a bypass**: Parsed values pre-fill the manual prompts. User always reviews/adjusts before saving. This ensures `name`, `managedServer`, and `proxyUrl` (not part of standard PG URIs) are always explicitly set.
- **`sql/initAge.sql` unchanged**: The SQL init is inline in `ConnectionPool.initializeAge()`. The existing `sql/initAge.sql` file is not used by ConnectionPool and remains for documentation/reference.

---

## Further Considerations

1. **Azure authentication**: Azure PostgreSQL supports Microsoft Entra authentication (AAD tokens). This would require token acquisition flow — out of scope for this plan but a natural next step for enterprise readiness.
