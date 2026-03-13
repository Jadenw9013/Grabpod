"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

interface Row {
  id: string;
  productId: string;
  productName: string;
  category: string | null;
  onHand: number;
  capacity: number;
  isLow: boolean;
  daysOfCover: number | null;
}

// Auth integration stubbed for MVP
const CURRENT_ROLE: "Admin" | "Manager" | "Stocker" = "Admin";

export function InventoryTable({
  machineId,
  rows,
}: {
  machineId: string;
  rows: Row[];
}) {
  const canEdit = CURRENT_ROLE === "Admin" || CURRENT_ROLE === "Manager";

  return (
    <div className="mt-2 overflow-auto">
      <div className="min-w-[750px] rounded-xl border">
        {/* Header */}
        <div className="grid grid-cols-[1fr_100px_80px_90px_100px_90px_90px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
          <div>Product</div>
          <div>Category</div>
          <div>Capacity</div>
          <div>Stock Remain</div>
          <div>% Remaining</div>
          <div>Days of Cover</div>
          <div>Below Threshold</div>
        </div>
        {rows.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No inventory snapshots yet.
          </div>
        ) : (
          rows.map((row) => (
            <InventoryRow
              key={row.id}
              machineId={machineId}
              row={row}
              canEdit={canEdit}
            />
          ))
        )}
      </div>
    </div>
  );
}

function InventoryRow({
  machineId,
  row,
  canEdit,
}: {
  machineId: string;
  row: Row;
  canEdit: boolean;
}) {
  const [onHand, setOnHand] = useState(row.onHand);
  const [capacity, setCapacity] = useState(row.capacity);
  const [editingField, setEditingField] = useState<"onHand" | "capacity" | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const pctRemaining =
    row.capacity > 0 ? Math.round((row.onHand / row.capacity) * 100) : 0;
  const belowThreshold = row.isLow;

  async function handleSave(field: "onHand" | "capacity") {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/machines/${machineId}/inventory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: row.productId,
          onHand: field === "onHand" ? onHand : row.onHand,
          capacity: field === "capacity" ? capacity : row.capacity,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage(body.error ?? `Error ${res.status}`);
      } else {
        setMessage("Saved");
        row.onHand = field === "onHand" ? onHand : row.onHand;
        row.capacity = field === "capacity" ? capacity : row.capacity;
        setEditingField(null);
      }
    } catch {
      setMessage("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-[1fr_100px_80px_90px_100px_90px_90px] gap-2 p-3 text-sm items-center border-b last:border-0">
      {/* Product name + LOW badge */}
      <div className="flex items-center gap-1.5">
        <span className="truncate">{row.productName}</span>
        {row.isLow && (
          <span
            className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 cursor-help shrink-0"
            title="LOW = Not enough inventory to cover next restock window based on sales velocity"
          >
            LOW
          </span>
        )}
      </div>

      {/* Category */}
      <div className="text-muted-foreground truncate">
        {row.category ?? "—"}
      </div>

      {/* Capacity */}
      <div className="flex items-center gap-1">
        {editingField === "capacity" ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(0, Number(e.target.value)))}
              className="w-14 rounded border px-1 py-0.5 text-sm"
              autoFocus
            />
            <button
              onClick={() => handleSave("capacity")}
              disabled={saving}
              className="text-xs text-foreground hover:underline"
            >
              ✓
            </button>
            <button
              onClick={() => {
                setCapacity(row.capacity);
                setEditingField(null);
              }}
              className="text-xs text-muted-foreground hover:underline"
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            {row.capacity}
            {canEdit && (
              <button
                onClick={() => setEditingField("capacity")}
                className="text-muted-foreground hover:text-foreground"
                title="Edit capacity"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Stock Remain */}
      <div className="flex items-center gap-1">
        {editingField === "onHand" ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              value={onHand}
              onChange={(e) => setOnHand(Math.max(0, Number(e.target.value)))}
              className="w-14 rounded border px-1 py-0.5 text-sm"
              autoFocus
            />
            <button
              onClick={() => handleSave("onHand")}
              disabled={saving}
              className="text-xs text-foreground hover:underline"
            >
              ✓
            </button>
            <button
              onClick={() => {
                setOnHand(row.onHand);
                setEditingField(null);
              }}
              className="text-xs text-muted-foreground hover:underline"
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            {row.onHand}
            {canEdit && (
              <button
                onClick={() => setEditingField("onHand")}
                className="text-muted-foreground hover:text-foreground"
                title="Edit stock remain"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </>
        )}
      </div>

      {/* % Remaining bar */}
      <div className="flex items-center gap-1">
        <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
          <div
            className="h-full rounded bg-gray-400"
            style={{ width: `${Math.min(pctRemaining, 100)}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground w-8 text-right">
          {pctRemaining}%
        </span>
      </div>

      {/* Days of Cover */}
      <div className="text-muted-foreground">
        {row.daysOfCover !== null ? row.daysOfCover.toFixed(1) : "—"}
      </div>

      {/* Below Threshold */}
      <div>
        {belowThreshold ? (
          <span
            className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 cursor-help"
            title="LOW = Not enough inventory to cover next restock window based on sales velocity"
          >
            LOW
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">OK</span>
        )}
      </div>

      {/* Save message */}
      {message && (
        <div className="col-span-full">
          <span
            className={`text-xs ${message === "Saved" ? "text-muted-foreground" : "text-red-600"}`}
          >
            {message}
          </span>
        </div>
      )}
    </div>
  );
}
