# Apache AGE for VS Code — v0.1 Implementation Plan

> **Status**: Implemented  
> **Date**: March 2026  
> **Version**: 0.1.0

---

## 1. Overview

A VS Code extension that enables querying Apache AGE (PostgreSQL graph database extension) using Cypher directly from the editor. It provides the full workflow: connect to a PostgreSQL + AGE database, browse graphs and labels, write Cypher with syntax highlighting and snippets, execute queries, and visualize results as both tables and interactive graphs.

### Goals

- First-class Cypher editing experience (syntax highlighting, snippets, language configuration)
- Seamless connection management with secure password storage
- Transparent Cypher → SQL wrapping (`SELECT * FROM cypher(...)`)
- Results displayed as sortable HTML tables with CSV/JSON export
- Graph visualization using Cytoscape.js for results containing vertices/edges
- Schema explorer showing graphs, node labels, and edge labels

### Non-Goals (v0.1)

- Cypher language server / autocompletion (future)
- Multi-database tabs / split query sessions
- Result pagination at the database level (OFFSET/LIMIT)
- Extension marketplace publishing

---

## 2. Technology Stack

| Component          | Choice                  | Rationale                                      |
|--------------------|-------------------------|-------------------------------------------------|
| Language           | TypeScript 5.3+         | VS Code extension standard, type safety         |
| Runtime            | Node.js 18+             | VS Code engine requirement                      |
| VS Code API        | ^1.85.0                 | TreeDataProvider, WebviewPanel, SecretStorage    |
| Database driver    | `pg` ^8.13.0            | Proven PostgreSQL driver, matches AGE Viewer     |
| Agtype parsing     | Hand-rolled recursive descent | Zero dependencies, replaces ANTLR4 pipeline |
| Bundler            | esbuild                 | Fast, simple, single-file output                 |
| Graph visualization| Cytoscape.js (CDN)      | Lightweight, mature, no bundling needed          |
| Testing            | Vitest ^1.2.0           | Fast, TypeScript-native                          |
| Packaging          | @vscode/vsce            | Official VS Code extension packaging tool        |

---

## 3. Architecture

### 3.1 Layered Design

```
┌─────────────────────────────────────────────┐
│  VS Code Extension API                       │
│  (commands, TreeDataProvider, WebviewPanel)   │
├──────────┬──────────┬───────────────────────┤
│ Commands │Providers │ Panels                 │
│          │          │ (ResultsTable,         │
│          │          │  GraphView)            │
├──────────┴──────────┴───────────────────────┤
│  Core Domain Layer                           │
│  (ConnectionPool, QueryExecutor, Parser,     │
│   SchemaRepository, CypherQueryWrapper)      │
├─────────────────────────────────────────────┤
│  Utils (SecretStorage, SqlTemplates)         │
├─────────────────────────────────────────────┤
│  PostgreSQL + Apache AGE                     │
└─────────────────────────────────────────────┘
```

**Key principle**: Core domain classes have **zero VS Code dependencies**. They only import `pg` and Node.js builtins. This enables unit testing without VS Code and potential reuse outside the extension.

### 3.2 Dependency Injection

The `extension.ts` `activate()` function wires everything together:

1. Creates core services (`SecretStorage`, `SqlTemplates`, `ConnectionManager`)
2. Creates UI providers (`ConnectionTreeProvider`, `SchemaExplorerProvider`, `StatusBarProvider`)
3. Registers commands via `registerConnectionCommands()`, `registerQueryCommands()`, `registerSchemaCommands()`
4. Pushes all disposables to `context.subscriptions`

No singletons. No global state. All dependencies are passed via constructor parameters.

---

## 4. Directory Structure

