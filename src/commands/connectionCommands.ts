import * as vscode from 'vscode';
import { ConnectionManager } from '../core/connection/ConnectionManager';
import { ConnectionCredentials } from '../core/connection/ConnectionConfig';
import { SchemaRepository } from '../core/schema/SchemaRepository';
import { SqlTemplates } from '../utils/SqlTemplates';
import { ConnectionTreeProvider } from '../providers/ConnectionTreeProvider';
import { SchemaExplorerProvider } from '../providers/SchemaExplorerProvider';

/**
 * Register all connection-related commands.
 */
export function registerConnectionCommands(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager,
  sqlTemplates: SqlTemplates,
  connectionTree: ConnectionTreeProvider,
  schemaExplorer: SchemaExplorerProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('apache-age.addConnection', () =>
      addConnection(connectionManager),
    ),
    vscode.commands.registerCommand('apache-age.editConnection', (item: any) =>
      editConnection(connectionManager, item?.profile?.id),
    ),
    vscode.commands.registerCommand('apache-age.removeConnection', (item: any) =>
      removeConnection(connectionManager, item?.profile?.id),
    ),
    vscode.commands.registerCommand('apache-age.connect', (idOrItem: any) =>
      connect(connectionManager, schemaExplorer, sqlTemplates, typeof idOrItem === 'string' ? idOrItem : idOrItem?.profile?.id),
    ),
    vscode.commands.registerCommand('apache-age.disconnect', (item: any) =>
      disconnect(connectionManager, item?.profile?.id),
    ),
    vscode.commands.registerCommand('apache-age.switchGraph', (_idOrItem?: any, graphName?: string) =>
      switchGraph(connectionManager, sqlTemplates, schemaExplorer, graphName),
    ),
  );
}

async function addConnection(manager: ConnectionManager): Promise<void> {
  const creds = await promptConnectionDetails();
  if (!creds) return;

  try {
    const profile = await manager.addProfile(creds);
    const shouldConnect = await vscode.window.showInformationMessage(
      `Connection "${profile.name}" added. Connect now?`,
      'Connect',
      'Later',
    );
    if (shouldConnect === 'Connect') {
      await manager.connect(profile.id);
      vscode.window.showInformationMessage(`Connected to ${profile.name}`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to add connection: ${err}`);
  }
}

async function editConnection(manager: ConnectionManager, id?: string): Promise<void> {
  if (!id) {
    id = await pickConnection(manager, 'Select connection to edit');
    if (!id) return;
  }

  const profile = manager.getProfiles().find((p) => p.id === id);
  if (!profile) return;

  const creds = await promptConnectionDetails(profile);
  if (!creds) return;

  try {
    await manager.updateProfile(id, creds);

    if (manager.isConnected(id)) {
      const reconnect = await vscode.window.showInformationMessage(
        'Connection updated. Reconnect to apply changes?',
        'Reconnect',
        'Later',
      );
      if (reconnect === 'Reconnect') {
        await manager.disconnect(id);
        await manager.connect(id);
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to update connection: ${err}`);
  }
}

async function removeConnection(manager: ConnectionManager, id?: string): Promise<void> {
  if (!id) {
    id = await pickConnection(manager, 'Select connection to remove');
    if (!id) return;
  }

  const profile = manager.getProfiles().find((p) => p.id === id);
  if (!profile) return;

  const confirm = await vscode.window.showWarningMessage(
    `Remove connection "${profile.name}"? This cannot be undone.`,
    { modal: true },
    'Remove',
  );

  if (confirm === 'Remove') {
    await manager.removeProfile(id);
    vscode.window.showInformationMessage(`Connection "${profile.name}" removed.`);
  }
}

async function connect(
  manager: ConnectionManager,
  schemaExplorer: SchemaExplorerProvider,
  sqlTemplates: SqlTemplates,
  id?: string,
): Promise<void> {
  if (!id) {
    id = await pickConnection(manager, 'Select connection');
    if (!id) return;
  }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Connecting to AGE...' },
      async () => {
        await manager.connect(id!);
      },
    );

    const profile = manager.getProfiles().find((p) => p.id === id);
    vscode.window.showInformationMessage(`Connected to ${profile?.name ?? 'database'}`);

    // Fetch available graphs and auto-select the first if none is set
    const pool = manager.getActivePool();
    if (pool) {
      try {
        const repo = new SchemaRepository(pool, sqlTemplates);
        const graphs = await repo.getGraphNames();
        manager.setAvailableGraphs(graphs.map((g) => g.name));

        if (!manager.currentGraph && graphs.length > 0) {
          await manager.setCurrentGraph(graphs[0].name);
        }
      } catch (err) {
        console.error('Failed to fetch available graphs:', err);
      }
    }

    await schemaExplorer.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`Connection failed: ${err}`);
  }
}

