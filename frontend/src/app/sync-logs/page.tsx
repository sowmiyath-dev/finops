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
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Sync Logs</h1>
            <p className="text-slate-400 text-sm mt-0.5">History of all cost data sync operations</p>
          </div>
          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white rounded-lg text-sm transition disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-800/50">
                  {["Control Tower", "Triggered By", "Status", "Records", "Date Range", "Duration", "Started At", "Finished At"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-16 text-slate-500">No sync logs yet.</td></tr>
                )}
                {logs.map((l: any) => (
                  <tr key={l.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                    <td className="px-4 py-3 text-sm text-white font-medium">{l.control_tower_name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${l.triggered_by === "manual" ? "bg-[#06b6d4]/20 text-[#22d3ee]" : "bg-violet-500/20 text-violet-400"}`}>
                        {l.triggered_by}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        l.status === "completed" ? "bg-emerald-500/20 text-emerald-400"
                        : l.status === "failed" ? "bg-red-500/20 text-red-400"
                        : "bg-amber-500/20 text-amber-400"
                      }`}>
                        {l.status}
                      </span>
                      {l.error_message && (
                        <div className="text-[10px] text-red-400 mt-0.5 max-w-[160px] truncate" title={l.error_message}>
                          {l.error_message}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">{l.records_synced?.toLocaleString() ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {l.date_range_start && l.date_range_end ? `${l.date_range_start} → ${l.date_range_end}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {l.finished_at && l.started_at
                        ? `${Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000)}s`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(l.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {l.finished_at ? new Date(l.finished_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}
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
