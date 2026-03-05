import * as vscode from 'vscode';
import { QueryResult } from '../core/query/QueryResult';

/**
 * Manages the results table webview panel.
 * Displays query results as a sortable, exportable HTML table.
 */
export class ResultsTablePanel {
  public static currentPanel: ResultsTablePanel | undefined;
  private static readonly viewType = 'ageResultsTable';

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel.onDidDispose(() => {
      ResultsTablePanel.currentPanel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'copyCell':
          vscode.env.clipboard.writeText(message.text);
          break;
        case 'exportCsv':
          this.exportToCsv(message.data);
          break;
        case 'exportJson':
          this.exportToJson(message.data);
          break;
      }
    });
  }

  /**
   * Show or reuse the results panel.
   */
  static show(extensionUri: vscode.Uri, result: QueryResult, query: string): ResultsTablePanel {
    const column = vscode.ViewColumn.Beside;

    if (ResultsTablePanel.currentPanel) {
      ResultsTablePanel.currentPanel.panel.reveal(column);
      ResultsTablePanel.currentPanel.update(result, query);
      return ResultsTablePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      ResultsTablePanel.viewType,
      'AGE Results',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'age-icon.svg');

    ResultsTablePanel.currentPanel = new ResultsTablePanel(panel, extensionUri);
    ResultsTablePanel.currentPanel.update(result, query);
    return ResultsTablePanel.currentPanel;
  }

  /**
   * Update the panel with new results.
   */
  update(result: QueryResult, query: string): void {
    this.panel.title = `AGE Results (${result.rowCount} rows)`;
    this.panel.webview.html = this.getHtml(result, query);
  }

  private getHtml(result: QueryResult, query: string): string {
    const nonce = getNonce();
    const rows = result.rows;
    const columns = result.columns;

    const headerCells = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('');

    const bodyRows = rows.map((row, i) => {
      const cells = columns.map((col) => {
        const val = row[col];
        const display = formatCellValue(val);
        const raw = JSON.stringify(val);
        return `<td data-raw='${escapeAttr(raw)}' title="${escapeAttr(display)}">${escapeHtml(display)}</td>`;
      }).join('');
      return `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">${cells}</tr>`;
    }).join('');

    const jsonData = escapeAttr(JSON.stringify(rows));

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --header-bg: var(--vscode-sideBar-background);
      --hover: var(--vscode-list-hoverBackground);
      --active: var(--vscode-list-activeSelectionBackground);
      --active-fg: var(--vscode-list-activeSelectionForeground);
      --badge-bg: var(--vscode-badge-background);
      --badge-fg: var(--vscode-badge-foreground);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      padding: 12px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .toolbar .info {
      flex: 1;
      font-size: 0.85em;
      opacity: 0.8;
    }
    .toolbar button {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .toolbar button:hover { background: var(--btn-hover); }
    .query-preview {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85em;
      background: var(--header-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px 12px;
      margin-bottom: 12px;
      white-space: pre-wrap;
      max-height: 80px;
      overflow: auto;
      opacity: 0.85;
    }
    .table-container {
      overflow: auto;
      max-height: calc(100vh - 140px);
      border: 1px solid var(--border);
      border-radius: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9em;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--header-bg);
      border-bottom: 2px solid var(--border);
      padding: 6px 10px;
      text-align: left;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    th:hover { background: var(--hover); }
    td {
      padding: 4px 10px;
      border-bottom: 1px solid var(--border);
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: default;
    }
    td:hover {
      white-space: pre-wrap;
      word-break: break-all;
    }
    tr.even { background: transparent; }
    tr.odd { background: color-mix(in srgb, var(--header-bg) 40%, transparent); }
    tr:hover { background: var(--hover); }
    .badge {
      display: inline-block;
      background: var(--badge-bg);
      color: var(--badge-fg);
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 0.8em;
      margin-left: 4px;
    }
    .vertex, .edge { font-style: italic; }
    .vertex::before { content: '⊙ '; opacity: 0.6; }
    .edge::before { content: '→ '; opacity: 0.6; }
    .no-results {
      text-align: center;
      padding: 40px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="info">
      <strong>${result.rowCount}</strong> row${result.rowCount !== 1 ? 's' : ''}<span class="badge">${result.executionTimeMs}ms</span>
    </div>
    <button id="btnCopyAll" title="Copy all results">Copy All</button>
    <button id="btnExportCsv" title="Export as CSV">CSV</button>
    <button id="btnExportJson" title="Export as JSON">JSON</button>
  </div>
  <div class="query-preview">${escapeHtml(query)}</div>
  ${rows.length === 0
    ? '<div class="no-results">No results returned</div>'
    : `<div class="table-container">
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>`}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const jsonData = '${jsonData}';

    // Copy cell on click
    document.querySelectorAll('td').forEach(td => {
      td.addEventListener('dblclick', () => {
        const text = td.getAttribute('data-raw') || td.textContent;
        vscode.postMessage({ command: 'copyCell', text });
      });
    });

    // Sort columns
    document.querySelectorAll('th').forEach((th, idx) => {
      let asc = true;
      th.addEventListener('click', () => {
        const tbody = document.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        rows.sort((a, b) => {
          const aVal = a.children[idx]?.textContent ?? '';
          const bVal = b.children[idx]?.textContent ?? '';
          const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
          return asc ? cmp : -cmp;
        });
        asc = !asc;
        rows.forEach(r => tbody.appendChild(r));
      });
    });

    // Export buttons
    document.getElementById('btnCopyAll')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'exportJson', data: jsonData });
    });
    document.getElementById('btnExportCsv')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'exportCsv', data: jsonData });
    });
    document.getElementById('btnExportJson')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'exportJson', data: jsonData });
    });
  </script>
</body>
</html>`;
  }

  private async exportToCsv(jsonStr: string): Promise<void> {
    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>[];
      if (data.length === 0) return;

      const keys = Object.keys(data[0]);
      const lines = [keys.join(',')];
      for (const row of data) {
        lines.push(keys.map((k) => csvEscape(String(row[k] ?? ''))).join(','));
      }

      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        defaultUri: vscode.Uri.file('query-results.csv'),
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(lines.join('\n'), 'utf-8'));
        vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Export failed: ${err}`);
    }
  }

  private async exportToJson(jsonStr: string): Promise<void> {
    try {
      const data = JSON.parse(jsonStr);
      const pretty = JSON.stringify(data, null, 2);

      const uri = await vscode.window.showSaveDialog({
        filters: { 'JSON Files': ['json'] },
        defaultUri: vscode.Uri.file('query-results.json'),
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(pretty, 'utf-8'));
        vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Export failed: ${err}`);
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);

  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;

    // AGE vertex
    if (obj.__type === 'vertex' || (obj.id && obj.label && obj.properties)) {
      return `⊙ :${obj.label} ${JSON.stringify(obj.properties ?? {})}`;
    }

    // AGE edge
    if (obj.__type === 'edge' || (obj.id && obj.label && obj.start_id && obj.end_id)) {
      return `→ :${obj.label} ${JSON.stringify(obj.properties ?? {})}`;
    }

    return JSON.stringify(val);
  }

  return String(val);
}
