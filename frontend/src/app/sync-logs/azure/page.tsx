"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import { RefreshCw, ArrowLeft, Play } from "lucide-react";
import toast from "react-hot-toast";

function fmtD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function getMonthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    opts.push({
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      start: fmtD(new Date(d.getFullYear(), d.getMonth(), 1)),
      end: fmtD(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    });
  }
  return opts;
}

export default function AzureSyncLogsPage() {
  const { token, user } = useAuthStore();
  const router = useRouter();
  const months = getMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(months[1]); // last month default
  const [azureTowers, setAzureTowers] = useState<any[]>([]);
  const [selectedTower, setSelectedTower] = useState("");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!token) { router.push("/auth"); return; }
    if (user && user.role === "viewer") router.push("/dashboard");
    api.get("/towers/").then((r) => {
      const azure = (r.data as any[]).filter((t) => t.cloud_provider === "azure");
      setAzureTowers(azure);
      if (azure.length > 0) setSelectedTower(azure[0].id);
    }).catch(() => {});
  }, [token, user]); // eslint-disable-line

  const { data: logs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["azure-sync-logs"],
    queryFn: async () => {
      const [logsRes, towersRes] = await Promise.all([
        api.get("/reports/sync-logs?limit=100").then((r) => r.data),
        api.get("/towers/").then((r) => r.data),
      ]);
      const azureIds = new Set((towersRes as any[]).filter((t) => t.cloud_provider === "azure").map((t) => t.id));
      return (logsRes as any[]).filter((l) => azureIds.has(l.control_tower_id));
    },
    enabled: !!token,
    refetchInterval: 15000,
  });

  const triggerSync = async () => {
    if (!selectedTower) return;
    setSyncing(true);
    try {
      await api.post(`/towers/${selectedTower}/sync`, null, {
        params: { start_date: selectedMonth.start, end_date: selectedMonth.end },
      });
      toast.success(`Sync started for ${selectedMonth.label}`);
      setTimeout(() => refetch(), 2000);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Sync failed");
    } finally { setSyncing(false); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/clouds/azure")}
            className="p-2 rounded-md border border-gray-300 hover:bg-gray-50 transition">
            <ArrowLeft className="w-4 h-4 text-black" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-black">Azure Sync Logs</h1>
            <p className="text-sm mt-0.5 text-black">History of all Azure cost data sync operations</p>
          </div>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-semibold text-black bg-white border-gray-400 hover:border-blue-900 hover:text-blue-900 transition disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Sync trigger panel */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-bold text-black mb-3">Trigger Sync for Specific Month</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {azureTowers.length > 1 && (
            <select value={selectedTower} onChange={(e) => setSelectedTower(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-600">
              {azureTowers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <select value={selectedMonth.start} onChange={(e) => {
            const m = months.find((m) => m.start === e.target.value);
            if (m) setSelectedMonth(m);
          }} className="border border-gray-300 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-600 min-w-[180px]">
            {months.map((m) => <option key={m.start} value={m.start}>{m.label}</option>)}
          </select>
          <div className="text-xs text-gray-500 font-mono">{selectedMonth.start} → {selectedMonth.end}</div>
          <button onClick={triggerSync} disabled={syncing || !selectedTower}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
            <Play className="w-3.5 h-3.5" />
            {syncing ? "Starting..." : `Sync ${selectedMonth.label}`}
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">This will sync only the selected month instead of the full dataset.</p>
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
                {["Tenant", "Triggered By", "Status", "Records", "Date Range", "Duration", "Started At", "Finished At"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td colSpan={8} className="text-center py-16 text-sm text-black">No Azure sync logs yet.</td></tr>
              )}
              {logs.map((l: any) => (
                <tr key={l.id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                  <td className="px-4 py-3 text-sm font-bold text-black">{l.control_tower_name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded border ${l.triggered_by === "manual" ? "bg-blue-100 text-blue-900 border-blue-300" : "bg-indigo-100 text-indigo-900 border-indigo-300"}`}>
                      {l.triggered_by}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded border ${
                      l.status === "completed" ? "bg-green-100 text-green-900 border-green-300"
                      : l.status === "failed" ? "bg-red-100 text-red-900 border-red-300"
                      : "bg-yellow-100 text-yellow-900 border-yellow-300"
                    }`}>{l.status}</span>
                    {l.error_message && (
                      <div className="text-xs mt-1 text-red-800 max-w-[200px] truncate font-medium" title={l.error_message}>{l.error_message}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-black">{l.records_synced?.toLocaleString() ?? "—"}</td>
                  <td className="px-4 py-3 text-xs font-mono font-semibold text-black">
                    {l.date_range_start && l.date_range_end ? `${l.date_range_start} → ${l.date_range_end}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-black">
                    {l.finished_at && l.started_at ? `${Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000)}s` : "—"}
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
