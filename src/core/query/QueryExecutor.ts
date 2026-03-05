import { ConnectionPool } from '../connection/ConnectionPool';
import { CypherQueryWrapper } from './CypherQueryWrapper';
import { QueryResult } from './QueryResult';

/**
 * Executes Cypher queries against an Apache AGE database.
 *
 * Acts as the bridge between the user's Cypher text and the database,
 * handling wrapping, execution, timing, and result formatting.
 */
export class QueryExecutor {
  constructor(private readonly pool: ConnectionPool) {}

  /**
   * Execute a Cypher query (or raw SQL) and return structured results.
   *
   * @param query - Raw Cypher or SQL
   * @param graphName - Target graph name (used for auto-wrapping)
   * @param autoWrap - Whether to auto-wrap Cypher in SQL
   */
  async execute(query: string, graphName: string, autoWrap: boolean = true): Promise<QueryResult> {
    const sql = CypherQueryWrapper.wrap(query, graphName, autoWrap);

    const startTime = performance.now();
    const result = await this.pool.query(sql);
    const executionTimeMs = Math.round(performance.now() - startTime);

    return {
      rows: result.rows,
      columns: result.fields.map((f) => f.name),
      rowCount: result.rowCount,
      executionTimeMs,
      command: result.command,
    };
  }

  /**
   * Execute with EXPLAIN ANALYZE for query plan analysis.
   */
  async explain(query: string, graphName: string): Promise<QueryResult> {
    const sql = CypherQueryWrapper.wrapExplain(query, graphName);

    const startTime = performance.now();
    const result = await this.pool.query(sql);
    const executionTimeMs = Math.round(performance.now() - startTime);

    return {
      rows: result.rows,
      columns: result.fields.map((f) => f.name),
      rowCount: result.rowCount,
      executionTimeMs,
      command: result.command,
    };
  }
}
