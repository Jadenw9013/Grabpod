"use client";

import { useCallback, useEffect, useState, useMemo } from "react";

export const dynamic = "force-dynamic";

/* ─── Types matching GET /api/restock/sessions response ─── */
interface Session {
  id: string;
  assignedDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  lineCount: number;
  totalNeeded: number;
  durationMinutes: number | null;
}

type Status = "Not Started" | "In Progress" | "Completed";
type StatusFilter = "all" | Status;
type SortOption = "created" | "assignedDate" | "totalNeeded" | "lineCount";

function deriveStatus(s: Session): Status {
  if (s.completedAt) return "Completed";
  if (s.startedAt) return "In Progress";
  return "Not Started";
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

export default function RestockQueuePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  // Filter + Sort state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("created");

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/restock/sessions");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setSessions(data.value ?? data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Filter
  const filtered = useMemo(() => {
    let result = [...sessions];
    if (statusFilter !== "all") {
      result = result.filter((s) => deriveStatus(s) === statusFilter);
    }
    return result;
  }, [sessions, statusFilter]);

  // Sort
  const sorted = useMemo(() => {
    const result = [...filtered];
    switch (sortBy) {
      case "created":
        result.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        break;
      case "assignedDate":
        result.sort((a, b) => {
          if (!a.assignedDate && !b.assignedDate) return 0;
          if (!a.assignedDate) return 1; // nulls last
          if (!b.assignedDate) return -1;
          return (
            new Date(a.assignedDate).getTime() -
            new Date(b.assignedDate).getTime()
          );
        });
        break;
      case "totalNeeded":
        result.sort((a, b) => b.totalNeeded - a.totalNeeded);
        break;
      case "lineCount":
        result.sort((a, b) => b.lineCount - a.lineCount);
        break;
    }
    return result;
  }, [filtered, sortBy]);

  // Summary cards computed from filtered set
  const summary = useMemo(() => {
    const totalSessions = sorted.length;
    const totalDuration = sorted.reduce(
      (sum, s) => sum + (s.durationMinutes ?? 0),
      0,
    );
    const unscheduled = sorted.filter((s) => !s.assignedDate).length;
    const completed = sorted.filter((s) => !!s.completedAt).length;
    return { totalSessions, totalDuration, unscheduled, completed };
  }, [sorted]);

  async function handleGenerate() {
    setGenerating(true);
    setGenResult(null);
    try {
      const res = await fetch("/api/restock/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setGenResult(`❌ ${data.error ?? `Error ${res.status}`}`);
        return;
      }
      if (data.lineCount === 0) {
        setGenResult("ℹ️ No machines need restocking.");
        return;
      }
      setGenResult(
        `✅ Session created: ${data.lineCount} lines across ${data.machines?.length ?? 0} machines`,
      );
      // Refresh session list
      setLoading(true);
      await fetchSessions();
    } catch (err) {
      setGenResult(
        `❌ ${err instanceof Error ? err.message : "Network error"}`,
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Restock Queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational view for managers and stockers
        </p>
      </div>

      {/* Filter row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Stocker filter — disabled until user roles schema allows it */}
        <select
          disabled
          className="rounded border bg-background px-3 py-1.5 text-sm opacity-50 cursor-not-allowed"
          title="Stocker assignment not yet implemented"
        >
          <option>All Stockers</option>
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded border bg-background px-3 py-1.5 text-sm"
        >
          <option value="all">All Status</option>
          <option value="Not Started">Not Started</option>
          <option value="In Progress">In Progress</option>
          <option value="Completed">Completed</option>
        </select>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="rounded border bg-background px-3 py-1.5 text-sm"
        >
          <option value="created">Sort by Created</option>
          <option value="assignedDate">Sort by Assigned Date</option>
          <option value="totalNeeded">Sort by Total Needed</option>
          <option value="lineCount">Sort by Line Count</option>
        </select>

        <div className="flex-1" />

        {/* Map view disabled until geolocation schema is implemented */}
        <button
          disabled
          className="rounded border px-3 py-1.5 text-sm opacity-50 cursor-not-allowed"
          title="Map view not yet implemented"
        >
          View Map
        </button>

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {generating ? "Generating..." : "Generate Route"}
        </button>
      </div>

      {genResult && (
        <div className="mt-2 text-xs text-muted-foreground">{genResult}</div>
      )}

      {/* Main card */}
      <div className="mt-4 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {sorted.length} Session{sorted.length !== 1 ? "s" : ""} in Queue
          </h2>
          {/* Priority legend — based on totalNeeded thresholds */}
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-foreground" />
              Urgent (&gt;100 needed)
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-gray-400" />
              High (50–100)
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-gray-300" />
              Medium (&lt;50)
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="mt-3 overflow-auto">
          <div className="min-w-[750px]">
            <div className="grid grid-cols-[100px_120px_100px_90px_90px_90px_70px] gap-2 border-b pb-2 text-xs font-medium text-muted-foreground">
              <div>Session</div>
              <div>Created</div>
              <div>Assigned Date</div>
              <div>Status</div>
              <div className="text-right">Lines</div>
              <div className="text-right">Needed</div>
              <div>Actions</div>
            </div>

            {loading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading...</p>
            ) : error ? (
              <p className="py-4 text-sm text-red-600">{error}</p>
            ) : sorted.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No restock sessions. Click &quot;Generate Route&quot; to create
                one.
              </p>
            ) : (
              sorted.map((s) => {
                const status = deriveStatus(s);
                const needed = s.totalNeeded;
                const priorityLevel =
                  needed > 100 ? "urgent" : needed >= 50 ? "high" : "medium";

                return (
                  <div
                    key={s.id}
                    className="grid grid-cols-[100px_120px_100px_90px_90px_90px_70px] gap-2 border-b py-2.5 text-sm items-center last:border-0"
                  >
                    {/* Session ID */}
                    <div
                      className="truncate font-mono text-xs"
                      title={s.id}
                    >
                      {s.id.slice(0, 8)}
                    </div>

                    {/* Created */}
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(s.createdAt) ?? "—"}
                    </div>

                    {/* Assigned Date */}
                    <div>
                      {s.assignedDate ? (
                        fmtDate(s.assignedDate)
                      ) : (
                        <span className="inline-block rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Unscheduled
                        </span>
                      )}
                    </div>

                    {/* Status */}
                    <div>
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${status === "Completed"
                            ? "bg-gray-200 text-gray-700"
                            : status === "In Progress"
                              ? "bg-gray-100 text-gray-600"
                              : "bg-muted text-muted-foreground"
                          }`}
                      >
                        {status}
                      </span>
                    </div>

                    {/* Line Count */}
                    <div className="text-right">{s.lineCount}</div>

                    {/* Total Needed */}
                    <div className="text-right flex items-center justify-end gap-1">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${priorityLevel === "urgent"
                            ? "bg-foreground"
                            : priorityLevel === "high"
                              ? "bg-gray-400"
                              : "bg-gray-300"
                          }`}
                      />
                      {needed}
                    </div>

                    {/* Actions */}
                    <div>
                      {/* Details view stubbed for MVP */}
                      <button disabled className="rounded border px-2 py-0.5 text-xs opacity-50 cursor-not-allowed hover:bg-muted" title="Session details view not yet implemented">
                        Details
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total Sessions" value={String(summary.totalSessions)} />
        <SummaryCard
          label="Estimated Total Duration"
          value={
            summary.totalDuration > 0
              ? `${summary.totalDuration} min`
              : "—"
          }
        />
        <SummaryCard label="Unscheduled" value={String(summary.unscheduled)} />
        <SummaryCard label="Completed" value={String(summary.completed)} />
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
