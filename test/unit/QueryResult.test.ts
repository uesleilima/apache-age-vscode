import { describe, it, expect } from 'vitest';
import {
  isAgeVertex,
  isAgeEdge,
  isAgePath,
  extractGraphElements,
  AgeVertex,
  AgeEdge,
} from '../../src/core/query/QueryResult';

// ── Test Fixtures ─────────────────────────────────────────────────────

function makeVertex(oid: number, id: number, label: string, props: Record<string, unknown> = {}): AgeVertex {
  return { id: { oid, id }, label, properties: props };
}

function makeEdge(oid: number, id: number, label: string, startOid: number, startId: number, endOid: number, endId: number, props: Record<string, unknown> = {}): AgeEdge {
  return { id: { oid, id }, label, start_id: { oid: startOid, id: startId }, end_id: { oid: endOid, id: endId }, properties: props };
}

// ── Type Guards ───────────────────────────────────────────────────────

describe('isAgeVertex', () => {
  it('should return true for a valid vertex', () => {
    expect(isAgeVertex(makeVertex(1, 1, 'Person'))).toBe(true);
  });

  it('should return false for an edge', () => {
    expect(isAgeVertex(makeEdge(2, 1, 'KNOWS', 1, 1, 1, 2))).toBe(false);
  });

  it('should return false for null', () => {
    expect(isAgeVertex(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isAgeVertex(undefined)).toBe(false);
  });

  it('should return false for a primitive', () => {
    expect(isAgeVertex(42)).toBe(false);
  });

  it('should return false for object missing required fields', () => {
    expect(isAgeVertex({ id: 1, label: 'X' })).toBe(false);
  });

  it('should return true for vertex with extra properties', () => {
    const v = { ...makeVertex(1, 1, 'Person'), __type: 'vertex' };
    expect(isAgeVertex(v)).toBe(true);
  });
});

describe('isAgeEdge', () => {
  it('should return true for a valid edge', () => {
    expect(isAgeEdge(makeEdge(2, 1, 'KNOWS', 1, 1, 1, 2))).toBe(true);
  });

  it('should return false for a vertex', () => {
    expect(isAgeEdge(makeVertex(1, 1, 'Person'))).toBe(false);
  });

  it('should return false for null', () => {
    expect(isAgeEdge(null)).toBe(false);
  });

  it('should return false for a primitive', () => {
    expect(isAgeEdge('not an edge')).toBe(false);
  });

  it('should return false for an object missing start_id', () => {
    expect(isAgeEdge({ id: { oid: 1, id: 1 }, label: 'R', end_id: { oid: 1, id: 2 }, properties: {} })).toBe(false);
  });
});

describe('isAgePath', () => {
  it('should return true for a path (array starting with vertex)', () => {
    const path = [
      makeVertex(1, 1, 'A'),
      makeEdge(2, 1, 'R', 1, 1, 1, 2),
      makeVertex(1, 2, 'B'),
    ];
    expect(isAgePath(path)).toBe(true);
  });

  it('should return false for an empty array', () => {
    expect(isAgePath([])).toBe(false);
  });

  it('should return false for an array starting with edge', () => {
    expect(isAgePath([makeEdge(2, 1, 'R', 1, 1, 1, 2)])).toBe(false);
  });

  it('should return false for non-array', () => {
    expect(isAgePath('not a path')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isAgePath(null)).toBe(false);
  });
});

// ── extractGraphElements ──────────────────────────────────────────────

describe('extractGraphElements', () => {
  it('should extract vertices from rows', () => {
    const v1 = makeVertex(1, 1, 'Person', { name: 'Alice' });
    const v2 = makeVertex(1, 2, 'Person', { name: 'Bob' });
    const rows = [{ n: v1 }, { n: v2 }];

    const { vertices, edges } = extractGraphElements(rows);
    expect(vertices).toHaveLength(2);
    expect(edges).toHaveLength(0);
    expect(vertices[0].properties.name).toBe('Alice');
    expect(vertices[1].properties.name).toBe('Bob');
  });

  it('should extract edges from rows', () => {
    const e = makeEdge(2, 1, 'KNOWS', 1, 1, 1, 2, { since: 2020 });
    const rows = [{ r: e }];

    const { vertices, edges } = extractGraphElements(rows);
    expect(vertices).toHaveLength(0);
    expect(edges).toHaveLength(1);
    expect(edges[0].label).toBe('KNOWS');
  });

  it('should extract both vertices and edges', () => {
    const v1 = makeVertex(1, 1, 'Person');
    const v2 = makeVertex(1, 2, 'Person');
    const e = makeEdge(2, 1, 'KNOWS', 1, 1, 1, 2);
    const rows = [{ a: v1, r: e, b: v2 }];

    const { vertices, edges } = extractGraphElements(rows);
    expect(vertices).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it('should deduplicate vertices by id', () => {
    const v = makeVertex(1, 1, 'Person');
    const rows = [{ n: v }, { n: v }];

    const { vertices } = extractGraphElements(rows);
    expect(vertices).toHaveLength(1);
  });

  it('should deduplicate edges by id', () => {
    const e = makeEdge(2, 1, 'KNOWS', 1, 1, 1, 2);
    const rows = [{ r: e }, { r: e }];

    const { edges } = extractGraphElements(rows);
    expect(edges).toHaveLength(1);
  });

  it('should extract elements from paths', () => {
    const v1 = makeVertex(1, 1, 'A');
    const e = makeEdge(2, 1, 'R', 1, 1, 1, 2);
    const v2 = makeVertex(1, 2, 'B');
    const path = [v1, e, v2];
    // Mark as path (starts with vertex, which is what isAgePath checks)
    const rows = [{ p: path }];

    const { vertices, edges } = extractGraphElements(rows);
    expect(vertices).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it('should handle empty rows', () => {
    const { vertices, edges } = extractGraphElements([]);
    expect(vertices).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('should skip non-graph values', () => {
    const rows = [{ count: 42, name: 'Alice' }];
    const { vertices, edges } = extractGraphElements(rows);
    expect(vertices).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('should handle nested arrays', () => {
    const v1 = makeVertex(1, 1, 'A');
    const v2 = makeVertex(1, 2, 'B');
    const rows = [{ nodes: [v1, v2] }];

    // isAgePath checks first element is vertex, so [v1, v2] is treated as path
    const { vertices } = extractGraphElements(rows);
    expect(vertices).toHaveLength(2);
  });

  it('should handle mixed graph and scalar values in same row', () => {
    const v = makeVertex(1, 1, 'Person', { name: 'Alice' });
    const rows = [{ n: v, name: 'Alice', age: 30 }];

    const { vertices, edges } = extractGraphElements(rows);
    expect(vertices).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });
});
