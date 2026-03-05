import { describe, it, expect } from 'vitest';
import { deserializeAgtype } from '../../src/core/parser/AgtypeDeserializer';

describe('AgtypeDeserializer', () => {
  // ── Primitives ──────────────────────────────────────────────────────

  describe('primitives', () => {
    it('should parse null', () => {
      expect(deserializeAgtype('null')).toBeNull();
    });

    it('should return null for empty input', () => {
      expect(deserializeAgtype('')).toBeNull();
    });

    it('should return null for whitespace-only input', () => {
      expect(deserializeAgtype('   ')).toBeNull();
    });

    it('should parse true', () => {
      expect(deserializeAgtype('true')).toBe(true);
    });

    it('should parse false', () => {
      expect(deserializeAgtype('false')).toBe(false);
    });

    it('should parse a simple string', () => {
      expect(deserializeAgtype('"hello"')).toBe('hello');
    });

    it('should parse a string with escaped characters', () => {
      expect(deserializeAgtype('"hello\\nworld"')).toBe('hello\nworld');
    });

    it('should parse a string with escaped quotes', () => {
      expect(deserializeAgtype('"say \\"hi\\""')).toBe('say "hi"');
    });

    it('should parse an empty string', () => {
      expect(deserializeAgtype('""')).toBe('');
    });
  });

  // ── Numbers ─────────────────────────────────────────────────────────

  describe('numbers', () => {
    it('should parse a positive integer', () => {
      expect(deserializeAgtype('42')).toBe(42);
    });

    it('should parse zero', () => {
      expect(deserializeAgtype('0')).toBe(0);
    });

    it('should parse a negative integer', () => {
      expect(deserializeAgtype('-7')).toBe(-7);
    });

    it('should parse a float', () => {
      expect(deserializeAgtype('3.14')).toBeCloseTo(3.14);
    });

    it('should parse a negative float', () => {
      expect(deserializeAgtype('-0.5')).toBeCloseTo(-0.5);
    });

    it('should parse a float with exponent', () => {
      expect(deserializeAgtype('1.5e10')).toBe(1.5e10);
    });

    it('should parse a float with negative exponent', () => {
      expect(deserializeAgtype('2.5E-3')).toBeCloseTo(0.0025);
    });

    it('should parse Infinity', () => {
      expect(deserializeAgtype('Infinity')).toBe(Infinity);
    });

    it('should parse -Infinity', () => {
      expect(deserializeAgtype('-Infinity')).toBe(-Infinity);
    });

    it('should parse NaN', () => {
      expect(deserializeAgtype('NaN')).toBeNaN();
    });
  });

  // ── Objects ─────────────────────────────────────────────────────────

  describe('objects', () => {
    it('should parse an empty object', () => {
      expect(deserializeAgtype('{}')).toEqual({});
    });

    it('should parse a simple object', () => {
      expect(deserializeAgtype('{"name": "Alice", "age": 30}')).toEqual({
        name: 'Alice',
        age: 30,
      });
    });

    it('should parse nested objects', () => {
      const input = '{"person": {"name": "Bob", "address": {"city": "NYC"}}}';
      expect(deserializeAgtype(input)).toEqual({
        person: { name: 'Bob', address: { city: 'NYC' } },
      });
    });
  });

  // ── Arrays ──────────────────────────────────────────────────────────

  describe('arrays', () => {
    it('should parse an empty array', () => {
      expect(deserializeAgtype('[]')).toEqual([]);
    });

    it('should parse a simple array', () => {
      expect(deserializeAgtype('[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('should parse a mixed-type array', () => {
      expect(deserializeAgtype('[1, "two", true, null]')).toEqual([1, 'two', true, null]);
    });

    it('should parse nested arrays', () => {
      expect(deserializeAgtype('[[1, 2], [3, 4]]')).toEqual([[1, 2], [3, 4]]);
    });
  });

  // ── Type Annotations ───────────────────────────────────────────────

  describe('type annotations', () => {
    it('should parse a vertex type annotation', () => {
      const input = '{"id": 1, "label": "Person", "properties": {"name": "Alice"}}::vertex';
      const result = deserializeAgtype(input) as Record<string, unknown>;
      expect(result.__type).toBe('vertex');
      expect(result.label).toBe('Person');
      expect(result.properties).toEqual({ name: 'Alice' });
    });

    it('should parse an edge type annotation', () => {
      const input = '{"id": 2, "label": "KNOWS", "start_id": 1, "end_id": 3, "properties": {}}::edge';
      const result = deserializeAgtype(input) as Record<string, unknown>;
      expect(result.__type).toBe('edge');
      expect(result.label).toBe('KNOWS');
    });

    it('should parse a path type annotation on arrays', () => {
      const input = '[{"id": 1, "label": "A", "properties": {}}::vertex, {"id": 2, "label": "R", "start_id": 1, "end_id": 3, "properties": {}}::edge, {"id": 3, "label": "B", "properties": {}}::vertex]::path';
      const result = deserializeAgtype(input) as unknown[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
      // Path type is stored as non-enumerable __type
      expect((result as any).__type).toBe('path');
    });

    it('should parse nested type annotations inside objects', () => {
      const input = '{"id": {"oid": 100, "id": 1}::graphid, "label": "Person", "properties": {"name": "Alice"}}::vertex';
      const result = deserializeAgtype(input) as Record<string, unknown>;
      expect(result.__type).toBe('vertex');
      const id = result.id as Record<string, unknown>;
      expect(id.__type).toBe('graphid');
      expect(id.oid).toBe(100);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle whitespace around values', () => {
      expect(deserializeAgtype('  42  ')).toBe(42);
    });

    it('should handle whitespace in objects', () => {
      expect(deserializeAgtype(' { "a" : 1 , "b" : 2 } ')).toEqual({ a: 1, b: 2 });
    });

    it('should throw on unterminated string', () => {
      expect(() => deserializeAgtype('"hello')).toThrow();
    });

    it('should throw on unexpected token', () => {
      expect(() => deserializeAgtype('{')).toThrow();
    });

    it('should throw on invalid input', () => {
      expect(() => deserializeAgtype('??')).toThrow();
    });

    it('should parse a large integer', () => {
      expect(deserializeAgtype('9007199254740992')).toBe(9007199254740992);
    });

    it('should parse object with boolean values', () => {
      expect(deserializeAgtype('{"active": true, "deleted": false}')).toEqual({
        active: true,
        deleted: false,
      });
    });

    it('should parse object with null values', () => {
      expect(deserializeAgtype('{"value": null}')).toEqual({ value: null });
    });
  });

  // ── Realistic AGE Results ──────────────────────────────────────────

  describe('realistic AGE results', () => {
    it('should parse a full vertex as returned by AGE', () => {
      const input = '{"id": {"oid": 844424930131969, "id": 1}, "label": "Person", "properties": {"name": "Alice", "age": 30}}::vertex';
      const result = deserializeAgtype(input) as Record<string, unknown>;
      expect(result.__type).toBe('vertex');
      expect(result.label).toBe('Person');
      expect((result.properties as Record<string, unknown>).name).toBe('Alice');
    });

    it('should parse a full edge as returned by AGE', () => {
      const input = '{"id": {"oid": 1125899906842625, "id": 1}, "label": "KNOWS", "start_id": {"oid": 844424930131969, "id": 1}, "end_id": {"oid": 844424930131969, "id": 2}, "properties": {"since": 2020}}::edge';
      const result = deserializeAgtype(input) as Record<string, unknown>;
      expect(result.__type).toBe('edge');
      expect(result.label).toBe('KNOWS');
      expect((result.properties as Record<string, unknown>).since).toBe(2020);
    });

    it('should parse a path with vertices and edges', () => {
      const vertex1 = '{"id": {"oid": 1, "id": 1}, "label": "A", "properties": {}}::vertex';
      const edge = '{"id": {"oid": 2, "id": 1}, "label": "R", "start_id": {"oid": 1, "id": 1}, "end_id": {"oid": 1, "id": 2}, "properties": {}}::edge';
      const vertex2 = '{"id": {"oid": 1, "id": 2}, "label": "B", "properties": {}}::vertex';
      const input = `[${vertex1}, ${edge}, ${vertex2}]::path`;
      const result = deserializeAgtype(input) as unknown[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
      expect((result[0] as Record<string, unknown>).__type).toBe('vertex');
      expect((result[1] as Record<string, unknown>).__type).toBe('edge');
      expect((result[2] as Record<string, unknown>).__type).toBe('vertex');
    });
  });
});
