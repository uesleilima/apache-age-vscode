import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import {
  ConnectionProfile,
  ConnectionCredentials,
  DEFAULT_POOL_CONFIG,
} from './ConnectionConfig';
import { ConnectionPool } from './ConnectionPool';
import { SecretStorage } from '../../utils/SecretStorage';

const CONNECTIONS_KEY = 'apache-age.connections';

/**
 * Manages connection profiles and active connection pools.
 *
 * Responsibilities:
 * - CRUD for connection profiles (stored in globalState + SecretStorage)
 * - Active pool lifecycle management
 * - Graph selection on the active connection
 *
 * Emits events when connections change so UI providers can refresh.
 */
export class ConnectionManager implements vscode.Disposable {
  private readonly pools = new Map<string, ConnectionPool>();
  private activeConnectionId: string | null = null;
  private activeGraph: string | null = null;

  private readonly _onDidChangeConnections = new vscode.EventEmitter<void>();
  readonly onDidChangeConnections = this._onDidChangeConnections.event;

  private readonly _onDidChangeActiveConnection = new vscode.EventEmitter<void>();
  readonly onDidChangeActiveConnection = this._onDidChangeActiveConnection.event;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secretStorage: SecretStorage,
  ) {}

  // ---------- Profile CRUD ----------

  getProfiles(): ConnectionProfile[] {
    return this.globalState.get<ConnectionProfile[]>(CONNECTIONS_KEY, []);
  }

  async addProfile(config: ConnectionCredentials): Promise<ConnectionProfile> {
    const profile: ConnectionProfile = {
      id: uuidv4(),
      name: config.name,
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      graph: config.graph,
    };

    const profiles = this.getProfiles();
    profiles.push(profile);
    await this.globalState.update(CONNECTIONS_KEY, profiles);
    await this.secretStorage.setPassword(profile.id, config.password);

    this._onDidChangeConnections.fire();
    return profile;
  }

  async updateProfile(id: string, config: Partial<ConnectionCredentials>): Promise<void> {
    const profiles = this.getProfiles();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Connection profile not found: ${id}`);

    const existing = profiles[idx];
    profiles[idx] = {
      ...existing,
      name: config.name ?? existing.name,
      host: config.host ?? existing.host,
      port: config.port ?? existing.port,
      database: config.database ?? existing.database,
      user: config.user ?? existing.user,
      graph: config.graph ?? existing.graph,
    };

    await this.globalState.update(CONNECTIONS_KEY, profiles);

    if (config.password !== undefined) {
      await this.secretStorage.setPassword(id, config.password);
    }

    this._onDidChangeConnections.fire();
  }

  async removeProfile(id: string): Promise<void> {
    // Disconnect first if active
    if (this.pools.has(id)) {
      await this.disconnect(id);
    }

    const profiles = this.getProfiles().filter((p) => p.id !== id);
    await this.globalState.update(CONNECTIONS_KEY, profiles);
    await this.secretStorage.deletePassword(id);

    if (this.activeConnectionId === id) {
      this.activeConnectionId = null;
      this.activeGraph = null;
      this._onDidChangeActiveConnection.fire();
    }

    this._onDidChangeConnections.fire();
  }

  // ---------- Connection lifecycle ----------

  async connect(id: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.id === id);
    if (!profile) throw new Error(`Connection profile not found: ${id}`);

    const password = await this.secretStorage.getPassword(id);
    if (password === undefined) throw new Error('Password not found for this connection');

    const credentials: ConnectionCredentials = {
      ...profile,
      password,
    };

    const config = vscode.workspace.getConfiguration('apache-age');
    const poolConfig = {
      max: config.get<number>('pool.maxConnections', DEFAULT_POOL_CONFIG.max),
      idleTimeoutMillis: config.get<number>('pool.idleTimeoutMs', DEFAULT_POOL_CONFIG.idleTimeoutMillis),
      connectionTimeoutMillis: DEFAULT_POOL_CONFIG.connectionTimeoutMillis,
    };

    const pool = new ConnectionPool(credentials, poolConfig);
    await pool.connect();

    // Disconnect previous pool for this profile if any
    const existingPool = this.pools.get(id);
    if (existingPool) {
      await existingPool.disconnect();
    }

    this.pools.set(id, pool);
    this.activeConnectionId = id;
    this.activeGraph = profile.graph ?? null;

    this._onDidChangeActiveConnection.fire();
    this._onDidChangeConnections.fire();
  }

  async disconnect(id: string): Promise<void> {
    const pool = this.pools.get(id);
    if (pool) {
      await pool.disconnect();
      this.pools.delete(id);
    }

    if (this.activeConnectionId === id) {
      this.activeConnectionId = null;
      this.activeGraph = null;
      this._onDidChangeActiveConnection.fire();
    }

    this._onDidChangeConnections.fire();
  }

  async disconnectAll(): Promise<void> {
    for (const [id, pool] of this.pools) {
      await pool.disconnect();
    }
    this.pools.clear();
    this.activeConnectionId = null;
    this.activeGraph = null;
    this._onDidChangeActiveConnection.fire();
    this._onDidChangeConnections.fire();
  }

  // ---------- Active connection ----------

  getActivePool(): ConnectionPool | null {
    if (!this.activeConnectionId) return null;
    return this.pools.get(this.activeConnectionId) ?? null;
  }

  getActiveProfile(): ConnectionProfile | null {
    if (!this.activeConnectionId) return null;
    return this.getProfiles().find((p) => p.id === this.activeConnectionId) ?? null;
  }

  isConnected(id: string): boolean {
    const pool = this.pools.get(id);
    return pool?.isConnected ?? false;
  }

  get activeId(): string | null {
    return this.activeConnectionId;
  }

  get currentGraph(): string | null {
    return this.activeGraph;
  }

  async setCurrentGraph(graph: string): Promise<void> {
    this.activeGraph = graph;

    // Also persist the graph selection to the profile
    if (this.activeConnectionId) {
      await this.updateProfile(this.activeConnectionId, { graph });
    }

    this._onDidChangeActiveConnection.fire();
  }

  getServerVersion(id: string): string | null {
    return this.pools.get(id)?.version ?? null;
  }

  getMajorVersion(id: string): number {
    return this.pools.get(id)?.majorVersion ?? 0;
  }

  // ---------- Disposable ----------

  dispose(): void {
    this.disconnectAll().catch(console.error);
    this._onDidChangeConnections.dispose();
    this._onDidChangeActiveConnection.dispose();
  }
}
