-- AlterTable
ALTER TABLE "OrderHeader" ADD COLUMN     "payTime" TIMESTAMP(3),
ADD COLUMN     "status" INTEGER NOT NULL DEFAULT 0;
