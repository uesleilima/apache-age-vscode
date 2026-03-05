SELECT label, count(label)::INTEGER as cnt
FROM (
    SELECT ag_catalog._label_name(oid, v)::text as label
    FROM cypher('%s', $$
        MATCH ()-[V]-()
        RETURN id(V)
    $$) as (V agtype), (SELECT oid FROM ag_catalog.ag_graph WHERE name = '%s') as oid
) b
GROUP BY b.label;