async function disconnect(manager: ConnectionManager, id?: string): Promise<void> {
  if (!id) {
    const connectedProfiles = manager.getProfiles().filter((p) => manager.isConnected(p.id));
    if (connectedProfiles.length === 0) {
      vscode.window.showInformationMessage('No active connections.');
      return;
    }
    id = await pickConnection(manager, 'Select connection to disconnect', connectedProfiles);
    if (!id) return;
  }

  const profile = manager.getProfiles().find((p) => p.id === id);
  await manager.disconnect(id);
  vscode.window.showInformationMessage(`Disconnected from ${profile?.name ?? 'database'}`);
}

async function switchGraph(
  manager: ConnectionManager,
  sqlTemplates: SqlTemplates,
  schemaExplorer: SchemaExplorerProvider,
  preselectedGraph?: string,
): Promise<void> {
  const pool = manager.getActivePool();
  if (!pool) {
    vscode.window.showWarningMessage('No active connection. Connect first.');
    return;
  }

  if (preselectedGraph) {
    await manager.setCurrentGraph(preselectedGraph);
    await schemaExplorer.refresh();
    vscode.window.showInformationMessage(`Switched to graph: ${preselectedGraph}`);
    return;
  }

  try {
    const repo = new SchemaRepository(pool, sqlTemplates);
    const graphs = await repo.getGraphNames();

    if (graphs.length === 0) {
      vscode.window.showWarningMessage("No graphs found. Create one with: SELECT create_graph('my_graph');");
      return;
    }

    const pick = await vscode.window.showQuickPick(
      graphs.map((g) => ({
        label: g.name,
        description: g.name === manager.currentGraph ? '(active)' : '',
      })),
      { placeHolder: 'Select graph' },
    );

    if (pick) {
      await manager.setCurrentGraph(pick.label);
      await schemaExplorer.refresh();
      vscode.window.showInformationMessage(`Switched to graph: ${pick.label}`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to list graphs: ${err}`);
  }
}

async function pickConnection(
  manager: ConnectionManager,
  placeholder: string,
  profiles?: { id: string; name: string; host: string; port: number; database: string }[],
): Promise<string | undefined> {
  const items = (profiles ?? manager.getProfiles()).map((p) => ({
    label: p.name,
    description: `${p.host}:${p.port}/${p.database}`,
    id: p.id,
  }));

  if (items.length === 0) {
    vscode.window.showInformationMessage('No connections configured. Add one first.');
    return;
  }

  const pick = await vscode.window.showQuickPick(items, { placeHolder: placeholder });
  return pick?.id;
}

async function promptConnectionDetails(
  defaults?: { name: string; host: string; port: number; database: string; user: string; graph?: string },
): Promise<ConnectionCredentials | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Connection name',
    value: defaults?.name ?? '',
    validateInput: (v) => (v.trim() ? null : 'Name is required'),
  });
  if (name === undefined) return;

  const host = await vscode.window.showInputBox({
    prompt: 'Host',
    value: defaults?.host ?? 'localhost',
  });
  if (host === undefined) return;

  const portStr = await vscode.window.showInputBox({
    prompt: 'Port',
    value: String(defaults?.port ?? 5432),
    validateInput: (v) => {
      const n = parseInt(v, 10);
      return n > 0 && n < 65536 ? null : 'Invalid port number';
    },
  });
  if (portStr === undefined) return;

  const database = await vscode.window.showInputBox({
    prompt: 'Database',
    value: defaults?.database ?? 'postgres',
    validateInput: (v) => (v.trim() ? null : 'Database is required'),
  });
  if (database === undefined) return;

  const user = await vscode.window.showInputBox({
    prompt: 'User',
    value: defaults?.user ?? 'postgres',
    validateInput: (v) => (v.trim() ? null : 'User is required'),
  });
  if (user === undefined) return;

  const password = await vscode.window.showInputBox({
    prompt: 'Password',
    password: true,
  });
  if (password === undefined) return;

  const graph = await vscode.window.showInputBox({
    prompt: 'Default graph name (optional)',
    value: defaults?.graph ?? '',
  });

  return {
    name,
    host,
    port: parseInt(portStr, 10),
    database,
    user,
    password,
    graph: graph || undefined,
  };
}
