import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const accelerateUrl = process.env.PRISMA_ACCELERATE_URL;

  // If you're using Prisma Accelerate (prisma:// or prisma+postgres://)
  if (accelerateUrl && accelerateUrl.length > 0) {
    return new PrismaClient({
      accelerateUrl,
    });
  }

  // Normal Postgres (postgresql://...) via driver adapter
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is missing in .env");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}