import * as vscode from 'vscode';
import { ConnectionManager } from '../core/connection/ConnectionManager';
import { QueryExecutor } from '../core/query/QueryExecutor';
import { extractGraphElements } from '../core/query/QueryResult';
import { ResultsTablePanel } from '../panels/ResultsTablePanel';
import { GraphViewPanel } from '../panels/GraphViewPanel';

/**
 * Register all query-related commands.
 */
export function registerQueryCommands(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('apache-age.runQuery', () =>
      runQuery(context, connectionManager, false),
    ),
    vscode.commands.registerCommand('apache-age.runSelection', () =>
      runQuery(context, connectionManager, true),
    ),
    vscode.commands.registerCommand('apache-age.explainQuery', () =>
      explainQuery(context, connectionManager),
    ),
    vscode.commands.registerCommand('apache-age.showGraphView', () =>
      showLastGraphView(context),
    ),
    vscode.commands.registerCommand('apache-age.runQueryDirect', (query: string, graphName: string) =>
      executeAndShow(context, connectionManager, query, graphName),
    ),
  );
}

// ─── Run Query ──────────────────────────────────────────────────────────────

async function runQuery(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
  selectionOnly: boolean,
): Promise<void> {
  const query = getQueryText(selectionOnly);
  if (!query) {
    vscode.window.showWarningMessage('No query text found. Open a .cypher file or select text.');
    return;
  }

  const graph = manager.currentGraph;
  if (!graph) {
    vscode.window.showWarningMessage('No graph selected. Use "Switch Graph" first.');
    return;
  }

  await executeAndShow(context, manager, query, graph);
}

async function executeAndShow(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
  query: string,
  graphName: string,
): Promise<void> {
  const pool = manager.getActivePool();
  if (!pool) {
    vscode.window.showWarningMessage('No active connection. Connect to a database first.');
    return;
  }

  const config = vscode.workspace.getConfiguration('apache-age');
  const autoWrap = config.get<boolean>('autoWrapCypher', true);
  const vizEnabled = config.get<boolean>('graphVisualization.enabled', true);
  const maxNodes = config.get<number>('graphVisualization.maxNodes', 500);

  const executor = new QueryExecutor(pool);

  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Running query...' },
      () => executor.execute(query, graphName, autoWrap),
    );

    // Show graph view first (if applicable) so it opens as a full-height right column
    // BEFORE the results panel splits the query editor's group vertically.
    if (vizEnabled) {
      const { vertices, edges } = extractGraphElements(result.rows);
      if (vertices.length > 0 || edges.length > 0) {
        if (vertices.length > maxNodes) {
          const proceed = await vscode.window.showWarningMessage(
            `Result contains ${vertices.length} nodes (limit: ${maxNodes}). Show graph anyway?`,
            'Show',
            'Skip',
          );
          if (proceed !== 'Show') return;
        }
        GraphViewPanel.show(context.extensionUri, result, query);
      }
    }

    // Show the results table below the query editor
    await ResultsTablePanel.show(context.extensionUri, result, query);

    // Status message
    vscode.window.setStatusBarMessage(
      `AGE: ${result.rowCount} rows in ${result.executionTimeMs}ms`,
      5000,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Query failed: ${err}`);
  }
}

// ─── Explain ────────────────────────────────────────────────────────────────

async function explainQuery(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
): Promise<void> {
  const query = getQueryText(false);
  if (!query) {
    vscode.window.showWarningMessage('No query text found.');
    return;
  }

  const pool = manager.getActivePool();
  if (!pool) {
    vscode.window.showWarningMessage('No active connection.');
    return;
  }

  const graph = manager.currentGraph;
  if (!graph) {
    vscode.window.showWarningMessage('No graph selected.');
    return;
  }

  const executor = new QueryExecutor(pool);

  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Running EXPLAIN ANALYZE...' },
      () => executor.explain(query, graph),
    );

    ResultsTablePanel.show(context.extensionUri, result, `EXPLAIN ANALYZE\n${query}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Explain failed: ${err}`);
  }
}

// ─── Show Last Graph View ───────────────────────────────────────────────────

function showLastGraphView(context: vscode.ExtensionContext): void {
  if (GraphViewPanel.currentPanel) {
    GraphViewPanel.currentPanel.update;
    return;
  }
  vscode.window.showInformationMessage('No graph results to display. Run a query first.');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getQueryText(selectionOnly: boolean): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  if (selectionOnly) {
    const selection = editor.selection;
    if (selection.isEmpty) return;
    return editor.document.getText(selection).trim();
  }

  // Use entire document content
  const text = editor.document.getText().trim();
  return text || undefined;
}
