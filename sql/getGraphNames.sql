-- List AGE graphs by finding schemas that contain the internal AGE tables.
-- Works on both self-hosted and managed (Azure) PostgreSQL.
SELECT
    n.oid,
    n.nspname AS name,
    n.oid AS namespace
FROM pg_catalog.pg_namespace n
WHERE EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.relnamespace = n.oid
      AND c.relname = '_ag_label_vertex'
      AND c.relkind = 'r'
)
AND n.nspname NOT IN ('ag_catalog', 'information_schema', 'pg_catalog');
