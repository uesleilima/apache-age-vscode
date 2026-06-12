import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryExecutor } from '../../src/core/query/QueryExecutor';
import { ConnectionPool } from '../../src/core/connection/ConnectionPool';

describe('QueryExecutor', () => {
  let mockPool: {
    query: ReturnType<typeof vi.fn>;
  };
  let executor: QueryExecutor;

  beforeEach(() => {
    mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ n: { id: 1, label: 'Person', properties: { name: 'Alice' } } }],
        fields: [{ name: 'n' }],
        rowCount: 1,
        command: 'SELECT',
      }),
    };
    executor = new QueryExecutor(mockPool as unknown as ConnectionPool);
  });

  describe('execute', () => {
    it('should wrap Cypher and execute it', async () => {
      const result = await executor.execute('MATCH (n) RETURN n', 'test_graph');

      expect(mockPool.query).toHaveBeenCalledWith(
        "SELECT * FROM cypher('test_graph', $$ MATCH (n) RETURN n $$) as (\"n\" agtype);"
      );
      expect(result.rows).toHaveLength(1);
      expect(result.columns).toEqual(['n']);
      expect(result.rowCount).toBe(1);
      expect(result.command).toBe('SELECT');
    });

    it('should pass through already-wrapped SQL', async () => {
      const sql = "SELECT * FROM cypher('g', $$ MATCH (n) RETURN n $$) as (\"n\" agtype)";
      await executor.execute(sql, 'test_graph');
      expect(mockPool.query).toHaveBeenCalledWith(sql);
    });

    it('should pass through raw SQL', async () => {
      await executor.execute('SELECT 1', 'test_graph');
      expect(mockPool.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should measure execution time', async () => {
      const result = await executor.execute('MATCH (n) RETURN n', 'test_graph');
      expect(typeof result.executionTimeMs).toBe('number');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should respect autoWrap=false', async () => {
      await executor.execute('MATCH (n) RETURN n', 'test_graph', false);
      expect(mockPool.query).toHaveBeenCalledWith('MATCH (n) RETURN n');
    });

    it('should handle empty result sets', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        fields: [{ name: 'n' }],
        rowCount: 0,
        command: 'SELECT',
      });

      const result = await executor.execute('MATCH (n) RETURN n', 'test_graph');
      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);
    });

    it('should propagate query errors', async () => {
      mockPool.query.mockRejectedValue(new Error('relation not found'));
      await expect(
        executor.execute('MATCH (n) RETURN n', 'test_graph')
      ).rejects.toThrow('relation not found');
    });
  });

  describe('explain', () => {
    it('should wrap with EXPLAIN ANALYZE', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ 'QUERY PLAN': 'Seq Scan on ...' }],
        fields: [{ name: 'QUERY PLAN' }],
        rowCount: 1,
        command: 'EXPLAIN',
      });

      const result = await executor.explain('MATCH (n) RETURN n', 'test_graph');
      const calledSql = mockPool.query.mock.calls[0][0] as string;
      expect(calledSql).toMatch(/^EXPLAIN ANALYZE/);
      expect(result.command).toBe('EXPLAIN');
    });

    it('should measure explain execution time', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'EXPLAIN',
      });

      const result = await executor.explain('MATCH (n) RETURN n', 'test_graph');
      expect(typeof result.executionTimeMs).toBe('number');
    });
  });
});
