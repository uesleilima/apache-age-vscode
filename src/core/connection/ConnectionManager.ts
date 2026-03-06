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

  /** Per-connection selected graph. */
  private readonly connectionActiveGraph = new Map<string, string | null>();
  /** Per-connection available graphs list. */
  private readonly connectionGraphs = new Map<string, string[]>();

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
      managedServer: config.managedServer,
      sslMode: config.sslMode,
      sslCaCertPath: config.sslCaCertPath,
      proxyUrl: config.proxyUrl,
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
      managedServer: config.managedServer ?? existing.managedServer,
      sslMode: config.sslMode ?? existing.sslMode,
      sslCaCertPath: config.sslCaCertPath ?? existing.sslCaCertPath,
      proxyUrl: config.proxyUrl ?? existing.proxyUrl,
    };

    await this.globalState.update(CONNECTIONS_KEY, profiles);

    if (config.password !== undefined) {
      await this.secretStorage.setPassword(id, config.password);
    }

    this._onDidChangeConnections.fire();
  }

  /**
   * Retrieves the stored password for a connection profile.
   *
   * @param id - Profile identifier
   * @returns The password, or undefined if not found
   */
  async getProfilePassword(id: string): Promise<string | undefined> {
    return this.secretStorage.getPassword(id);
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

    // Restore per-connection graph from profile if not already tracked
    if (!this.connectionActiveGraph.has(id)) {
      this.connectionActiveGraph.set(id, profile.graph ?? null);
    }

    this._onDidChangeActiveConnection.fire();
    this._onDidChangeConnections.fire();
  }

  async disconnect(id: string): Promise<void> {
    const pool = this.pools.get(id);
    if (pool) {
      await pool.disconnect();
      this.pools.delete(id);
    }

    // Clean up per-connection graph state
    this.connectionGraphs.delete(id);
    this.connectionActiveGraph.delete(id);

    if (this.activeConnectionId === id) {
      this.activeConnectionId = null;
      this._onDidChangeActiveConnection.fire();
    }

    this._onDidChangeConnections.fire();
  }

  async disconnectAll(): Promise<void> {
    for (const [id, pool] of this.pools) {
      await pool.disconnect();
    }
    this.pools.clear();
    this.connectionGraphs.clear();
    this.connectionActiveGraph.clear();
    this.activeConnectionId = null;
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
    if (!this.activeConnectionId) return null;
    return this.connectionActiveGraph.get(this.activeConnectionId) ?? null;
  }

  /**
   * Returns the selected graph for a specific connection (or the active connection if no id given).
   */
  getConnectionGraph(id?: string): string | null {
    const connectionId = id ?? this.activeConnectionId;
    if (!connectionId) return null;
    return this.connectionActiveGraph.get(connectionId) ?? null;
  }

  /** Returns the list of available graphs for a specific connection (or the active connection). */
  getAvailableGraphs(id?: string): string[] {
    const connectionId = id ?? this.activeConnectionId;
    if (!connectionId) return [];
    return this.connectionGraphs.get(connectionId) ?? [];
  }

  /** Updates the list of available graphs for a specific connection (or the active connection). */
  setAvailableGraphs(graphs: string[], id?: string): void {
    const connectionId = id ?? this.activeConnectionId;
    if (!connectionId) return;
    this.connectionGraphs.set(connectionId, graphs);
    this._onDidChangeConnections.fire();
  }

  async setCurrentGraph(graph: string, id?: string): Promise<void> {
    const connectionId = id ?? this.activeConnectionId;
    if (!connectionId) return;
    this.connectionActiveGraph.set(connectionId, graph);

    // Also persist the graph selection to the profile
    await this.updateProfile(connectionId, { graph });

    // Only notify active connection change if it affects the active connection
    if (connectionId === this.activeConnectionId) {
      this._onDidChangeActiveConnection.fire();
    }
  }

  /**
   * Switch which connected pool is the active one (for queries and schema).
   * The connection must already be open.
   */
  async setActiveConnection(id: string): Promise<void> {
    if (!this.pools.has(id)) {
      throw new Error('Cannot activate a connection that is not open');
    }
    if (this.activeConnectionId === id) return;
    this.activeConnectionId = id;
    this._onDidChangeActiveConnection.fire();
    this._onDidChangeConnections.fire();
  }

  /** Returns the connection pool for a specific connection id. */
  getPool(id: string): ConnectionPool | null {
    return this.pools.get(id) ?? null;
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
