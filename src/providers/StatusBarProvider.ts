import * as vscode from 'vscode';
import { ConnectionManager } from '../core/connection/ConnectionManager';

/**
 * Manages the status bar item showing active connection/graph info.
 */
export class StatusBarProvider implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(private readonly connectionManager: ConnectionManager) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = 'apache-age.switchGraph';

    connectionManager.onDidChangeActiveConnection(() => this.update());
    connectionManager.onDidChangeConnections(() => this.update());

    this.update();
  }

  private update(): void {
    const profile = this.connectionManager.getActiveProfile();

    if (!profile || !this.connectionManager.isConnected(profile.id)) {
      this.statusBarItem.text = '$(database) AGE: Disconnected';
      this.statusBarItem.tooltip = 'Click to manage connections';
      this.statusBarItem.command = 'apache-age.addConnection';
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.show();
      return;
    }

    const graph = this.connectionManager.currentGraph ?? 'No graph';
    this.statusBarItem.text = `$(database) AGE: ${profile.name} / ${graph}`;
    this.statusBarItem.tooltip = `Connected to ${profile.host}:${profile.port}/${profile.database}\nGraph: ${graph}\nClick to switch graph`;
    this.statusBarItem.command = 'apache-age.switchGraph';
    this.statusBarItem.show();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
