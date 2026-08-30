SELECT "skuId", "createdAt",
  ("rawPayload"::text ILIKE '%211%') AS has_211,
  ("rawPayload"::text ILIKE '%"weight"%') AS has_weight_key,
  ("rawPayload"::text ILIKE '%dimension%') AS has_dimension,
  left("rawPayload"::text, 500) AS payload_head
FROM product_snapshots
WHERE "skuId" = '2974096117'
ORDER BY "createdAt" DESC
LIMIT 3;

SELECT e.key, left(e.value, 200)
FROM product_snapshots s,
LATERAL (
  SELECT m[1] AS key, m[2] AS value
  FROM regexp_matches(s."rawPayload"::text, '(?i)"(weight|dimension|dimensions|depth|packageSize|volume)"\s*:\s*("[^"]+"|[0-9.]+)', 'g') m
) e
WHERE s."skuId" = '2974096117'
LIMIT 50;
