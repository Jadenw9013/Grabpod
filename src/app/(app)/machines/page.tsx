import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function MachinesPage() {
  const tenantId = getTenantId();
  const machines = await prisma.machine.findMany({
    where: { tenantId },
    include: { location: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Machines</h1>
      <div className="mt-4 rounded-xl border">
        <div className="grid grid-cols-3 gap-2 border-b p-3 text-sm text-muted-foreground">
          <div>Sticker</div><div>Location</div><div>Status</div>
        </div>
        {machines.map((m) => (
          <Link
            key={m.id}
            href={`/machines/${m.id}`}
            className="grid grid-cols-3 gap-2 p-3 text-sm hover:bg-muted/50 transition-colors"
          >
            <div>{m.stickerNum ?? "-"}</div>
            <div>{m.location?.name ?? "-"}</div>
            <div>{m.status}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
