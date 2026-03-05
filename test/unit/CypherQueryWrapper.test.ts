import { describe, it, expect } from 'vitest';
import { CypherQueryWrapper } from '../../src/core/query/CypherQueryWrapper';

describe('CypherQueryWrapper', () => {
  const GRAPH = 'test_graph';

  // ── Basic Wrapping ──────────────────────────────────────────────────

  describe('wrap', () => {
    it('should wrap a simple MATCH/RETURN query', () => {
      const sql = CypherQueryWrapper.wrap('MATCH (n) RETURN n', GRAPH);
      expect(sql).toBe(
        "SELECT * FROM cypher('test_graph', $$ MATCH (n) RETURN n $$) as (n agtype);"
      );
    });

    it('should wrap a query with multiple return columns', () => {
      const sql = CypherQueryWrapper.wrap('MATCH (a)-[r]->(b) RETURN a, r, b', GRAPH);
      expect(sql).toBe(
        "SELECT * FROM cypher('test_graph', $$ MATCH (a)-[r]->(b) RETURN a, r, b $$) as (a agtype, r agtype, b agtype);"
      );
    });

    it('should use "result" column for RETURN *', () => {
      const sql = CypherQueryWrapper.wrap('MATCH (n) RETURN *', GRAPH);
      expect(sql).toBe(
        "SELECT * FROM cypher('test_graph', $$ MATCH (n) RETURN * $$) as (result agtype);"
      );
    });

    it('should trim whitespace from the query', () => {
      const sql = CypherQueryWrapper.wrap('  MATCH (n) RETURN n  ', GRAPH);
      expect(sql).toBe(
        "SELECT * FROM cypher('test_graph', $$ MATCH (n) RETURN n $$) as (n agtype);"
      );
    });

    it('should use "result" column when no RETURN clause exists', () => {
      const sql = CypherQueryWrapper.wrap("CREATE (n:Person {name: 'Alice'})", GRAPH);
      expect(sql).toContain('as (result agtype)');
    });
  });

  // ── Passthrough ─────────────────────────────────────────────────────

  describe('passthrough', () => {
    it('should pass through already-wrapped queries', () => {
      const wrapped = "SELECT * FROM cypher('g', $$ MATCH (n) RETURN n $$) as (n agtype)";
      expect(CypherQueryWrapper.wrap(wrapped, GRAPH)).toBe(wrapped);
    });

    it('should pass through SELECT queries', () => {
      const sql = 'SELECT * FROM pg_catalog.pg_tables';
      expect(CypherQueryWrapper.wrap(sql, GRAPH)).toBe(sql);
    });

    it('should pass through INSERT queries', () => {
      const sql = "INSERT INTO test VALUES (1, 'a')";
      expect(CypherQueryWrapper.wrap(sql, GRAPH)).toBe(sql);
    });

    it('should pass through UPDATE queries', () => {
      const sql = "UPDATE test SET name = 'b' WHERE id = 1";
      expect(CypherQueryWrapper.wrap(sql, GRAPH)).toBe(sql);
    });

    it('should pass through DELETE queries', () => {
      const sql = 'DELETE FROM test WHERE id = 1';
      expect(CypherQueryWrapper.wrap(sql, GRAPH)).toBe(sql);
    });

    it('should pass through CREATE EXTENSION statements', () => {
      const sql = "CREATE EXTENSION IF NOT EXISTS age";
      expect(CypherQueryWrapper.wrap(sql, GRAPH)).toBe(sql);
    });

    it('should pass through LOAD statements', () => {
      const sql = "LOAD 'age'";
      expect(CypherQueryWrapper.wrap(sql, GRAPH)).toBe(sql);
    });

    it('should pass through SET statements', () => {
      const sql = 'SET search_path = ag_catalog, public';
      expect(CypherQueryWrapper.wrap(sql, GRAPH)).toBe(sql);
    });

    it('should pass through EXPLAIN ANALYZE statements', () => {
      const sql = 'EXPLAIN ANALYZE SELECT 1';
      expect(CypherQueryWrapper.wrap(sql, GRAPH)).toBe(sql);
    });

    it('should pass through when autoWrap is false', () => {
      const cypher = 'MATCH (n) RETURN n';
      expect(CypherQueryWrapper.wrap(cypher, GRAPH, false)).toBe(cypher);
    });
  });

  // ── Return Column Extraction ────────────────────────────────────────

  describe('extractReturnColumns', () => {
    it('should extract a single variable', () => {
      expect(CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN n')).toEqual(['n']);
    });

    it('should extract multiple variables', () => {
      expect(
        CypherQueryWrapper.extractReturnColumns('MATCH (a)-[r]->(b) RETURN a, r, b')
      ).toEqual(['a', 'r', 'b']);
    });

    it('should extract AS aliases', () => {
      expect(
        CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN n.name AS name, n.age AS age')
      ).toEqual(['name', 'age']);
    });

    it('should handle function calls with AS alias', () => {
      expect(
        CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN count(n) AS total')
      ).toEqual(['total']);
    });

    it('should handle RETURN * as generic result', () => {
      expect(CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN *')).toEqual(['result']);
    });

    it('should handle property access without alias', () => {
      expect(
        CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN n.name')
      ).toEqual(['name']);
    });

    it('should return ["result"] when no RETURN clause exists', () => {
      expect(CypherQueryWrapper.extractReturnColumns("CREATE (n:Person)")).toEqual(['result']);
    });

    it('should handle RETURN with ORDER BY', () => {
      expect(
        CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN n ORDER BY n.name')
      ).toEqual(['n']);
    });

    it('should handle RETURN with LIMIT', () => {
      expect(
        CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN n LIMIT 10')
      ).toEqual(['n']);
    });

    it('should handle RETURN with SKIP', () => {
      expect(
        CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN n SKIP 5')
      ).toEqual(['n']);
    });

    it('should handle mixed aliases and variables', () => {
      expect(
        CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN n, n.name AS name, count(n) AS total')
      ).toEqual(['n', 'name', 'total']);
    });

    it('should generate fallback column names for complex expressions', () => {
      // Function call without AS alias → fallback
      const cols = CypherQueryWrapper.extractReturnColumns('MATCH (n) RETURN count(n)');
      expect(cols).toHaveLength(1);
      expect(cols[0]).toMatch(/^col\d+$/);
    });
  });

  // ── Graph Name Escaping ─────────────────────────────────────────────

  describe('graph name escaping', () => {
    it('should escape single quotes in graph name', () => {
      const sql = CypherQueryWrapper.wrap('MATCH (n) RETURN n', "test'graph");
      expect(sql).toContain("test''graph");
    });

    it('should handle normal graph names', () => {
      const sql = CypherQueryWrapper.wrap('MATCH (n) RETURN n', 'my_graph');
      expect(sql).toContain("'my_graph'");
    });
  });

  // ── EXPLAIN Wrapping ────────────────────────────────────────────────

  describe('wrapExplain', () => {
    it('should prepend EXPLAIN ANALYZE to a wrapped Cypher query', () => {
      const sql = CypherQueryWrapper.wrapExplain('MATCH (n) RETURN n', GRAPH);
      expect(sql).toMatch(/^EXPLAIN ANALYZE SELECT \* FROM cypher/);
    });

    it('should prepend EXPLAIN ANALYZE to raw SQL passthrough', () => {
      const sql = CypherQueryWrapper.wrapExplain('SELECT 1', GRAPH);
      expect(sql).toBe('EXPLAIN ANALYZE SELECT 1');
    });
  });
});
