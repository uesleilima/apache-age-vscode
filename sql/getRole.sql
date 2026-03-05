SELECT
    CASE WHEN usesuper THEN 'admin' ELSE 'user' END AS role
FROM pg_catalog.pg_user
WHERE usename = $1;
