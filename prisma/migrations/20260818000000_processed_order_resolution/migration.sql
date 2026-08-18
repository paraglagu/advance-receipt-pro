-- Lets a merchant take a handled shortfall off the exceptions list without
-- losing the record of it.
ALTER TABLE "ProcessedOrder" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "ProcessedOrder" ADD COLUMN "resolvedNote" TEXT;
