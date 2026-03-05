import * as vscode from 'vscode';

const SECRET_PREFIX = 'apache-age.connection.';

/**
 * Thin wrapper around VS Code's SecretStorage API.
 * Stores connection passwords keyed by connection ID.
 */
export class SecretStorage {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getPassword(connectionId: string): Promise<string | undefined> {
    return this.secrets.get(`${SECRET_PREFIX}${connectionId}`);
  }

  async setPassword(connectionId: string, password: string): Promise<void> {
    await this.secrets.store(`${SECRET_PREFIX}${connectionId}`, password);
  }

  async deletePassword(connectionId: string): Promise<void> {
    await this.secrets.delete(`${SECRET_PREFIX}${connectionId}`);
  }
}
