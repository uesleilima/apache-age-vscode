# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

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
