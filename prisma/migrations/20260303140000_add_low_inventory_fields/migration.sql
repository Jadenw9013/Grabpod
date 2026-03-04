-- Add LOW inventory tracking fields to InventorySnapshot
ALTER TABLE "InventorySnapshot" ADD COLUMN "isLow" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InventorySnapshot" ADD COLUMN "daysOfCover" DOUBLE PRECISION;
ALTER TABLE "InventorySnapshot" ADD COLUMN "avgDailySales" DOUBLE PRECISION;
