"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { RefreshCw, Calendar, ChevronDown, ArrowLeft, Clock, List } from "lucide-react";

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function getMonthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    opts.push({
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      start: fmtDate(new Date(d.getFullYear(), d.getMonth(), 1)),
      end: fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    });
  }
  return opts;
}

type Tab = "subscriptions" | "resource-groups" | "services" | "tags";

interface CostRow {
  label: string;
  sublabel?: string;
  actual_cost: number;
  amortized_cost: number;
  savings: number;
  true_cost: number;
}

interface SyncLog {
  id: string;
  status: string;
  triggered_by: string;
  records_synced: number;
  date_range_start: string;
  date_range_end: string;
  started_at: string;
  finished_at: string;
  error_message?: string;
}

export default function AzureTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const dropRef = useRef<HTMLDivElement>(null);
  const months = getMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(months[0]);
  const [showDrop, setShowDrop] = useState(false);
  const [tab, setTab] = useState<Tab>("subscriptions");
  const [rows, setRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tagKey, setTagKey] = useState("");
  const [tagKeys, setTagKeys] = useState<string[]>([]);
  const [tenantName, setTenantName] = useState("Azure Tenant");
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    api.get("/towers/").then((r) => {
      const t = (r.data as any[]).find((t) => t.id === id);
      if (t) setTenantName(t.name);
    }).catch(() => {});
    api.get("/azure-costs/tag-keys").then((r) => {
      setTagKeys(r.data);
      if (r.data.length > 0) setTagKey(r.data[0]);
    }).catch(() => {});
  }, [id]);

  const loadData = async (t: Tab = tab, start = selectedMonth.start, end = selectedMonth.end) => {
    setLoading(true);
    setRows([]);
    try {
      let url = "";
      const params: any = { start_date: start, end_date: end };
      if (t === "subscriptions") url = "/azure-costs/subscriptions";
      else if (t === "resource-groups") url = "/azure-costs/resource-groups";
      else if (t === "services") url = "/azure-costs/services";
      else if (t === "tags") { url = "/azure-costs/tags"; params.tag_key = tagKey || "Environment"; }

      const res = await api.get(url, { params });
      const data = res.data as any[];

      setRows(data.map((r: any) => ({
        label: r.subscription_name || r.resource_group || r.service || r.tag_value || "—",
        sublabel: r.subscription_id || r.subscription_name || r.tag_key,
        actual_cost: r.actual_cost || 0,
        amortized_cost: r.amortized_cost || 0,
        savings: r.savings || 0,
        true_cost: r.true_cost || 0,
      })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []); // eslint-disable-line

  const switchTab = (t: Tab) => { setTab(t); loadData(t); };

  const applyMonth = (m: typeof months[0]) => {
    setSelectedMonth(m);
    setShowDrop(false);
    loadData(tab, m.start, m.end);
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await api.get("/reports/sync-logs?limit=50");
      const all = res.data as any[];
      setLogs(all.filter((l) => l.control_tower_id === id));
    } catch {} finally { setLogsLoading(false); }
  };

  const openLogs = () => { setShowLogs(true); loadLogs(); };

  const totalActual = rows.reduce((s, r) => s + r.actual_cost, 0);
  const totalSavings = rows.reduce((s, r) => s + r.savings, 0);
  const totalTrue = rows.reduce((s, r) => s + r.true_cost, 0);

  const tabs: { key: Tab; label: string }[] = [
    { key: "subscriptions", label: "Subscription" },
    { key: "resource-groups", label: "Resource Group" },
    { key: "services", label: "Service" },
    { key: "tags", label: "Tags" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/clouds/azure")}
            className="p-2 rounded-md border border-gray-300 hover:bg-gray-50 transition">
            <ArrowLeft className="w-4 h-4 text-black" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-black">{tenantName}</h1>
            <p className="text-sm text-gray-500 mt-0.5">Azure Cost Explorer · {selectedMonth.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Sync Logs button */}
          <button onClick={openLogs}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
            <List className="w-3.5 h-3.5" /> Sync Logs
          </button>

          {/* Month selector */}
          <div className="relative" ref={dropRef}>
            <button onClick={() => setShowDrop((p) => !p)}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md bg-white text-xs font-bold text-black hover:border-blue-900 transition min-w-[160px] justify-between">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                {selectedMonth.label}
              </div>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {showDrop && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[160px] max-h-64 overflow-y-auto">
                {months.map((m) => (
                  <button key={m.start} onClick={() => applyMonth(m)}
                    className={`w-full text-left px-4 py-2.5 text-xs font-semibold hover:bg-blue-50 transition ${m.start === selectedMonth.start ? "bg-blue-900 text-white" : "text-black"}`}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => loadData()}
            className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition">
            <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: "Actual Cost", value: totalActual, color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200" },
          { label: "Savings (RI/SP)", value: totalSavings, color: "text-green-700", bg: "bg-green-50", border: "border-green-200" },
          { label: "True Cost (Amortized)", value: totalTrue, color: "text-blue-900", bg: "bg-blue-50", border: "border-blue-200" },
        ].map((c) => (
          <div key={c.label} className={`rounded-lg border ${c.border} ${c.bg} px-5 py-4`}>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">{c.label}</div>
            <div className={`text-2xl font-bold font-mono ${c.color}`}>{fmtINR(c.value)}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`px-4 py-2.5 text-xs font-bold transition border-b-2 -mb-px ${tab === t.key ? "border-blue-900 text-blue-900" : "border-transparent text-gray-500 hover:text-black"}`}>
            {t.label}
          </button>
        ))}
        {tab === "tags" && (
          <select value={tagKey} onChange={(e) => { setTagKey(e.target.value); loadData("tags", selectedMonth.start, selectedMonth.end); }}
            className="ml-4 border border-gray-300 rounded-md px-2 py-1.5 text-xs font-semibold text-black bg-white focus:outline-none focus:border-blue-600">
            {tagKeys.map((k) => <option key={k}>{k}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-300">
              <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700">
                {tab === "subscriptions" ? "Subscription" : tab === "resource-groups" ? "Resource Group" : tab === "services" ? "Service" : "Tag Value"}
              </th>
              {tab !== "subscriptions" && <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700">Subscription</th>}
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700">
                <div className="flex items-center justify-end gap-1.5"><div className="w-2 h-2 rounded-full bg-orange-500" />Actual Cost</div>
              </th>
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700">
                <div className="flex items-center justify-end gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500" />Savings</div>
              </th>
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700">
                <div className="flex items-center justify-end gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500" />True Cost</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {[...Array(5)].map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className={`h-3 bg-gray-200 rounded animate-pulse ${j >= 2 ? "ml-auto" : ""}`}
                        style={{ width: j >= 2 ? "90px" : j === 0 ? "160px" : "120px" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-sm text-gray-400">No data for this period</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-blue-50 transition">
                  <td className="px-4 py-3 text-sm font-semibold text-black">{r.label}</td>
                  {tab !== "subscriptions" && <td className="px-4 py-3 text-xs text-gray-500">{r.sublabel || "—"}</td>}
                  <td className="px-4 py-3 text-right text-sm font-mono text-orange-700">{fmtINR(r.actual_cost)}</td>
                  <td className="px-4 py-3 text-right text-sm font-mono text-green-700">
                    {r.savings > 0 ? fmtINR(r.savings) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-900">{fmtINR(r.true_cost)}</td>
                </tr>
              ))
            )}
            {!loading && rows.length > 0 && (
              <tr className="border-t-2 border-gray-300 bg-gray-50">
                <td className="px-4 py-3 text-sm font-bold text-black" colSpan={tab !== "subscriptions" ? 2 : 1}>Total</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-orange-700">{fmtINR(totalActual)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-green-700">{fmtINR(totalSavings)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-900">{fmtINR(totalTrue)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sync Logs Drawer */}
      {showLogs && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setShowLogs(false)}>
          <div className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-bold text-black flex items-center gap-2"><Clock className="w-4 h-4" /> Sync Logs</h2>
              <button onClick={() => setShowLogs(false)} className="text-gray-400 hover:text-black text-xl font-bold">×</button>
            </div>
            {logsLoading ? (
              <div className="flex items-center justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-900" /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-20 text-sm text-gray-400">No sync logs found</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {logs.map((l) => (
                  <div key={l.id} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${
                        l.status === "completed" ? "bg-green-100 text-green-800 border-green-300"
                        : l.status === "failed" ? "bg-red-100 text-red-800 border-red-300"
                        : "bg-yellow-100 text-yellow-800 border-yellow-300"
                      }`}>{l.status}</span>
                      <span className="text-xs text-gray-400">{new Date(l.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-600 mt-1">
                      <span>By: <strong>{l.triggered_by}</strong></span>
                      <span>Records: <strong>{l.records_synced?.toLocaleString() ?? "—"}</strong></span>
                      {l.date_range_start && <span>Range: <strong>{l.date_range_start} → {l.date_range_end}</strong></span>}
                      {l.finished_at && l.started_at && (
                        <span>Duration: <strong>{Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000)}s</strong></span>
                      )}
                    </div>
                    {l.error_message && <div className="text-xs text-red-600 mt-1 truncate">{l.error_message}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
