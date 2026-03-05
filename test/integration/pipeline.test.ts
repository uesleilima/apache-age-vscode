import { describe, it, expect } from 'vitest';
import { deserializeAgtype } from '../../src/core/parser/AgtypeDeserializer';
import { CypherQueryWrapper } from '../../src/core/query/CypherQueryWrapper';
import {
  extractGraphElements,
  isAgeVertex,
  isAgeEdge,
  isAgePath,
} from '../../src/core/query/QueryResult';

/**
 * Integration tests that verify the full pipeline:
 *   raw agtype string → parser → deserialized object → type guards → graph extraction
 *
 * These tests simulate receiving AGE query results and processing them
 * through the extension's core modules end-to-end.
 */
describe('Parser → QueryResult pipeline', () => {
  it('should parse a vertex and identify it with type guard', () => {
    const raw = '{"id": {"oid": 844424930131969, "id": 1}, "label": "Person", "properties": {"name": "Alice", "age": 30}}::vertex';
    const parsed = deserializeAgtype(raw);

    expect(isAgeVertex(parsed)).toBe(true);
    expect(isAgeEdge(parsed)).toBe(false);
  });

  it('should parse an edge and identify it with type guard', () => {
    const raw = '{"id": {"oid": 1125899906842625, "id": 1}, "label": "KNOWS", "start_id": {"oid": 844424930131969, "id": 1}, "end_id": {"oid": 844424930131969, "id": 2}, "properties": {"since": 2020}}::edge';
    const parsed = deserializeAgtype(raw);

    expect(isAgeEdge(parsed)).toBe(true);
    expect(isAgeVertex(parsed)).toBe(false);
  });

  it('should parse a path and extract vertices and edges', () => {
    const v1 = '{"id": {"oid": 1, "id": 1}, "label": "Person", "properties": {"name": "Alice"}}::vertex';
    const e = '{"id": {"oid": 2, "id": 1}, "label": "KNOWS", "start_id": {"oid": 1, "id": 1}, "end_id": {"oid": 1, "id": 2}, "properties": {"since": 2020}}::edge';
    const v2 = '{"id": {"oid": 1, "id": 2}, "label": "Person", "properties": {"name": "Bob"}}::vertex';
    const pathRaw = `[${v1}, ${e}, ${v2}]::path`;

    const parsed = deserializeAgtype(pathRaw) as unknown[];
    expect(isAgePath(parsed)).toBe(true);

    // Simulate a row from AGE result
    const rows = [{ p: parsed }];
    const { vertices, edges } = extractGraphElements(rows);

    expect(vertices).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(vertices[0].properties.name).toBe('Alice');
    expect(vertices[1].properties.name).toBe('Bob');
    expect(edges[0].label).toBe('KNOWS');
    expect((edges[0].properties as Record<string, unknown>).since).toBe(2020);
  });

  it('should handle multi-column results with vertices and edges', () => {
    const v1Raw = '{"id": {"oid": 1, "id": 1}, "label": "Person", "properties": {"name": "Alice"}}::vertex';
    const eRaw = '{"id": {"oid": 2, "id": 1}, "label": "KNOWS", "start_id": {"oid": 1, "id": 1}, "end_id": {"oid": 1, "id": 2}, "properties": {}}::edge';
    const v2Raw = '{"id": {"oid": 1, "id": 2}, "label": "Person", "properties": {"name": "Bob"}}::vertex';

    const rows = [
      {
        a: deserializeAgtype(v1Raw),
        r: deserializeAgtype(eRaw),
        b: deserializeAgtype(v2Raw),
      },
    ];

    const { vertices, edges } = extractGraphElements(rows as Record<string, unknown>[]);
    expect(vertices).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it('should deduplicate vertices across multiple rows', () => {
    const vRaw = '{"id": {"oid": 1, "id": 1}, "label": "Person", "properties": {"name": "Alice"}}::vertex';
    const parsed = deserializeAgtype(vRaw);

    // Same vertex appears in multiple rows
    const rows = [{ n: parsed }, { n: parsed }];
    const { vertices } = extractGraphElements(rows as Record<string, unknown>[]);
    expect(vertices).toHaveLength(1);
  });
});

describe('CypherQueryWrapper → full pipeline', () => {
  it('should wrap a query and produce valid SQL with correct columns', () => {
    const cypher = 'MATCH (a)-[r:KNOWS]->(b) RETURN a, r, b';
    const sql = CypherQueryWrapper.wrap(cypher, 'social_graph');

    expect(sql).toContain("FROM cypher('social_graph'");
    expect(sql).toContain('$$ MATCH (a)-[r:KNOWS]->(b) RETURN a, r, b $$');
    expect(sql).toContain('a agtype, r agtype, b agtype');
  });

  it('should handle a CREATE query (no RETURN) wrapped in SQL', () => {
    const cypher = "CREATE (n:Person {name: 'Alice', age: 30})";
    const sql = CypherQueryWrapper.wrap(cypher, 'social_graph');

    expect(sql).toContain("FROM cypher('social_graph'");
    expect(sql).toContain('result agtype');
  });

  it('should handle RETURN with aggregation and alias', () => {
    const cypher = 'MATCH (n:Person) RETURN n.name AS name, count(n) AS total ORDER BY total DESC LIMIT 10';
    const sql = CypherQueryWrapper.wrap(cypher, 'g');

    expect(sql).toContain('name agtype, total agtype');
  });
});

describe('Complex agtype parsing scenarios', () => {
  it('should parse vertex with nested object properties', () => {
    const raw = '{"id": {"oid": 1, "id": 1}, "label": "Config", "properties": {"settings": {"theme": "dark", "fontSize": 14}}}::vertex';
    const parsed = deserializeAgtype(raw) as Record<string, unknown>;

    expect(parsed.__type).toBe('vertex');
    const props = parsed.properties as Record<string, unknown>;
    const settings = props.settings as Record<string, unknown>;
    expect(settings.theme).toBe('dark');
    expect(settings.fontSize).toBe(14);
  });

  it('should parse vertex with array properties', () => {
    const raw = '{"id": {"oid": 1, "id": 1}, "label": "Person", "properties": {"tags": ["admin", "user"], "scores": [95, 87, 92]}}::vertex';
    const parsed = deserializeAgtype(raw) as Record<string, unknown>;

    const props = parsed.properties as Record<string, unknown>;
    expect(props.tags).toEqual(['admin', 'user']);
    expect(props.scores).toEqual([95, 87, 92]);
  });

  it('should parse vertex with special float values in properties', () => {
    const raw = '{"id": {"oid": 1, "id": 1}, "label": "Metrics", "properties": {"value": Infinity, "missing": NaN}}::vertex';
    const parsed = deserializeAgtype(raw) as Record<string, unknown>;

    const props = parsed.properties as Record<string, unknown>;
    expect(props.value).toBe(Infinity);
    expect(props.missing).toBeNaN();
  });

  it('should parse vertex with empty properties', () => {
    const raw = '{"id": {"oid": 1, "id": 1}, "label": "Empty", "properties": {}}::vertex';
    const parsed = deserializeAgtype(raw) as Record<string, unknown>;

    expect(parsed.properties).toEqual({});
  });

  it('should parse edge with complex properties', () => {
    const raw = '{"id": {"oid": 2, "id": 1}, "label": "RATED", "start_id": {"oid": 1, "id": 1}, "end_id": {"oid": 1, "id": 2}, "properties": {"rating": 4.5, "review": "Great!", "tags": ["helpful"]}}::edge';
    const parsed = deserializeAgtype(raw) as Record<string, unknown>;

    expect(parsed.__type).toBe('edge');
    const props = parsed.properties as Record<string, unknown>;
    expect(props.rating).toBeCloseTo(4.5);
    expect(props.review).toBe('Great!');
    expect(props.tags).toEqual(['helpful']);
  });
});
