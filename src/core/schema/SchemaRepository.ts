import { ConnectionPool } from '../connection/ConnectionPool';
import { SqlTemplates } from '../../utils/SqlTemplates';
import { GraphInfo, LabelInfo, GraphMetadata } from './SchemaTypes';

const INTERNAL_LABELS = ['_ag_label_vertex', '_ag_label_edge'];

/**
 * Queries AGE catalog tables for graph schema information.
 *
 * Provides methods to:
 * - List graphs in the database
 * - Retrieve node/edge labels and their counts
 * - Build full metadata for the schema explorer
 */
export class SchemaRepository {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly sql: SqlTemplates,
  ) {}

  /**
   * List all graphs in the connected AGE database.
   */
  async getGraphNames(): Promise<GraphInfo[]> {
    const result = await this.pool.query(this.sql.get('getGraphNames'));
    return result.rows.map((row) => ({
      oid: row.oid as number,
      name: row.name as string,
      namespace: row.namespace as number,
    }));
  }

  /**
   * Get labels for a specific graph, separated into nodes and edges.
   */
  async getLabels(graphName: string): Promise<{ nodes: LabelInfo[]; edges: LabelInfo[] }> {
    const pgMajor = this.pool.majorVersion;
    const result = await this.pool.query(this.sql.getMetaData(graphName, pgMajor));

    const nodes: LabelInfo[] = [];
    const edges: LabelInfo[] = [];

    for (const row of result.rows) {
      const name = row.label as string ?? row.name as string;
      const kind = row.kind as 'v' | 'e';
      const count = Math.round(row.cnt as number ?? 0);

      // Skip internal AGE labels
      if (INTERNAL_LABELS.includes(name)) continue;

      const info: LabelInfo = { name, kind, count };
      if (kind === 'v') {
        nodes.push(info);
      } else if (kind === 'e') {
        edges.push(info);
      }
    }

    return { nodes, edges };
  }

  /**
   * Get full metadata for a graph (labels + counts).
   */
  async getMetadata(graphName: string, database: string): Promise<GraphMetadata> {
    // Run ANALYZE first to get fresh statistics
    try {
      await this.pool.query(this.sql.get('analyzeGraph'));
    } catch {
      // ANALYZE might fail for non-superusers, that's OK
    }

    const { nodes, edges } = await this.getLabels(graphName);

    return {
      graph: graphName,
      database,
      nodes,
      edges,
    };
  }

  /**
   * Get the role of the current user (admin or user).
   */
  async getRole(username: string): Promise<string> {
    const result = await this.pool.query(this.sql.get('getRole'), [username]);
    return result.rows[0]?.role as string ?? 'user';
  }
}
