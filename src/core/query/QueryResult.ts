/**
 * Result of executing a Cypher/SQL query against AGE.
 */
export interface QueryResult {
  /** Parsed rows — agtype values are already deserialized into JS objects */
  rows: Record<string, unknown>[];
  /** Column names from the result set */
  columns: string[];
  /** Number of rows returned */
  rowCount: number;
  /** Wall‑clock execution time in milliseconds */
  executionTimeMs: number;
  /** PostgreSQL command tag (e.g. "SELECT") */
  command: string;
}

/**
 * A vertex (node) as returned by AGE's agtype parser.
 */
export interface AgeVertex {
  id: { oid: number; id: number };
  label: string;
  properties: Record<string, unknown>;
}

/**
 * An edge (relationship) as returned by AGE's agtype parser.
 */
export interface AgeEdge {
  id: { oid: number; id: number };
  label: string;
  start_id: { oid: number; id: number };
  end_id: { oid: number; id: number };
  properties: Record<string, unknown>;
}

/**
 * A path is an array alternating between vertices and edges.
 */
export type AgePath = Array<AgeVertex | AgeEdge>;

/**
 * Type guard: checks if a value looks like an AGE vertex.
 */
export function isAgeVertex(value: unknown): value is AgeVertex {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    'id' in v &&
    'label' in v &&
    'properties' in v &&
    !('start_id' in v) &&
    !('end_id' in v)
  );
}

/**
 * Type guard: checks if a value looks like an AGE edge.
 */
export function isAgeEdge(value: unknown): value is AgeEdge {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return 'id' in v && 'label' in v && 'start_id' in v && 'end_id' in v && 'properties' in v;
}

/**
 * Type guard: checks if a value looks like an AGE path.
 */
export function isAgePath(value: unknown): value is AgePath {
  if (!Array.isArray(value) || value.length === 0) return false;
  return isAgeVertex(value[0]);
}

/**
 * Extract all vertices and edges from query result rows.
 */
export function extractGraphElements(rows: Record<string, unknown>[]): {
  vertices: AgeVertex[];
  edges: AgeEdge[];
} {
  const vertexMap = new Map<string, AgeVertex>();
  const edgeMap = new Map<string, AgeEdge>();

  function processValue(val: unknown): void {
    if (isAgeVertex(val)) {
      const key = `${val.id.oid}.${val.id.id}`;
      if (!vertexMap.has(key)) {
        vertexMap.set(key, val);
      }
    } else if (isAgeEdge(val)) {
      const key = `${val.id.oid}.${val.id.id}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, val);
      }
    } else if (isAgePath(val)) {
      for (const elem of val) {
        processValue(elem);
      }
    } else if (Array.isArray(val)) {
      for (const elem of val) {
        processValue(elem);
      }
    }
  }

  for (const row of rows) {
    for (const val of Object.values(row)) {
      processValue(val);
    }
  }

  return {
    vertices: Array.from(vertexMap.values()),
    edges: Array.from(edgeMap.values()),
  };
}
