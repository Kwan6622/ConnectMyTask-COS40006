-- Completion is logged automatically when the provider publishes the task as completed,
-- so the provider-entered estimate is no longer used.
ALTER TABLE "TASK_PROGRESS_UPDATES" DROP COLUMN IF EXISTS "estimatedCompletionDate";
