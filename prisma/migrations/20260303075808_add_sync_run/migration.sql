-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "message" TEXT,
    "importedOrders" INTEGER NOT NULL DEFAULT 0,
    "importedLines" INTEGER NOT NULL DEFAULT 0,
    "createdProducts" INTEGER NOT NULL DEFAULT 0,
    "createdMachines" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
