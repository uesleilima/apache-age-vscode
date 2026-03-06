import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchemaRepository } from '../../src/core/schema/SchemaRepository';
import { ConnectionPool } from '../../src/core/connection/ConnectionPool';
import { SqlTemplates } from '../../src/utils/SqlTemplates';

describe('SchemaRepository', () => {
  let mockPool: {
    query: ReturnType<typeof vi.fn>;
    majorVersion: number;
  };
  let mockSql: {
    get: ReturnType<typeof vi.fn>;
  };
  let repo: SchemaRepository;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
      majorVersion: 15,
    };
    mockSql = {
      get: vi.fn().mockReturnValue('SELECT 1'),
    };
    repo = new SchemaRepository(
      mockPool as unknown as ConnectionPool,
      mockSql as unknown as SqlTemplates,
    );
  });

  describe('getGraphNames', () => {
    it('should return list of graphs', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { oid: 1, name: 'graph1', namespace: 100 },
          { oid: 2, name: 'graph2', namespace: 100 },
        ],
      });

      const graphs = await repo.getGraphNames();
      expect(graphs).toEqual([
        { oid: 1, name: 'graph1', namespace: 100 },
        { oid: 2, name: 'graph2', namespace: 100 },
      ]);
      expect(mockSql.get).toHaveBeenCalledWith('getGraphNames');
    });

    it('should return empty array when no graphs exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const graphs = await repo.getGraphNames();
      expect(graphs).toEqual([]);
    });
  });

  describe('getLabels', () => {
    it('should separate nodes and edges', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { label: 'Person', kind: 'v', cnt: 10 },
          { label: 'KNOWS', kind: 'e', cnt: 5 },
          { label: 'City', kind: 'v', cnt: 3 },
        ],
      });

      const { nodes, edges } = await repo.getLabels('test_graph');
      expect(nodes).toHaveLength(2);
      expect(edges).toHaveLength(1);
      expect(nodes[0]).toEqual({ name: 'Person', kind: 'v', count: 10 });
      expect(edges[0]).toEqual({ name: 'KNOWS', kind: 'e', count: 5 });
    });

    it('should filter out internal AGE labels', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { label: 'Person', kind: 'v', cnt: 10 },
          { label: '_ag_label_vertex', kind: 'v', cnt: 0 },
          { label: '_ag_label_edge', kind: 'e', cnt: 0 },
        ],
      });

      const { nodes, edges } = await repo.getLabels('test_graph');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe('Person');
      expect(edges).toHaveLength(0);
    });

    it('should use version-appropriate metadata query', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await repo.getLabels('test_graph');
      expect(mockSql.get).toHaveBeenCalledWith('getMetaData', 'test_graph');
    });

    it('should round counts', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ label: 'Person', kind: 'v', cnt: 10.7 }],
      });

      const { nodes } = await repo.getLabels('test_graph');
      expect(nodes[0].count).toBe(11);
    });

    it('should handle missing count gracefully', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ label: 'Person', kind: 'v' }],
      });

      const { nodes } = await repo.getLabels('test_graph');
      expect(nodes[0].count).toBe(0);
    });

    it('should handle name field fallback', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ name: 'Person', kind: 'v', cnt: 5 }],
      });

      const { nodes } = await repo.getLabels('test_graph');
      expect(nodes[0].name).toBe('Person');
    });
  });

  describe('getMetadata', () => {
    it('should return full metadata', async () => {
      // First call: analyzeGraph, second call: getLabels
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // analyzeGraph
        .mockResolvedValueOnce({
          rows: [
            { label: 'Person', kind: 'v', cnt: 10 },
            { label: 'KNOWS', kind: 'e', cnt: 5 },
          ],
        });

      const metadata = await repo.getMetadata('test_graph', 'testdb');
      expect(metadata.graph).toBe('test_graph');
      expect(metadata.database).toBe('testdb');
      expect(metadata.nodes).toHaveLength(1);
      expect(metadata.edges).toHaveLength(1);
    });

    it('should succeed even if ANALYZE fails', async () => {
      mockPool.query
        .mockRejectedValueOnce(new Error('permission denied')) // analyzeGraph fails
        .mockResolvedValueOnce({
          rows: [{ label: 'Person', kind: 'v', cnt: 5 }],
        });

      const metadata = await repo.getMetadata('test_graph', 'testdb');
      expect(metadata.nodes).toHaveLength(1);
    });
  });

  describe('getRole', () => {
    it('should return the user role', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ role: 'admin' }],
      });

      const role = await repo.getRole('testuser');
      expect(role).toBe('admin');
      expect(mockPool.query).toHaveBeenCalledWith('SELECT 1', ['testuser']);
    });

    it('should default to "user" when no role found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const role = await repo.getRole('testuser');
      expect(role).toBe('user');
    });
  });
});
