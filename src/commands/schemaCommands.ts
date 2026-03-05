import * as vscode from 'vscode';
import { SchemaExplorerProvider } from '../providers/SchemaExplorerProvider';

/**
 * Register all schema-related commands.
 */
export function registerSchemaCommands(
  context: vscode.ExtensionContext,
  schemaExplorer: SchemaExplorerProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('apache-age.refreshSchema', () =>
      refreshSchema(schemaExplorer),
    ),
  );
}

async function refreshSchema(schemaExplorer: SchemaExplorerProvider): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Refreshing schema...' },
    () => schemaExplorer.refresh(),
  );
}
