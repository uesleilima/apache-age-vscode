import * as vscode from 'vscode';
import { ConnectionManager } from '../core/connection/ConnectionManager';
import { SchemaRepository } from '../core/schema/SchemaRepository';
import { SqlTemplates } from '../utils/SqlTemplates';
import { LabelInfo } from '../core/schema/SchemaTypes';

type SchemaTreeItemType = 'graph' | 'category' | 'label';

/**
 * Tree item for the schema explorer.
 */
class SchemaTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: SchemaTreeItemType,
    public readonly graphName?: string,
    public readonly labelInfo?: LabelInfo,
  ) {
    super(label, collapsibleState);
  }
}

/**
 * TreeDataProvider for the Schema Explorer sidebar view.
 *
 * Hierarchy:
 *   Graph Name
 *   ├── Nodes
 *   │   ├── Person (42)
 *   │   └── Movie (18)
 *   └── Edges
 *       ├── ACTED_IN (30)
 *       └── DIRECTED (12)
 */
export class SchemaExplorerProvider implements vscode.TreeDataProvider<SchemaTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SchemaTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private graphNodes = new Map<string, LabelInfo[]>();
  private graphEdges = new Map<string, LabelInfo[]>();
  private graphNames: string[] = [];

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly sqlTemplates: SqlTemplates,
  ) {
    connectionManager.onDidChangeActiveConnection(() => this.refresh());
  }

  async refresh(): Promise<void> {
    this.graphNodes.clear();
    this.graphEdges.clear();
    this.graphNames = [];

    const pool = this.connectionManager.getActivePool();
    if (!pool) {
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    try {
      const repo = new SchemaRepository(pool, this.sqlTemplates);
      const graphs = await repo.getGraphNames();
      this.graphNames = graphs.map((g) => g.name);

      // Load labels for the current graph
      const currentGraph = this.connectionManager.currentGraph;
      if (currentGraph && this.graphNames.includes(currentGraph)) {
        const { nodes, edges } = await repo.getLabels(currentGraph);
        this.graphNodes.set(currentGraph, nodes);
        this.graphEdges.set(currentGraph, edges);
      }
    } catch (err) {
      console.error('Failed to refresh schema:', err);
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SchemaTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SchemaTreeItem): SchemaTreeItem[] {
    if (!element) {
      return this.getGraphItems();
    }

    if (element.itemType === 'graph' && element.graphName) {
      return this.getCategoryItems(element.graphName);
    }

    if (element.itemType === 'category' && element.graphName) {
      const isNodes = element.label === 'Nodes';
      return this.getLabelItems(element.graphName, isNodes);
    }

    return [];
  }

  private getGraphItems(): SchemaTreeItem[] {
    const pool = this.connectionManager.getActivePool();
    if (!pool) return [];

    const currentGraph = this.connectionManager.currentGraph;

    return this.graphNames.map((name) => {
      const isActive = name === currentGraph;
      const item = new SchemaTreeItem(
        name,
        isActive ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'graph',
        name,
      );
      item.iconPath = new vscode.ThemeIcon(isActive ? 'type-hierarchy-sub' : 'type-hierarchy');
      item.description = isActive ? '(active)' : '';
      item.contextValue = 'graph';

      if (!isActive) {
        item.command = {
          command: 'apache-age.switchGraph',
          title: 'Switch to this graph',
          arguments: [undefined, name],
        };
      }

      return item;
    });
  }

  private getCategoryItems(graphName: string): SchemaTreeItem[] {
    const nodes = this.graphNodes.get(graphName) ?? [];
    const edges = this.graphEdges.get(graphName) ?? [];

    const nodeItem = new SchemaTreeItem(
      'Nodes',
      nodes.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
      'category',
      graphName,
    );
    nodeItem.iconPath = new vscode.ThemeIcon('circle-filled');
    nodeItem.description = `${nodes.length} label${nodes.length !== 1 ? 's' : ''}`;

    const edgeItem = new SchemaTreeItem(
      'Edges',
      edges.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
      'category',
      graphName,
    );
    edgeItem.iconPath = new vscode.ThemeIcon('arrow-right');
    edgeItem.description = `${edges.length} label${edges.length !== 1 ? 's' : ''}`;

    return [nodeItem, edgeItem];
  }

  private getLabelItems(graphName: string, isNodes: boolean): SchemaTreeItem[] {
    const labels = isNodes
      ? (this.graphNodes.get(graphName) ?? [])
      : (this.graphEdges.get(graphName) ?? []);

    return labels.map((labelInfo) => {
      const item = new SchemaTreeItem(
        labelInfo.name,
        vscode.TreeItemCollapsibleState.None,
        'label',
        graphName,
        labelInfo,
      );

      item.iconPath = new vscode.ThemeIcon(isNodes ? 'circle-outline' : 'arrow-small-right');
      item.description = `~${labelInfo.count}`;
      item.contextValue = isNodes ? 'nodeLabel' : 'edgeLabel';

      const config = vscode.workspace.getConfiguration('apache-age');
      const limit = config.get<number>('defaultResultsLimit', 100);

      const query = isNodes
        ? `MATCH (n:${labelInfo.name}) RETURN n LIMIT ${limit}`
        : `MATCH ()-[r:${labelInfo.name}]->() RETURN r LIMIT ${limit}`;

      item.command = {
        command: 'apache-age.runQueryDirect',
        title: `Query ${labelInfo.name}`,
        arguments: [query, graphName],
      };

      item.tooltip = new vscode.MarkdownString(
        `**${labelInfo.name}**\n\n` +
        `Type: ${isNodes ? 'Node' : 'Edge'}\n\n` +
        `Approx. count: ${labelInfo.count}\n\n` +
        `Click to query`
      );

      return item;
    });
  }
}
