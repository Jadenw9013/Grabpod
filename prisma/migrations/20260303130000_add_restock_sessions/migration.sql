-- AlterTable: add optional sessionId to InventoryEvent for audit trail
ALTER TABLE "InventoryEvent" ADD COLUMN "sessionId" TEXT;

-- CreateTable: RestockSession
CREATE TABLE "RestockSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignedDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestockSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RestockSessionLine
CREATE TABLE "RestockSessionLine" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "neededUnits" INTEGER NOT NULL,
    "beforeStockRemain" INTEGER,
    "afterStockRemain" INTEGER,

    CONSTRAINT "RestockSessionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: idempotency constraint (one session per tenant per assigned date)
CREATE UNIQUE INDEX "RestockSession_tenantId_assignedDate_key" ON "RestockSession"("tenantId", "assignedDate");

-- CreateIndex: one line per session+machine+product
CREATE UNIQUE INDEX "RestockSessionLine_sessionId_machineId_productId_key" ON "RestockSessionLine"("sessionId", "machineId", "productId");

-- AddForeignKey
ALTER TABLE "RestockSession" ADD CONSTRAINT "RestockSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockSessionLine" ADD CONSTRAINT "RestockSessionLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RestockSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
