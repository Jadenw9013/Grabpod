import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
    const tenantId = getTenantId();

    const contracts = await prisma.contract.findMany({
        where: { tenantId },
        include: {
            location: {
                select: { name: true },
            },
        },
        orderBy: { location: { name: "asc" } },
    });

    // Count machines bound per location for each contract
    const locationIds = contracts.map((c) => c.locationId);
    const machineCounts = await prisma.machine.groupBy({
        by: ["locationId"],
        where: { tenantId, locationId: { in: locationIds } },
        _count: { id: true },
    });
    const machineCountMap = new Map(
        machineCounts.map((m) => [m.locationId, m._count.id])
    );

    return (
        <main className="p-6">
            <h1 className="text-xl font-semibold">Contracts</h1>
            <p className="mt-1 text-sm text-muted-foreground">
                Profit sharing &amp; financial rules by location/vendor
            </p>

            <p className="mt-3 text-xs text-muted-foreground italic">
                Rates vary by location and vendor
            </p>

            {/* Contracts list table */}
            <div className="mt-4 overflow-auto">
                <div className="min-w-[700px] rounded-xl border">
                    <div className="grid grid-cols-[1fr_130px_130px_110px_110px_100px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
                        <div>Location</div>
                        <div>Profit Share &lt;$1000</div>
                        <div>Profit Share &gt;$1000</div>
                        <div>Inception Date</div>
                        <div>Rental Start</div>
                        <div>Machines Bound</div>
                    </div>
                    {contracts.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">
                            No contracts found.
                        </div>
                    ) : (
                        contracts.map((c) => (
                            <ContractRow
                                key={c.id}
                                locationName={c.location.name}
                                profitShareUnder={c.profitShareUnder1000}
                                profitShareOver={c.profitShareOver1000}
                                inceptionDate={c.inceptionDate}
                                rentalDate={c.rentalDate}
                                machinesBound={machineCountMap.get(c.locationId) ?? 0}
                                taxRate={c.taxRate}
                                ccFeeRate={c.creditCardFeeRate}
                            />
                        ))
                    )}
                </div>
            </div>
        </main>
    );
}

function ContractRow({
    locationName,
    profitShareUnder,
    profitShareOver,
    inceptionDate,
    rentalDate,
    machinesBound,
    taxRate,
    ccFeeRate,
}: {
    locationName: string;
    profitShareUnder: number | null;
    profitShareOver: number | null;
    inceptionDate: Date | null;
    rentalDate: Date | null;
    machinesBound: number;
    taxRate: number;
    ccFeeRate: number;
}) {
    const fmtPct = (v: number | null) =>
        v !== null ? `${(v * 100).toFixed(1)}%` : "—";
    const fmtDate = (d: Date | null) =>
        d ? d.toLocaleDateString() : "—";

    return (
        <div className="border-b last:border-0">
            {/* Main row */}
            <div className="grid grid-cols-[1fr_130px_130px_110px_110px_100px] gap-2 p-3 text-sm">
                <div className="font-medium">{locationName}</div>
                <div>{fmtPct(profitShareUnder)}</div>
                <div>{fmtPct(profitShareOver)}</div>
                <div className="text-muted-foreground">{fmtDate(inceptionDate)}</div>
                <div className="text-muted-foreground">{fmtDate(rentalDate)}</div>
                <div>{machinesBound}</div>
            </div>

            {/* Inline detail: financial rates */}
            <div className="px-3 pb-3 flex gap-6 text-xs text-muted-foreground">
                <span>
                    Sales Tax Rate:{" "}
                    <span className="text-foreground">
                        {(taxRate * 100).toFixed(2)}%
                    </span>
                    {/* TODO: Make editable for Admin/Manager */}
                </span>
                <span>
                    CC Fee Rate:{" "}
                    <span className="text-foreground">
                        {(ccFeeRate * 100).toFixed(2)}%
                    </span>
                    {/* TODO: Make editable for Admin/Manager */}
                </span>
                {/* TODO: Editable Effective From Date */}
                {/* TODO: Revenue breakdown + net revenue preview in detail view */}
            </div>
        </div>
    );
}
