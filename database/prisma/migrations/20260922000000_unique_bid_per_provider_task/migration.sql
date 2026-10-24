-- Do not discard existing bids automatically: they may affect assignment history.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BIDS" GROUP BY "taskId", "providerId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate task/provider bids exist. Review and resolve them before applying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "BIDS_taskId_providerId_key" ON "BIDS"("taskId", "providerId");
COMMIT;
