# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [0.2.0] - 2026-03-06

### Added

- **Managed server mode**: Skip `CREATE EXTENSION` and `LOAD 'age'` for Azure and other managed PostgreSQL instances.
- **SSL configuration**: Per-connection SSL mode (disable / require / verify-ca / verify-full) with CA certificate file picker.
- **Proxy support**: Connect through HTTP CONNECT or SOCKS5 proxies, configured per connection profile.
- **Connection string import**: Paste a `postgresql://` URI to auto-fill connection details.

### Changed

- All enterprise settings (managed mode, SSL, proxy) are stored per-connection profile, not as global settings.

## [0.1.3] - 2026-03-05

### Fixed

- Included the `sql/` directory in the packaged extension (`.vsix`) so runtime SQL templates are available after Marketplace install.
- Fixed Marketplace install error: `SQL template not found: getGraphNames`.

### Documentation

- Documented the Cytoscape.js CDN dependency for graph visualization in `README.md`, including behavior in offline/restricted-network environments.

## [0.1.2] - 2026-03-05

### Fixed

- Included the Apache AGE activity bar SVG icon in the packaged extension (`.vsix`) so it shows correctly after marketplace install.

## [0.1.1] - 2026-03-05

### Added

- Initial release of Apache AGE for VS Code.
- Cypher language support with syntax highlighting and snippets.
- Connection management for Apache AGE-enabled PostgreSQL databases.
- Query execution commands and result rendering.
- Graph visualization and schema explorer views.
