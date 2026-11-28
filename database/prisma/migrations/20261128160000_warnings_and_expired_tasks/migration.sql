-- 1. Account warnings: 3 warnings lock the account for 3 days (USERS.status = 'LOCKED'
--    until "lockedUntil"); the lock ends by itself or when an admin reactivates it.
--    USERS.lockoutUntil stays the short brute-force login lock and is unrelated.
ALTER TABLE "USERS" ADD COLUMN "warningCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- History of every change, shown to the user (profile) and to admins.
CREATE TABLE "USER_WARNINGS" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "change" INTEGER NOT NULL,
    "countAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "taskId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "USER_WARNINGS_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "USER_WARNINGS_userId_createdAt_idx" ON "USER_WARNINGS"("userId", "createdAt");
ALTER TABLE "USER_WARNINGS" ADD CONSTRAINT "USER_WARNINGS_userId_fkey" FOREIGN KEY ("userId") REFERENCES "USERS"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "USER_WARNINGS" ADD CONSTRAINT "USER_WARNINGS_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TASKS"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "USER_WARNINGS" ADD CONSTRAINT "USER_WARNINGS_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "USERS"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Tasks whose deadline passed while still open (no provider assigned) become
--    EXPIRED: hidden from browsing, visible only to the requester, who can edit
--    and repost or delete them permanently.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TABLE "TASKS" ADD COLUMN "expiredAt" TIMESTAMP(3);
