-- Get labels (nodes + edges) for a graph.
-- Uses only pg_catalog — works on both self-hosted and managed (Azure) PostgreSQL.
-- Edge vs vertex is determined by the presence of a start_id column.
SELECT
    c.relname AS label,
    c.reltuples::bigint AS cnt,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute a
            WHERE a.attrelid = c.oid
              AND a.attname = 'start_id'
              AND NOT a.attisdropped
        ) THEN 'e' ELSE 'v'
    END AS kind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '%s'
  AND c.relkind = 'r'
  AND c.relname NOT IN ('_ag_label_vertex', '_ag_label_edge')
  AND c.relname !~ '^pg_';
