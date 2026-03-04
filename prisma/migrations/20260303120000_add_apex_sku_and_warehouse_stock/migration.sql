-- AlterTable
ALTER TABLE "Product" ADD COLUMN "apexSku" TEXT;

-- CreateTable
CREATE TABLE "WarehouseStock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseStock_tenantId_productId_key" ON "WarehouseStock"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_apexSku_key" ON "Product"("tenantId", "apexSku");

-- AddForeignKey
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
