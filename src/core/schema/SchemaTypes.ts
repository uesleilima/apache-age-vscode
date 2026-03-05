/**
 * Schema types for Apache AGE graph metadata.
 */

export interface GraphInfo {
  /** Graph OID */
  oid: number;
  /** Graph name */
  name: string;
  /** Graph namespace */
  namespace: number;
}

export interface LabelInfo {
  /** Label name */
  name: string;
  /** 'v' for vertex, 'e' for edge */
  kind: 'v' | 'e';
  /** Approximate tuple count from pg_class.reltuples */
  count: number;
}

export interface GraphMetadata {
  /** Graph name */
  graph: string;
  /** Database name */
  database: string;
  /** Vertex labels */
  nodes: LabelInfo[];
  /** Edge labels */
  edges: LabelInfo[];
}
