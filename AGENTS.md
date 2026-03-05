# AGENTS.md — AI Agent Guidelines for apache-age-vscode

> Best practices and project conventions that AI coding agents must follow when working on this codebase.

---

## 1. Project Overview

This is a **VS Code extension** (TypeScript) that enables querying Apache AGE graph databases using Cypher. Before making any changes, read the implementation plan at [specs/plans/v0.1-implementation-plan.md](specs/plans/v0.1-implementation-plan.md) to understand the full architecture.

**Key facts:**

- Runtime: VS Code Extension Host (Node.js 18+)
- Language: TypeScript 5.3+ with strict mode
- Bundler: esbuild (single-file CJS output to `dist/extension.js`)
- Test framework: Vitest
- Database: PostgreSQL with Apache AGE extension, accessed via `pg` driver

---

## 2. Architecture Rules

### 2.1 Core Philosophy

- **KISS > DRY > SOLID:** Simplicity is the priority. Do not over-engineer interfaces or abstractions unless the problem complexity explicitly demands it.
- **Pragmatic DRY:** De-duplicate knowledge, but accept duplication to avoid coupling unrelated logic (no incidental coupling).

### 2.2 Layered Separation

The codebase follows a strict layered architecture. **Never violate layer boundaries.**

```
src/
├── core/          # Domain logic — ZERO vscode imports allowed
├── commands/      # VS Code command handlers — thin, delegates to core
├── providers/     # VS Code TreeDataProvider / StatusBar — observes core via events
├── panels/        # VS Code WebviewPanel — renders core data as HTML
├── utils/         # Shared utilities — minimal dependencies
└── extension.ts   # Wiring only — no business logic
```

**Critical rule:** Files under `src/core/` must **never** import from `vscode`. They should only import from:

- Other `core/` modules
- `utils/` modules
- Node.js built-ins
- npm packages (`pg`, `uuid`, etc.)

This ensures core logic is unit-testable without VS Code and potentially reusable outside the extension.

### 2.3 Dependency Injection

All dependencies are wired in `extension.ts` via constructor parameters. **Do not use:**

- Singletons or static instance patterns
- Global mutable state
- Service locators

When adding a new service/provider, instantiate it in `activate()` and pass its dependencies explicitly.

### 2.4 Event-Driven UI Updates

UI providers (tree views, status bar) subscribe to `ConnectionManager` events:

- `onDidChangeConnections` — profile list changed
- `onDidChangeActiveConnection` — active connection or graph changed

**Never** call `refresh()` on a provider from command handlers directly. Instead, fire the appropriate event from `ConnectionManager`, and let providers react.

Exception: `SchemaExplorerProvider.refresh()` may be called directly when schema data needs reloading (e.g., after `switchGraph`), since schema changes are not tracked by connection events.

---

## 3. Coding Conventions

### 3.1 TypeScript

- **Strict mode is on.** Don't use `any` unless interfacing with untyped external APIs (VS Code tree item callbacks are an accepted exception — annotate with `// eslint-disable-next-line` or a TODO).
- Use `interface` for data shapes, `type` for unions/intersections.
- Prefer `readonly` properties where mutation is not needed.
- Use `unknown` over `any` for external/parsed data; narrow with type guards.
- All public methods must have JSDoc comments describing purpose and parameters.
- Private methods need JSDoc only if their purpose is non-obvious.

### 3.2 Naming

| Element          | Convention         | Example                      |
|------------------|--------------------|------------------------------|
| Files            | PascalCase         | `ConnectionPool.ts`          |
| Classes          | PascalCase         | `ConnectionPool`             |
| Interfaces       | PascalCase         | `ConnectionProfile`          |
| Functions        | camelCase          | `deserializeAgtype()`        |
| Constants        | UPPER_SNAKE_CASE   | `DEFAULT_POOL_CONFIG`        |
| Private fields   | camelCase          | `activeConnectionId`         |
| Event emitters   | `_onDidX` (private), `onDidX` (public) | `_onDidChangeConnections` |
| Commands         | `apache-age.<verb><Noun>` | `apache-age.runQuery`    |
| Config keys      | `apache-age.<section>.<key>` | `apache-age.pool.maxConnections` |

