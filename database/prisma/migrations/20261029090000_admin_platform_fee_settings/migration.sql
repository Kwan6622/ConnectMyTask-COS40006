-- Additive admin-managed platform fee configuration.
-- The initial 20% value preserves the existing settlement policy; it does not alter historical transactions.
CREATE TABLE "PLATFORM_FEE_CONFIG" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "feeType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "percentageRate" DOUBLE PRECISION,
    "fixedAmount" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" INTEGER,
    CONSTRAINT "PLATFORM_FEE_CONFIG_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PLATFORM_FEE_CONFIG_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "PLATFORM_FEE_CONFIG_type_check" CHECK ("feeType" IN ('PERCENTAGE', 'FIXED')),
    CONSTRAINT "PLATFORM_FEE_CONFIG_percentage_check" CHECK ("percentageRate" IS NULL OR ("percentageRate" >= 0 AND "percentageRate" < 1)),
    CONSTRAINT "PLATFORM_FEE_CONFIG_fixed_check" CHECK ("fixedAmount" IS NULL OR "fixedAmount" >= 0)
);

CREATE TABLE "PLATFORM_FEE_AUDITS" (
    "id" SERIAL NOT NULL,
    "configId" INTEGER NOT NULL,
    "changedById" INTEGER NOT NULL,
    "previousValue" JSONB NOT NULL,
    "newValue" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PLATFORM_FEE_AUDITS_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PLATFORM_FEE_AUDITS_configId_createdAt_idx" ON "PLATFORM_FEE_AUDITS"("configId", "createdAt");
CREATE INDEX "PLATFORM_FEE_AUDITS_changedById_createdAt_idx" ON "PLATFORM_FEE_AUDITS"("changedById", "createdAt");

ALTER TABLE "PLATFORM_FEE_CONFIG" ADD CONSTRAINT "PLATFORM_FEE_CONFIG_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "USERS"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PLATFORM_FEE_AUDITS" ADD CONSTRAINT "PLATFORM_FEE_AUDITS_configId_fkey"
FOREIGN KEY ("configId") REFERENCES "PLATFORM_FEE_CONFIG"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PLATFORM_FEE_AUDITS" ADD CONSTRAINT "PLATFORM_FEE_AUDITS_changedById_fkey"
FOREIGN KEY ("changedById") REFERENCES "USERS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "PLATFORM_FEE_CONFIG" ("id", "feeType", "percentageRate", "fixedAmount", "isActive", "version", "updatedAt")
VALUES (1, 'PERCENTAGE', 0.20, NULL, true, 1, CURRENT_TIMESTAMP);
