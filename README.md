# Apache AGE for VS Code

<p align="center">
	<img src="media/icon.png" alt="Apache AGE for VS Code icon" width="128" height="128" />
</p>

<p align="center"><strong>Official Marketplace Icon</strong></p>

<p align="center">
	<a href="https://github.com/uesleilima/apache-age-vscode/actions/workflows/ci.yml">
		<img alt="CI" src="https://img.shields.io/github/actions/workflow/status/uesleilima/apache-age-vscode/ci.yml?branch=main&label=CI" />
	</a>
	<img alt="VS Code" src="https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC" />
	<img alt="License" src="https://img.shields.io/badge/License-Apache--2.0-2ea44f" />
</p>

Query [Apache AGE](https://age.apache.org/) graph databases with Cypher — directly from VS Code.

Write Cypher queries with syntax highlighting and snippets, execute them against PostgreSQL + AGE, and visualize results as interactive graphs or sortable tables.

## Features

### Cypher Editing

- Full **syntax highlighting** for Cypher (`.cypher`, `.cql`, `.age` files)
- **22 code snippets** including common patterns (MATCH, CREATE, MERGE, shortestPath) and AGE-specific wrapped SQL queries
- Bracket matching, comment toggling, and auto-closing pairs

### Connection Management

- Add, edit, and remove PostgreSQL + AGE connection profiles
- Secure password storage using VS Code's built-in SecretStorage API
- Connection pooling with configurable pool size and idle timeout
- Switch between graphs on the same database

### Query Execution

- **Run full file** — `Cmd+Enter` (macOS) / `Ctrl+Enter`
- **Run selection** — `Cmd+Shift+Enter` / `Ctrl+Shift+Enter`
- **Explain query** — view `EXPLAIN ANALYZE` output
- Automatic Cypher → SQL wrapping (`SELECT * FROM cypher(...)`) — no manual wrapping needed
- Raw SQL passthrough when needed

### Results Table

- Sortable HTML table with VS Code theme integration
- Vertices displayed as `⊙ :Label {props}`, edges as `→ :Label {props}`
- **CSV and JSON export**
- Double-click cells to copy values

### Graph Visualization

- Interactive graph rendering powered by [Cytoscape.js](https://js.cytoscape.org/)
- Auto-extracts vertices and edges from query results
- 5 layout algorithms: force-directed, circle, grid, hierarchy, concentric
- Color-coded nodes by label
- Click nodes/edges to inspect properties
- PNG export

### Schema Explorer

- Browse graphs, node labels, and edge labels in the sidebar
- Approximate row counts per label
- Click a label to query all nodes/edges of that type

## Requirements

- **VS Code** 1.85.0 or later
- **PostgreSQL** with [Apache AGE](https://age.apache.org/) extension installed
- Node.js 18+ (for extension development only)

## Getting Started

1. Install the extension (F5 to run in development, or install the `.vsix` package)
2. Open the **Apache AGE** view in the Activity Bar
3. Click **Add Connection** and enter your PostgreSQL + AGE database details
4. Connect and select a graph
5. Open or create a `.cypher` file and start writing queries
6. Press `Cmd+Enter` to execute

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `apache-age.defaultResultsLimit` | `100` | Default LIMIT for queries generated from the schema explorer |
| `apache-age.autoWrapCypher` | `true` | Automatically wrap Cypher in `SELECT * FROM cypher(...)` SQL |
| `apache-age.graphVisualization.enabled` | `true` | Auto-show graph visualization for results with nodes/edges |
| `apache-age.graphVisualization.maxNodes` | `500` | Max nodes to render before showing a warning |
| `apache-age.pool.maxConnections` | `10` | Max connections in the PostgreSQL connection pool |
| `apache-age.pool.idleTimeoutMs` | `30000` | Idle timeout (ms) before closing a pool connection |

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| Apache AGE: Run Cypher Query | `Cmd+Enter` | Execute the full Cypher file |
| Apache AGE: Run Selected Cypher | `Cmd+Shift+Enter` | Execute selected text |
| Apache AGE: Explain Query | — | Run EXPLAIN ANALYZE on the query |
| Apache AGE: Show Graph Visualization | — | Open the graph view for current results |
| Apache AGE: Add Connection | — | Add a new database connection |
| Apache AGE: Edit Connection | — | Edit an existing connection profile |
| Apache AGE: Remove Connection | — | Delete a connection profile |
| Apache AGE: Connect | — | Connect to a database |
| Apache AGE: Disconnect | — | Disconnect from the active database |
| Apache AGE: Switch Graph | — | Switch the active graph on current connection |
| Apache AGE: Refresh Schema | — | Reload schema explorer data |

## Development

```bash
# Install dependencies
npm install

# Build (esbuild → dist/extension.js)
npm run build

# Watch mode
npm run watch

# Type-check
npm run lint

# Run tests
npm test

# Package as .vsix
npm run package
```

Press **F5** in VS Code to launch the Extension Development Host for testing.

## Architecture

The extension follows a strict layered architecture:

```
src/
├── core/          # Domain logic — zero vscode imports
├── commands/      # VS Code command handlers
├── providers/     # TreeDataProviders, StatusBar
├── panels/        # WebviewPanels (results table, graph view)
├── utils/         # SecretStorage, SQL template loader
└── extension.ts   # Wiring — activate() / deactivate()
```

Core domain classes (`ConnectionPool`, `QueryExecutor`, `AgtypeDeserializer`, etc.) have no VS Code dependency, enabling unit testing with Vitest and potential reuse outside the extension.

## License

[Apache-2.0](LICENSE)
