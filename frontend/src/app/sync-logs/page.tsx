"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import { RefreshCw } from "lucide-react";

export default function SyncLogsPage() {
  const { token, user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!token) { router.push("/auth"); return; }
    if (user && user.role === "viewer") router.push("/dashboard");
  }, [token, user]);

  const [refreshing, setRefreshing] = useState(false);
  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ["sync-logs"],
    queryFn: () => api.get("/reports/sync-logs?limit=100").then((r) => r.data),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>Sync Logs</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              History of all cost data sync operations
            </p>
          </div>
          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium transition disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "white" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--primary)"; (e.currentTarget as HTMLElement).style.color = "var(--primary)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "2px solid var(--border)" }}>
                  {["Control Tower", "Triggered By", "Status", "Records", "Date Range", "Duration", "Started At", "Finished At"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                      style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-16 text-sm" style={{ color: "var(--text-muted)" }}>
                      No sync logs yet.
                    </td>
                  </tr>
                )}
                {logs.map((l: any) => (
                  <tr key={l.id} className="transition"
                    style={{ borderBottom: "1px solid #f0f4f8" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>

                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {l.control_tower_name}
                    </td>

                    <td className="px-4 py-3">
                      <span className={l.triggered_by === "manual" ? "badge-info" : "badge-primary"}>
                        {l.triggered_by}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span className={
                        l.status === "completed" ? "badge-success"
                        : l.status === "failed" ? "badge-danger"
                        : "badge-warning"
                      }>
                        {l.status}
                      </span>
                      {l.error_message && (
                        <div className="text-xs mt-1 max-w-[200px] truncate" style={{ color: "var(--danger)" }}
                          title={l.error_message}>
                          {l.error_message}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {l.records_synced?.toLocaleString() ?? "—"}
                    </td>

                    <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                      {l.date_range_start && l.date_range_end
                        ? `${l.date_range_start} → ${l.date_range_end}`
                        : "—"}
                    </td>

                    <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {l.finished_at && l.started_at
                        ? `${Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000)}s`
                        : "—"}
                    </td>

                    <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {new Date(l.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </td>

                    <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {l.finished_at
                        ? new Date(l.finished_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