### 3.3 Error Handling

- Core layer: Throw typed errors. Let callers decide how to present them.
- Command layer: Catch errors and show `vscode.window.showErrorMessage()`.
- **Never** swallow errors silently. At minimum, `console.error()` them.
- Wrap long operations in `vscode.window.withProgress()`.

### 3.4 Imports

- Use explicit named imports, never `import *` (except `import * as vscode from 'vscode'` which is the VS Code convention).
- Group imports in order: (1) `vscode`, (2) npm packages, (3) core, (4) providers/panels, (5) utils.
- Use relative paths within the project, never absolute paths.

---

## 4. AGE-Specific Knowledge

Agents working on this codebase must understand these Apache AGE fundamentals:

### 4.1 Connection Initialization

Every PostgreSQL connection used for AGE queries must run these statements first:

```sql
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
```

This is handled by `ConnectionPool.initializeClient()`. Do not bypass it.

### 4.2 Cypher → SQL Wrapping

Users write raw Cypher. The extension wraps it into:

```sql
SELECT * FROM cypher('graph_name', $$ MATCH (n) RETURN n $$) as (n agtype)
```

The `CypherQueryWrapper` class handles this. Key rules:

- Use `$$` dollar-quoting (not single quotes) to avoid escaping issues.
- The `AS` clause must list one `agtype` column per RETURN item.
- If the query is already wrapped (contains `SELECT...FROM cypher(`), pass through.
- If the query is raw SQL (non-Cypher), pass through.

### 4.3 Agtype Parsing

AGE returns query results as `agtype` — a JSON superset with type annotations like `::vertex`, `::edge`, `::path`. The custom parser in `AgtypeDeserializer.ts` handles this. Key structures:

- **Vertex**: `{id: {oid, id}, label: "Person", properties: {name: "Alice"}, __type: "vertex"}`
- **Edge**: `{id: {oid, id}, label: "KNOWS", start_id: {...}, end_id: {...}, properties: {...}, __type: "edge"}`
- **Path**: Array alternating `[vertex, edge, vertex, edge, vertex]`

### 4.4 PostgreSQL Version Differences

AGE metadata queries differ by PG version:

- PG 11: Uses `ag_graph.oid`
- PG 12+: Uses `ag_graph.graphid`

The `SqlTemplates.getMetaData()` method dispatches based on major version. If adding new catalog queries, check if they need version-specific variants.

### 4.5 Internal Labels

AGE creates two internal labels per graph: `_ag_label_vertex` and `_ag_label_edge`. These must be **filtered out** from user-facing views (schema explorer, label lists).

---

## 5. Working with Webviews

### 5.1 Security

