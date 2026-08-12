"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import { RefreshCw } from "lucide-react";

export default function SyncLogsPage() {
  const { token, user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!token) { router.push("/auth"); return; }
    if (user && user.role === "viewer") router.push("/aws");
  }, [token, user]);

  const [refreshing, setRefreshing] = useState(false);
  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ["sync-logs"],
    queryFn: async () => {
      const [logsRes, towersRes] = await Promise.all([
        api.get("/reports/sync-logs?limit=100").then((r) => r.data),
        api.get("/towers/").then((r) => r.data),
      ]);
      const azureIds = new Set(
        (towersRes as any[]).filter((t) => t.cloud_provider === "azure").map((t) => t.id)
      );
      return (logsRes as any[]).filter((l) => !azureIds.has(l.control_tower_id));
    },
    enabled: !!token,
    refetchInterval: 15000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black">Sync Logs</h1>
          <p className="text-sm mt-0.5 text-black">History of all cost data sync operations</p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-semibold text-black bg-white border-gray-400 hover:border-blue-900 hover:text-blue-900 transition disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin border-blue-900" />
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-300 overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-300">
                {["Control Tower", "Triggered By", "Status", "Records", "Date Range", "Duration", "Started At", "Finished At"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td colSpan={8} className="text-center py-16 text-sm text-black">No sync logs yet.</td></tr>
              )}
              {logs.map((l: any) => (
                <tr key={l.id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                  <td className="px-4 py-3 text-sm font-bold text-black">{l.control_tower_name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded border ${
                      l.triggered_by === "manual"
                        ? "bg-blue-100 text-blue-900 border-blue-300"
                        : "bg-indigo-100 text-indigo-900 border-indigo-300"
                    }`}>{l.triggered_by}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded border ${
                      l.status === "completed" ? "bg-green-100 text-green-900 border-green-300"
                      : l.status === "failed" ? "bg-red-100 text-red-900 border-red-300"
                      : "bg-yellow-100 text-yellow-900 border-yellow-300"
                    }`}>{l.status}</span>
                    {l.error_message && (
                      <div className="text-xs mt-1 text-red-800 max-w-[200px] truncate font-medium" title={l.error_message}>
                        {l.error_message}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-black">{l.records_synced?.toLocaleString() ?? "—"}</td>
                  <td className="px-4 py-3 text-xs font-mono font-semibold text-black">
                    {l.date_range_start && l.date_range_end ? `${l.date_range_start} → ${l.date_range_end}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-black">
                    {l.finished_at && l.started_at
                      ? `${Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000)}s`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-black">
                    {new Date(l.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-black">
                    {l.finished_at ? new Date(l.finished_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
