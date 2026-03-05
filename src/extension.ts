import * as path from 'path';
import * as vscode from 'vscode';
import { ConnectionManager } from './core/connection/ConnectionManager';
import { SecretStorage } from './utils/SecretStorage';
import { SqlTemplates } from './utils/SqlTemplates';
import { ConnectionTreeProvider } from './providers/ConnectionTreeProvider';
import { SchemaExplorerProvider } from './providers/SchemaExplorerProvider';
import { StatusBarProvider } from './providers/StatusBarProvider';
import { registerConnectionCommands } from './commands/connectionCommands';
import { registerQueryCommands } from './commands/queryCommands';
import { registerSchemaCommands } from './commands/schemaCommands';

/**
 * Extension activation entry point.
 *
 * Wires together all core services, UI providers, and commands following
 * a dependency-injection pattern (no singletons, no globals).
 */
export function activate(context: vscode.ExtensionContext): void {
  // ── Core infrastructure ──────────────────────────────────────────────
  const secretStorage = new SecretStorage(context.secrets);
  const sqlTemplates = new SqlTemplates(path.join(context.extensionPath, 'sql'));
  const connectionManager = new ConnectionManager(context.globalState, secretStorage);
  context.subscriptions.push(connectionManager);

  // ── Sidebar tree providers ───────────────────────────────────────────
  const connectionTree = new ConnectionTreeProvider(connectionManager);
  const schemaExplorer = new SchemaExplorerProvider(connectionManager, sqlTemplates);

  const connectionTreeView = vscode.window.createTreeView('ageConnections', {
    treeDataProvider: connectionTree,
  });
  connectionTree.setTreeView(connectionTreeView);

  const schemaTreeView = vscode.window.createTreeView('ageSchemaExplorer', {
    treeDataProvider: schemaExplorer,
  });
  schemaExplorer.setTreeView(schemaTreeView);

  context.subscriptions.push(
    connectionTreeView,
    schemaTreeView,
  );

  // ── Status bar ───────────────────────────────────────────────────────
  const statusBar = new StatusBarProvider(connectionManager);
  context.subscriptions.push(statusBar);

  // ── Commands ─────────────────────────────────────────────────────────
  registerConnectionCommands(context, connectionManager, sqlTemplates, connectionTree, schemaExplorer);
  registerQueryCommands(context, connectionManager);
  registerSchemaCommands(context, schemaExplorer);

  // ── Done ─────────────────────────────────────────────────────────────
  console.log('Apache AGE for VS Code activated');
}

export function deactivate(): void {
  // ConnectionManager.dispose() is called automatically via subscriptions
}
