"use client";

import { useEffect, useState, useCallback } from "react";

export const dynamic = "force-dynamic";

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

type Tab = "open" | "completed";

export default function RestockSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("open");
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState("");

  const fetchSessions = useCallback(() => {
    setLoading(true);
    fetch("/api/restock/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d as Session[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const openSessions = sessions.filter((s) => !s.completedAt);
  const completedSessions = sessions.filter((s) => s.completedAt);
  const displayed = tab === "open" ? openSessions : completedSessions;

  async function handleGenerate() {
    setGenerating(true);
    setActionError(null);
    try {
      const body: Record<string, string> = {};
      if (dateInput) body.assignedDate = dateInput;
      const res = await fetch("/api/restock/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? `Error ${res.status}`);
      } else if (data.sessionId) {
        fetchSessions();
      } else {
        setActionError(data.message ?? "No machines need restocking.");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setGenerating(false);
    }
  }

  async function handleStart(sessionId: string) {
    setActionError(null);
    try {
      const res = await fetch("/api/restock/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? `Error ${res.status}`);
      } else {
        fetchSessions();
      }
    } catch {
      setActionError("Network error");
    }
  }

  async function handleAssignDate(sessionId: string) {
    const date = prompt("Enter assigned date (YYYY-MM-DD):");
    if (!date) return;
    setActionError(null);
    try {
      const res = await fetch("/api/restock/assign-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, assignedDate: date }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? `Error ${res.status}`);
      } else {
        fetchSessions();
      }
    } catch {
      setActionError("Network error");
    }
  }

  function fmtDate(iso: string | null) {
    if (!iso) return "-";
    return new Date(iso).toLocaleDateString();
  }

  function fmtTime(iso: string | null) {
    if (!iso) return "-";
    return new Date(iso).toLocaleString();
  }

  function statusLabel(s: Session) {
    if (s.completedAt) return "Completed";
    if (s.startedAt) return "In Progress";
    return "Pending";
  }

  function statusColor(s: Session) {
    if (s.completedAt) return "text-green-700 bg-green-50";
    if (s.startedAt) return "text-yellow-700 bg-yellow-50";
    return "text-gray-700 bg-gray-50";
  }

  return (
    <main className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Restock Sessions</h1>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5">
              Assigned Date (optional)
            </label>
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className="rounded border px-2 py-1 text-sm"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate Session"}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="mt-4 flex gap-1 rounded-lg border p-0.5 text-sm w-fit">
        <button
          onClick={() => setTab("open")}
          className={`rounded-md px-3 py-1 ${tab === "open" ? "bg-primary text-primary-foreground" : ""}`}
        >
          Open ({openSessions.length})
        </button>
        <button
          onClick={() => setTab("completed")}
          className={`rounded-md px-3 py-1 ${tab === "completed" ? "bg-primary text-primary-foreground" : ""}`}
        >
          Completed ({completedSessions.length})
        </button>
      </div>

      {loading && (
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      )}

      {!loading && displayed.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No {tab} sessions.
        </p>
      )}

      {!loading && displayed.length > 0 && (
        <div className="mt-4 space-y-3">
          {displayed.map((s) => (
            <div key={s.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(s)}`}
                    >
                      {statusLabel(s)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                    <div>
                      <span className="text-muted-foreground">Date: </span>
                      {fmtDate(s.assignedDate)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Lines: </span>
                      {s.lineCount}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Total Needed:{" "}
                      </span>
                      {s.totalNeeded}
                    </div>
                    {s.durationMinutes !== null && (
                      <div>
                        <span className="text-muted-foreground">
                          Duration:{" "}
                        </span>
                        {s.durationMinutes} min
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created: {fmtTime(s.createdAt)}
                    {s.startedAt && <> | Started: {fmtTime(s.startedAt)}</>}
                    {s.completedAt && (
                      <> | Completed: {fmtTime(s.completedAt)}</>
                    )}
                  </div>
                </div>

                {/* Actions for open sessions */}
                {!s.completedAt && (
                  <div className="flex gap-2 shrink-0">
                    {!s.assignedDate && (
                      <button
                        onClick={() => handleAssignDate(s.id)}
                        className="rounded border px-3 py-1 text-xs hover:bg-muted"
                      >
                        Assign Date
                      </button>
                    )}
                    {!s.startedAt && (
                      <button
                        onClick={() => handleStart(s.id)}
                        className="rounded border px-3 py-1 text-xs hover:bg-muted"
                      >
                        Start
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