All webview HTML must include a Content Security Policy with a random nonce:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
```

All `<style>` and `<script>` tags must include `nonce="${nonce}"`.

### 5.2 Theming

Use VS Code CSS variables for colors (e.g., `var(--vscode-editor-background)`, `var(--vscode-button-background)`). **Never hardcode colors** — the extension must work in any VS Code theme.

### 5.3 Communication

Webview ↔ Extension communication uses `postMessage()`:

- Webview → Extension: `vscode.postMessage({ command: 'action', ... })`
- Extension → Webview: `panel.webview.postMessage({ ... })`

Keep message types minimal and documented.

### 5.4 Panel Reuse

Use the singleton panel pattern (`static currentPanel`). When a panel is already open, `reveal()` and `update()` it rather than creating a new one.

---

## 6. SQL Templates

SQL files live in `sql/` at the project root. They are loaded by `SqlTemplates` at runtime.

- Use `%s` for string interpolation (replaced sequentially).
- Use `$1`, `$2` for pg parameterized queries (safe from injection).
- When adding a new template, also add a corresponding loader method in `SqlTemplates`.
- Templates are cached after first read — no performance concern for repeated use.

---

## 7. Adding New Features

### 7.1 New Command

1. Define the command in `package.json` → `contributes.commands` (with `command`, `title`, `category`, `icon`).
2. Add menu entries in `contributes.menus` if needed (view/title, view/item/context, editor/context).
3. Add keybinding in `contributes.keybindings` if needed.
4. Implement handler in the appropriate `src/commands/*.ts` file.
5. Register in the file's `register*Commands()` function.
6. If the command needs a new service, create it in `src/core/` and wire it in `extension.ts`.

### 7.2 New Tree View

1. Define the view in `package.json` → `contributes.views`.
2. Create a `TreeDataProvider` in `src/providers/`.
3. Register with `vscode.window.registerTreeDataProvider()` in `extension.ts`.
4. Add `viewsWelcome` content if applicable.

### 7.3 New Webview Panel

1. Create a panel class in `src/panels/` with the static singleton pattern.
2. Implement `getHtml()` with proper CSP nonce and VS Code theme variables.
3. Handle message passing for interactive features.
4. Register any associated commands in `src/commands/`.

---

## 8. Testing

- When fixing, changing or including new features make sure you include new or adapt the existing tests.
- Use **Vitest** for unit tests. Tests go in the `test/` directory.
- Core domain logic should have high test coverage since it has no VS Code dependency.
- Priority test targets:
  - `AgtypeDeserializer` — parser edge cases (Infinity, NaN, nested objects, type annotations)
  - `CypherQueryWrapper` — wrapping logic, RETURN clause parsing, passthrough detection
  - `QueryResult` — graph element extraction from complex nested results
- Mock `pg.Pool` for `ConnectionPool` tests.
- Webview panels do not need unit tests (manual testing in Extension Development Host).

```bash
npm test          # Run all tests
npm run lint      # Type-check without emitting
```

---

## 9. Build & Release

```bash
npm run build     # esbuild → dist/extension.js (245KB)
npm run watch     # esbuild in watch mode
npm run package   # vsce package → .vsix file
```

**Important esbuild externals:**

- `vscode` — provided by the VS Code runtime
- `pg-native` — optional native binding, not required

The `.vscodeignore` file excludes `src/`, `test/`, `node_modules/`, and other dev files from the packaged `.vsix`.

---

## 10. Common Pitfalls

1. **Forgetting `LOAD 'age'`**: If you create a new query path that bypasses `ConnectionPool.getClient()`, the connection won't have AGE loaded. Always use the pool's managed clients.

2. **Hardcoded agtype OID**: The OID is *not* constant across installations. Always query it from `pg_type` at connect time (handled by `ConnectionPool.connect()`).

3. **Dollar-quoting collisions**: If user Cypher contains `$$`, it will break the wrapping. This is a known limitation of v0.1. Future versions should use tagged dollar-quoting (`$cypher$...$cypher$`).

4. **Editing `package.json` commands without updating handlers**: Every command in `contributes.commands` must have a corresponding `vscode.commands.registerCommand()` call. Missing registrations cause "command not found" errors at runtime.

5. **WebviewPanel disposed too early**: If you store a reference to a panel, always check its disposal state. The singleton pattern in `ResultsTablePanel` and `GraphViewPanel` handles this via the `onDidDispose` callback.

6. **Blocking the extension host**: All database operations are async and should use `await`. Never block the extension host thread with synchronous I/O.

---

## 11. Reference

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Apache AGE Documentation](https://age.apache.org/age-manual/master/index.html)
- [Apache AGE Viewer](https://github.com/apache/age-viewer) — reference implementation at `/Users/ueslei/Projects/oss/age-viewer/`
- [Cytoscape.js](https://js.cytoscape.org/) — graph visualization library
- [pg (node-postgres)](https://node-postgres.com/) — PostgreSQL driver