```
apache-age-vscode/
├── package.json                    # Extension manifest + contributions
├── tsconfig.json                   # TypeScript config (ES2022, strict)
├── language-configuration.json     # Cypher bracket/comment rules
├── media/
│   └── age-icon.svg               # Activity bar + panel icon
├── syntaxes/
│   └── cypher.tmLanguage.json     # TextMate grammar for Cypher
├── snippets/
│   └── cypher.json                # 22 Cypher snippets (incl. 3 AGE-specific)
├── sql/                           # SQL templates for AGE catalog queries
│   ├── initAge.sql
│   ├── getGraphNames.sql
│   ├── getGraphLabels.sql
│   ├── getMetaData.sql
│   ├── getMetaDataLegacy.sql      # PG 11 variant
│   ├── getRole.sql
│   ├── analyzeGraph.sql
│   ├── metaNodes.sql
│   ├── metaEdges.sql
│   └── pgVersion.sql
├── src/
│   ├── extension.ts               # activate() / deactivate() entry point
│   ├── core/
│   │   ├── connection/
│   │   │   ├── ConnectionConfig.ts     # Interfaces + defaults
│   │   │   ├── ConnectionPool.ts       # pg.Pool wrapper with AGE init
│   │   │   └── ConnectionManager.ts    # Profile CRUD + pool lifecycle
│   │   ├── parser/
│   │   │   └── AgtypeDeserializer.ts   # Recursive descent agtype parser
│   │   ├── query/
│   │   │   ├── QueryResult.ts          # Result types + graph element extraction
│   │   │   ├── CypherQueryWrapper.ts   # Cypher → SELECT * FROM cypher(...)
│   │   │   └── QueryExecutor.ts        # Execute + timing
│   │   └── schema/
│   │       ├── SchemaTypes.ts          # GraphInfo, LabelInfo, GraphMetadata
│   │       └── SchemaRepository.ts     # ag_catalog queries
│   ├── commands/
│   │   ├── connectionCommands.ts       # add/edit/remove/connect/disconnect/switchGraph
│   │   ├── queryCommands.ts            # runQuery/runSelection/explain/showGraphView
│   │   └── schemaCommands.ts           # refreshSchema
│   ├── providers/
│   │   ├── ConnectionTreeProvider.ts   # Sidebar connections view
│   │   ├── SchemaExplorerProvider.ts   # Sidebar schema explorer view
│   │   └── StatusBarProvider.ts        # Status bar item
│   ├── panels/
│   │   ├── ResultsTablePanel.ts        # HTML table webview
│   │   └── GraphViewPanel.ts           # Cytoscape.js webview
│   └── utils/
│       ├── SecretStorage.ts            # VS Code secret storage wrapper
│       └── SqlTemplates.ts             # SQL file loader with caching
├── test/                              # Vitest test directory
└── dist/                              # esbuild output (gitignored)
```

---

## 5. Feature Specifications

### 5.1 Connection Management

- **Storage**: Profiles (host, port, database, user, graph) in `globalState` (Memento). Passwords in VS Code `SecretStorage`.
- **Pool**: Each connection gets a `pg.Pool` (configurable max connections, idle timeout). On `getClient()`, every connection is initialized with `CREATE EXTENSION IF NOT EXISTS age; LOAD 'age'; SET search_path = ag_catalog, "$user", public;`.
- **Agtype OID**: Discovered at connect time via `SELECT oid FROM pg_type WHERE typname = 'agtype'`. Registered as a custom parser using `pg-types`.
- **Events**: `onDidChangeConnections` and `onDidChangeActiveConnection` fire to refresh tree views and status bar.
- **Commands**: `addConnection`, `editConnection`, `removeConnection`, `connect`, `disconnect`, `switchGraph`

### 5.2 Cypher Query Execution

- **Auto-wrapping**: `CypherQueryWrapper.wrap()` converts `MATCH (n) RETURN n` into `SELECT * FROM cypher('graph', $$ MATCH (n) RETURN n $$) as (n agtype)`. Detects already-wrapped SQL (passthrough). Parses RETURN clause to build typed column aliases.
- **Execution**: `QueryExecutor.execute()` wraps → executes → times → returns `QueryResult`.
- **EXPLAIN**: `QueryExecutor.explain()` wraps with `EXPLAIN ANALYZE` prefix.
- **Keybindings**: `Cmd+Enter` (run full file), `Cmd+Shift+Enter` (run selection).

### 5.3 Agtype Parsing

- Hand-rolled lexer + recursive descent parser (~400 lines).
- Supports: strings, integers, floats (incl. `Infinity`, `NaN`, scientific notation), booleans, null, objects, arrays.
- Type annotations: `::vertex`, `::edge`, `::path` etc. stored as `__type` property (non-enumerable on arrays).
- Public API: `deserializeAgtype(input: string): unknown`

### 5.4 Results Table

- WebviewPanel with inline HTML/CSS/JS (CSP-compliant with nonce).
- Features: column sorting (click headers), cell copy (double-click), CSV export, JSON export.
- Formats AGE vertices as `⊙ :Label {props}` and edges as `→ :Label {props}`.
- Respects VS Code theme variables for consistent appearance.

### 5.5 Graph Visualization

- WebviewPanel loading Cytoscape.js from CDN.
- Auto-extracts vertices and edges from query results via `extractGraphElements()`.
- Features: 5 layout algorithms (force-directed, circle, grid, hierarchy, concentric), fit/zoom, PNG export, click-to-inspect node/edge properties.
- Color-coded by label (15-color palette).
- Configurable max node warning threshold (`apache-age.graphVisualization.maxNodes`).

### 5.6 Schema Explorer

