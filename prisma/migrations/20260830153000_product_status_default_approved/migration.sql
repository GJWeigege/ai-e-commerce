-- Align products.status default with schema (ingest already writes APPROVED explicitly)

ALTER TABLE "products" ALTER COLUMN "status" SET DEFAULT 'APPROVED';
