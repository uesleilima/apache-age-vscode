/**
 * Wraps raw Cypher queries into SQL that AGE understands.
 *
 * AGE requires Cypher to be passed inside a SQL function call:
 *   SELECT * FROM cypher('graph_name', $$ MATCH (n) RETURN n $$) as (col agtype);
 *
 * This class handles:
 * - Auto-detection of already-wrapped queries (pass-through)
 * - Smart return column extraction from RETURN clauses
 * - Dollar-quoting for safe Cypher embedding
 */
export class CypherQueryWrapper {
  /**
   * Regex to detect if query is already wrapped in SELECT * FROM cypher(...)
   */
  private static readonly ALREADY_WRAPPED = /^\s*SELECT\s+.*\s+FROM\s+(\w+\.)?cypher\s*\(/i;

  /**
   * Regex to detect raw SQL (non-Cypher) queries
   */
  private static readonly RAW_SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE\s+EXTENSION|LOAD|SET|SHOW|ALTER|DROP\s+(?!GRAPH)|ANALYZE|EXPLAIN\s+ANALYZE)\b/i;

  /**
   * Wrap a Cypher query for execution against AGE.
   *
   * @param cypher - The raw Cypher query (or already-wrapped SQL)
   * @param graphName - The target graph name
   * @param autoWrap - Whether to auto-wrap (can be disabled for raw SQL mode)
   * @returns The final SQL string to execute
   */
  static wrap(cypher: string, graphName: string, autoWrap: boolean = true): string {
    const trimmed = cypher.trim();

    // Already wrapped — pass through
    if (this.ALREADY_WRAPPED.test(trimmed)) {
      return trimmed;
    }

    // Raw SQL — pass through
    if (this.RAW_SQL.test(trimmed)) {
      return trimmed;
    }

    // Auto-wrap disabled — pass through
    if (!autoWrap) {
      return trimmed;
    }

    // Extract return column aliases for the AS clause
    const columns = this.extractReturnColumns(trimmed);
    const asCols = columns.length > 0
      ? columns.map((c) => `${c} agtype`).join(', ')
      : 'result agtype';

    return `SELECT * FROM cypher('${this.escapeGraphName(graphName)}', $$ ${trimmed} $$) as (${asCols});`;
  }

  /**
   * Parse RETURN clause to extract column aliases.
   *
   * Examples:
   *   "MATCH (n) RETURN n"                     → ["n"]
   *   "MATCH (a)-[r]->(b) RETURN a, r, b"      → ["a", "r", "b"]
   *   "MATCH (n) RETURN n.name AS name"         → ["name"]
   *   "MATCH (n) RETURN count(n) AS total"      → ["total"]
   *   "MATCH (n) RETURN *"                      → ["result"]
   */
  static extractReturnColumns(cypher: string): string[] {
    // Find the last RETURN clause (could be multiple in UNION queries)
    const returnMatch = cypher.match(/\bRETURN\b\s+([\s\S]*?)(?:\bORDER\b|\bSKIP\b|\bLIMIT\b|\bUNION\b|;?\s*$)/i);
    if (!returnMatch) return ['result'];

    const returnClause = returnMatch[1].trim();

    // RETURN * → single generic column
    if (returnClause === '*') return ['result'];

    // Split by comma, then extract alias (the part after AS, or the last identifier)
    const parts = this.splitReturnItems(returnClause);
    const columns: string[] = [];

    for (const part of parts) {
      const trimmedPart = part.trim();
      if (!trimmedPart) continue;

      // Check for explicit AS alias
      const asMatch = trimmedPart.match(/\bAS\s+(\w+)\s*$/i);
      if (asMatch) {
        columns.push(asMatch[1]);
        continue;
      }

      // Use the expression itself as the column name
      // For simple identifiers like n, r, b
      const simpleIdent = trimmedPart.match(/^(\w+)$/);
      if (simpleIdent) {
        columns.push(simpleIdent[1]);
        continue;
      }

      // For property access like n.name
      const propAccess = trimmedPart.match(/^(\w+)\.(\w+)$/);
      if (propAccess) {
        columns.push(propAccess[2]);
        continue;
      }

      // Fallback: generate a column name
      columns.push(`col${columns.length + 1}`);
    }

    return columns.length > 0 ? columns : ['result'];
  }

  /**
   * Split RETURN items by comma, respecting parentheses depth.
   * e.g., "count(n), n.name" → ["count(n)", "n.name"]
   */
  private static splitReturnItems(clause: string): string[] {
    const items: string[] = [];
    let current = '';
    let depth = 0;

    for (const ch of clause) {
      if (ch === '(') {
        depth++;
        current += ch;
      } else if (ch === ')') {
        depth--;
        current += ch;
      } else if (ch === ',' && depth === 0) {
        items.push(current);
        current = '';
      } else {
        current += ch;
      }
    }

    if (current.trim()) {
      items.push(current);
    }

    return items;
  }

  /**
   * Escape a graph name to prevent SQL injection in the cypher() call.
   */
  private static escapeGraphName(name: string): string {
    return name.replace(/'/g, "''");
  }

  /**
   * Wrap a Cypher query with EXPLAIN (for query plan analysis).
   */
  static wrapExplain(cypher: string, graphName: string): string {
    const wrapped = this.wrap(cypher, graphName);
    // If it starts with SELECT, prepend EXPLAIN ANALYZE
    if (/^\s*SELECT/i.test(wrapped)) {
      return `EXPLAIN ANALYZE ${wrapped}`;
    }
    return `EXPLAIN ANALYZE ${wrapped}`;
  }
}
