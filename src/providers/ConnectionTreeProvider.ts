import * as vscode from 'vscode';
import { ConnectionManager } from '../core/connection/ConnectionManager';
import { ConnectionProfile } from '../core/connection/ConnectionConfig';

/**
 * Tree item representing a connection, graph, or status indicator.
 */
class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly profile?: ConnectionProfile,
    public readonly itemType: 'connection' | 'graph' | 'info' = 'connection',
  ) {
    super(label, collapsibleState);
  }
}

/**
 * TreeDataProvider for the Connections sidebar view.
 *
 * Shows:
 * - All saved connection profiles
 * - Connected/disconnected status with appropriate icons
 * - Graph name and server version for connected profiles
 */
export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ConnectionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly connectionManager: ConnectionManager) {
    // Refresh tree when connections change
    connectionManager.onDidChangeConnections(() => this.refresh());
    connectionManager.onDidChangeActiveConnection(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConnectionTreeItem): ConnectionTreeItem[] {
    if (!element) {
      return this.getRootItems();
    }

    if (element.itemType === 'connection' && element.profile) {
      return this.getConnectionDetails(element.profile);
    }

    return [];
  }

  private getRootItems(): ConnectionTreeItem[] {
    const profiles = this.connectionManager.getProfiles();

    return profiles.map((profile) => {
      const isConnected = this.connectionManager.isConnected(profile.id);
      const isActive = this.connectionManager.activeId === profile.id;

      const item = new ConnectionTreeItem(
        profile.name,
        isConnected ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
        profile,
        'connection',
      );

      const statusIcon = isActive ? 'pass-filled' : isConnected ? 'pass' : 'circle-large-outline';
      item.iconPath = new vscode.ThemeIcon(statusIcon);
      item.contextValue = isConnected ? 'connectionConnected' : 'connectionDisconnected';
      item.description = `${profile.host}:${profile.port}/${profile.database}`;

      if (!isConnected) {
        item.command = {
          command: 'apache-age.connect',
          title: 'Connect',
          arguments: [profile.id],
        };
      }

      item.tooltip = new vscode.MarkdownString(
        `**${profile.name}**\n\n` +
        `Host: \`${profile.host}:${profile.port}\`\n\n` +
        `Database: \`${profile.database}\`\n\n` +
        `User: \`${profile.user}\`\n\n` +
        `Status: ${isConnected ? '🟢 Connected' : '⚪ Disconnected'}`
      );

      return item;
    });
  }

  private getConnectionDetails(profile: ConnectionProfile): ConnectionTreeItem[] {
    const items: ConnectionTreeItem[] = [];
    const isConnected = this.connectionManager.isConnected(profile.id);

    if (!isConnected) return items;

    // Available graphs
    const availableGraphs = this.connectionManager.getAvailableGraphs();
    const currentGraph = this.connectionManager.currentGraph;

    for (const graphName of availableGraphs) {
      const isActive = graphName === currentGraph;
      const graphItem = new ConnectionTreeItem(
        graphName,
        vscode.TreeItemCollapsibleState.None,
        profile,
        'graph',
      );
      graphItem.iconPath = new vscode.ThemeIcon(isActive ? 'type-hierarchy-sub' : 'type-hierarchy');
      graphItem.description = isActive ? '(active)' : '';
      graphItem.contextValue = 'graph';

      if (!isActive) {
        graphItem.command = {
          command: 'apache-age.switchGraph',
          title: 'Switch to this graph',
          arguments: [undefined, graphName],
        };
      }

      items.push(graphItem);
    }

    // Server version
    const version = this.connectionManager.getServerVersion(profile.id);
    if (version) {
      const versionItem = new ConnectionTreeItem(
        `PostgreSQL ${version}`,
        vscode.TreeItemCollapsibleState.None,
        profile,
        'info',
      );
      versionItem.iconPath = new vscode.ThemeIcon('info');
      items.push(versionItem);
    }

    return items;
  }
}
