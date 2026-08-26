-- Existing Playwright tasks/agents are handed to the Chrome extension.
UPDATE "crawler_tasks" SET "collectorType" = 'CHROME_EXT' WHERE "collectorType" = 'PLAYWRIGHT';
UPDATE "collector_agents" SET "type" = 'CHROME_EXT' WHERE "type" = 'PLAYWRIGHT';
UPDATE "crawler_task_items" SET "status" = 'PENDING'
WHERE "status" = 'QUEUED';

ALTER TYPE "CollectorType" RENAME TO "CollectorType_old";
CREATE TYPE "CollectorType" AS ENUM ('ELECTRON', 'CHROME_EXT');

ALTER TABLE "crawler_tasks"
  ALTER COLUMN "collectorType" TYPE "CollectorType"
  USING "collectorType"::text::"CollectorType";

ALTER TABLE "collector_agents"
  ALTER COLUMN "type" TYPE "CollectorType"
  USING "type"::text::"CollectorType";

DROP TYPE "CollectorType_old";
