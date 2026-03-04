import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  accelerateUrl: process.env.DATABASE_URL!,
});

async function main() {
  const tenantId = process.env.DEV_TENANT_ID!;
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, name: "Grabpod Demo Org" },
  });

  // Minimal demo data to make UI non-empty
  const location = await prisma.location.upsert({
    where: { id: "00000000-0000-0000-0000-000000000010" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000010",
      tenantId,
      name: "Downtown Office",
      address: "123 Market St",
      cluster: "SF-Core",
    },
  });

  const machine = await prisma.machine.upsert({
    where: { id: "00000000-0000-0000-0000-000000000020" },
    update: { locationId: location.id },
    create: {
      id: "00000000-0000-0000-0000-000000000020",
      tenantId,
      stickerNum: "GP-001",
      locationId: location.id,
    },
  });

  const product = await prisma.product.upsert({
    where: { id: "00000000-0000-0000-0000-000000000030" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000030",
      tenantId,
      name: "Sparkling Water",
      category: "Beverage",
      cost: 0.75,
    },
  });

  await prisma.inventorySnapshot.upsert({
    where: { machineId_productId: { machineId: machine.id, productId: product.id } },
    update: { capacity: 24, onHand: 6 },
    create: { tenantId, machineId: machine.id, productId: product.id, capacity: 24, onHand: 6 },
  });
}

main().then(() => prisma.$disconnect()).catch((e) => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});