- TreeDataProvider hierarchy: Graph → Nodes (labels) / Edges (labels).
- Shows approximate row counts per label.
- Click a label to run a query matching all nodes/edges of that type.
- Refreshes on connection change and manually via toolbar button.

### 5.7 Syntax Highlighting

- TextMate grammar covering: clause keywords (MATCH, RETURN, WHERE...), write keywords (CREATE, DELETE, SET...), functions (aggregation, scalar, string, math, list, path, predicate, AGE-specific), labels (`:Label`), relationships (`-[]->`, `<-[]-`), parameters (`$param`), operators, comments, strings, numbers.

### 5.8 Snippets

- 22 snippets including common patterns (MATCH, CREATE, MERGE, DELETE, shortestPath, CASE, pagination) plus 3 AGE-specific snippets for wrapped SQL queries.

---

## 6. AGE-Specific Patterns

These patterns, derived from studying the Apache AGE Viewer codebase, are critical for correct operation:

1. **Per-connection initialization**: Every new pg client must run `LOAD 'age'; SET search_path = ag_catalog, "$user", public;`. The `LOAD` is required to register AGE's functions.

2. **Cypher wrapping format**: `SELECT * FROM cypher('graph_name', $$ CYPHER $$) as (col1 agtype, col2 agtype, ...)`. Dollar-quoting (`$$`) avoids escaping issues.

3. **Agtype OID registration**: The numeric OID for `agtype` varies per installation. Must be queried from `pg_type` and registered with `pg-types` at connect time.

4. **PG version dispatching**: AGE metadata queries differ between PG 11 (`ag_graph.oid`) and PG 12+ (`ag_graph.graphid`). The `SqlTemplates.getMetaData()` method dispatches based on server major version.

5. **Internal labels**: `_ag_label_vertex` and `_ag_label_edge` are AGE internal labels that should be filtered from user-facing views.

---

## 7. VS Code Contributions Summary

| Contribution      | Count | Details                                         |
|-------------------|-------|-------------------------------------------------|
| Language           | 1     | Cypher (`.cypher`, `.cql`, `.age`)              |
| Grammar            | 1     | TextMate `source.cypher`                        |
| Snippets           | 22    | Cypher + AGE-specific                           |
| Views              | 2     | Connections, Schema Explorer                    |
| Commands           | 11    | Connection (6), Query (4), Schema (1)           |
| Keybindings        | 2     | Cmd+Enter, Cmd+Shift+Enter                      |
| Configuration      | 6     | Results limit, auto-wrap, viz settings, pool    |
| Menus              | 8     | View title, view item context, editor context   |
| Activity Bar       | 1     | Apache AGE container                            |

---

## 8. Build & Development

```bash
# Install dependencies
npm install

# Type-check (no emit)
npm run lint

# Build (esbuild → dist/extension.js)
npm run build

# Watch mode
npm run watch

# Run tests
npm test

# Package .vsix
npm run package
```

**esbuild config**: Bundles `src/extension.ts` → `dist/extension.js`. Externals: `vscode`, `pg-native`. Target: Node 18, CJS format, with sourcemaps.

---

## 9. Dependencies

### Runtime
- `pg` ^8.13.0 — PostgreSQL client
- `pg-types` ^4.0.2 — Custom type parser registration
- `uuid` ^9.0.0 — Connection profile ID generation

### Dev
- `@types/vscode` ^1.85.0, `@types/pg` ^8.11.0, `@types/uuid` ^9.0.0, `@types/node` ^20.11.0
- `typescript` ^5.3.0, `esbuild` ^0.20.0, `vitest` ^1.2.0, `@vscode/vsce` ^2.22.0

---

## 10. Future Enhancements (Post v0.1)

- [ ] Cypher Language Server Protocol (LSP) for autocompletion and validation
- [ ] Query history panel with re-run support
- [ ] Multi-tab query sessions
- [ ] Property key completion from schema metadata
- [ ] Dark/light aware graph colors (beyond CSS variable theming)
- [ ] CSV import via AGE's `load_labels_from_file`
- [ ] Connection import/export (JSON profiles)
- [ ] Telemetry opt-in for usage analytics
- [ ] Integration tests with Testcontainers (PG + AGE)

---

## 11. Verification Checklist

- [x] `npm run lint` — 0 TypeScript errors
- [x] `npm run build` — 245KB bundle, 101ms build time
- [x] All 20 source files created and wired
- [x] 10 SQL templates, 22 snippets, full TextMate grammar
- [x] package.json declares all 11 commands, 2 views, keybindings, configuration
- [ ] F5 launch in Extension Development Host
- [ ] End-to-end test with real AGE database
