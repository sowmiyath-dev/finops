"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { RefreshCw, ArrowLeft, Clock, List, TrendingDown } from "lucide-react";
import Link from "next/link";

function fmtD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function fmtINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function getLastMonth() {
  const n = new Date();
  return { start: fmtD(new Date(n.getFullYear(), n.getMonth()-1, 1)), end: fmtD(new Date(n.getFullYear(), n.getMonth(), 0)) };
}
const PRESETS = [
  { label: "This Month", fn: () => { const n=new Date(); return { start: fmtD(new Date(n.getFullYear(),n.getMonth(),1)), end: fmtD(n) }; }},
  { label: "Last Month", fn: () => getLastMonth() },
  { label: "Last 7d", fn: () => { const n=new Date(); const s=new Date(n); s.setDate(s.getDate()-6); return { start: fmtD(s), end: fmtD(n) }; }},
  { label: "Last 30d", fn: () => { const n=new Date(); const s=new Date(n); s.setDate(s.getDate()-29); return { start: fmtD(s), end: fmtD(n) }; }},
];

type Tab = "subscriptions" | "resource-groups" | "services" | "tags";
interface CostRow { label: string; sublabel?: string; subscription_id?: string; actual_cost: number; amortized_cost: number; savings: number; true_cost: number; }
interface SyncLog { id: string; status: string; triggered_by: string; records_synced: number; date_range_start: string; date_range_end: string; started_at: string; finished_at: string; error_message?: string; }

export default function AzureTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const lm = getLastMonth();
  const [startDate, setStartDate] = useState(lm.start);
  const [endDate, setEndDate] = useState(lm.end);
  const [activePreset, setActivePreset] = useState("Last Month");
  const [tab, setTab] = useState<Tab>("subscriptions");
  const [rows, setRows] = useState<CostRow[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tagKey, setTagKey] = useState("");
  const [tagKeys, setTagKeys] = useState<string[]>([]);
  const [tenantName, setTenantName] = useState("Azure Tenant");
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [spResources, setSpResources] = useState<any[]>([]);
  const [spLoading, setSpLoading] = useState(false);
  const [showSpModal, setShowSpModal] = useState(false);

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

  const loadData = async (t: Tab = tab, start = startDate, end = endDate) => {
    setLoading(true); setRows([]);
    try {
      if (t === "subscriptions") {
        // Use combined overview endpoint for fast initial load
        const res = await api.get("/azure-costs/overview", { params: { start_date: start, end_date: end } });
        setSummary(res.data.summary);
        setRows(res.data.subscriptions.map((r: any) => ({
          label: r.subscription_name, sublabel: r.subscription_id,
          subscription_id: r.subscription_id,
          actual_cost: r.actual_cost, amortized_cost: r.amortized_cost,
          savings: r.savings, true_cost: r.true_cost,
        })));
      } else {
        const [sumRes, tabRes] = await Promise.all([
          api.get("/azure-costs/summary", { params: { start_date: start, end_date: end } }),
          api.get(
            t === "resource-groups" ? "/azure-costs/resource-groups"
            : t === "services" ? "/azure-costs/services"
            : "/azure-costs/tags",
            { params: { start_date: start, end_date: end, ...(t === "tags" ? { tag_key: tagKey || "Environment" } : {}) } }
          ),
        ]);
        setSummary(sumRes.data);
        setRows((tabRes.data as any[]).map((r: any) => ({
          label: r.resource_group || r.service || r.tag_value || "—",
          sublabel: r.subscription_name || r.tag_key,
          actual_cost: r.actual_cost || 0, amortized_cost: r.amortized_cost || 0,
          savings: r.savings || 0, true_cost: r.true_cost || 0,
        })));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []); // eslint-disable-line

  const applyPreset = (p: typeof PRESETS[0]) => {
    const r = p.fn(); setStartDate(r.start); setEndDate(r.end); setActivePreset(p.label);
    loadData(tab, r.start, r.end);
  };

  const switchTab = (t: Tab) => { setTab(t); loadData(t); };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await api.get("/reports/sync-logs?limit=50");
      setLogs((res.data as any[]).filter((l) => l.control_tower_id === id));
    } catch {} finally { setLogsLoading(false); }
  };

  const openLogs = () => { setShowLogs(true); loadLogs(); };

  const openSpModal = async () => {
    setShowSpModal(true); setSpResources([]); setSpLoading(true);
    try {
      const res = await api.get("/azure-costs/savings-resources", { params: { start_date: startDate, end_date: endDate } });
      setSpResources(res.data);
    } catch {} finally { setSpLoading(false); }
  };

  const totalActual = summary?.actual_cost || 0;
  const totalSavings = summary?.savings || 0;
  const totalTrue = summary?.true_cost || 0;

  const tabs: { key: Tab; label: string }[] = [
    { key: "subscriptions", label: "Subscription" },
    { key: "resource-groups", label: "Resource Group" },
    { key: "services", label: "Service" },
    { key: "tags", label: "Tags" },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-5">
        <button onClick={() => router.push("/clouds/azure")} className="text-black hover:text-blue-900 font-medium flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Azure
        </button>
        <span className="text-gray-400">/</span>
        <span className="font-bold text-black">{tenantName}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black">{tenantName}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{startDate} → {endDate}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p)}
                className={`px-3 py-2 text-xs font-bold transition border-l border-gray-300 first:border-l-0 ${
                  activePreset === p.label ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                }`}>{p.label}</button>
            ))}
          </div>
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setActivePreset(""); }}
            className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          <span className="text-xs text-black">to</span>
          <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setActivePreset(""); }}
            className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          <button onClick={() => loadData(tab, startDate, endDate)}
            className="px-3 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition">Apply</button>
          <button onClick={openLogs}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
            <List className="w-3.5 h-3.5" /> Sync Logs
          </button>
          <button onClick={() => loadData()}
            className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition">
            <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">Actual Cost</div>
          <div className="text-2xl font-bold font-mono text-orange-700">{fmtINR(totalActual)}</div>
          <div className="text-xs text-gray-400 mt-1">Pay-as-you-go</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">SP/RI Allocated</div>
          <div className="text-2xl font-bold font-mono text-green-700">{fmtINR(totalSavings)}</div>
          <button onClick={openSpModal}
            className="text-xs font-bold text-blue-900 hover:underline flex items-center gap-1 mt-1">
            <TrendingDown className="w-3 h-3" /> View Details
          </button>
        </div>
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">True Cost (Amortized)</div>
          <div className="text-2xl font-bold font-mono text-blue-900">{fmtINR(totalTrue)}</div>
          <div className="text-xs text-gray-400 mt-1">After RI/SP allocation</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">Savings %</div>
          <div className="text-2xl font-bold font-mono text-green-700">
            {totalActual > 0 ? `${((totalSavings / totalActual) * 100).toFixed(1)}%` : "—"}
          </div>
          <div className="text-xs text-gray-400 mt-1">vs on-demand</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`px-4 py-2.5 text-xs font-bold transition border-b-2 -mb-px ${
              tab === t.key ? "border-blue-900 text-blue-900" : "border-transparent text-gray-500 hover:text-black"
            }`}>{t.label}</button>
        ))}
        {tab === "tags" && (
          <select value={tagKey} onChange={(e) => { setTagKey(e.target.value); loadData("tags", startDate, endDate); }}
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
              {tab === "subscriptions" && <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700">Subscription ID</th>}
              {tab !== "subscriptions" && <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700">Subscription</th>}
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700"><div className="flex items-center justify-end gap-1.5"><div className="w-2 h-2 rounded-full bg-orange-500" />Actual Cost</div></th>
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700"><div className="flex items-center justify-end gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500" />SP Savings</div></th>
              <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700"><div className="flex items-center justify-end gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-600" />True Cost</div></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {[...Array(5)].map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className={`h-3 bg-gray-200 rounded animate-pulse ${j>=2?"ml-auto":""}`} style={{width:j>=2?"90px":j===0?"160px":"120px"}} /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-sm text-gray-400">No data for this period</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-blue-50 transition">
                  <td className="px-4 py-3">
                    {tab === "subscriptions" ? (
                      <button
                        onClick={() => router.push(`/clouds/azure/${id}/subscription/${encodeURIComponent(r.subscription_id || r.label)}?name=${encodeURIComponent(r.label)}&start=${startDate}&end=${endDate}`)}
                        className="text-sm font-bold text-blue-900 hover:underline flex items-center gap-1">
                        {r.label}
                      </button>
                    ) : (
                      <span className="text-sm font-semibold text-black">{r.label}</span>
                    )}
                  </td>
                  {tab === "subscriptions" && <td className="px-4 py-3 text-xs font-mono text-gray-500">{r.subscription_id || "—"}</td>}
                  {tab !== "subscriptions" && <td className="px-4 py-3 text-xs text-gray-500">{r.sublabel || "—"}</td>}
                  <td className="px-4 py-3 text-right text-sm font-mono text-orange-700">{fmtINR(r.actual_cost)}</td>
                  <td className="px-4 py-3 text-right text-sm font-mono text-green-700">{r.savings > 0 ? fmtINR(r.savings) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-900">{fmtINR(r.true_cost)}</td>
                </tr>
              ))
            )}
            {!loading && rows.length > 0 && (
              <tr className="border-t-2 border-gray-300 bg-gray-50">
                <td className="px-4 py-3 text-sm font-bold text-black" colSpan={2}>Total</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-orange-700">{fmtINR(totalActual)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-green-700">{fmtINR(totalSavings)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-900">{fmtINR(totalTrue)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* SP Resources Modal */}
      {showSpModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h3 className="text-sm font-bold text-black flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-green-700" /> RI/SP Covered Resources
                </h3>
                <p className="text-[10px] text-gray-500 mt-0.5">{startDate} → {endDate}</p>
              </div>
              <button onClick={() => setShowSpModal(false)} className="p-1.5 rounded hover:bg-gray-100"><span className="text-black font-bold">✕</span></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {spLoading ? (
                <div className="flex items-center justify-center h-40"><RefreshCw className="w-5 h-5 animate-spin text-blue-900" /></div>
              ) : spResources.length === 0 ? (
                <div className="p-12 text-center text-sm text-gray-500">No RI/SP covered resources found for this period.</div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      {["#","Resource","Service","Resource Group","Subscription","Model","Actual Cost","Amortized","Savings","Savings %"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {spResources.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-gray-200 hover:bg-blue-50 transition">
                        <td className="px-4 py-2.5 text-xs font-bold text-gray-400">{i+1}</td>
                        <td className="px-4 py-2.5 text-xs font-mono font-semibold text-black max-w-[180px] truncate">{r.resource_name}</td>
                        <td className="px-4 py-2.5"><span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900">{r.service}</span></td>
                        <td className="px-4 py-2.5 text-xs text-black">{r.resource_group || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{r.subscription_name || "—"}</td>
                        <td className="px-4 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded ${r.pricing_model==="Reservation"?"bg-purple-100 text-purple-800":"bg-green-100 text-green-800"}`}>{r.pricing_model}</span></td>
                        <td className="px-4 py-2.5 text-sm font-mono text-orange-700">{fmtINR(r.actual_cost)}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-blue-900">{fmtINR(r.amortized_cost)}</td>
                        <td className="px-4 py-2.5 text-sm font-bold font-mono text-green-700">{fmtINR(r.savings)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-14 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-green-600" style={{width:`${Math.min(r.savings_pct,100)}%`}} />
                            </div>
                            <span className="text-xs font-bold text-green-700">{r.savings_pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 border-t-2 border-gray-300">
                      <td className="px-4 py-3 text-sm font-bold text-black" colSpan={6}>Total ({spResources.length} resources)</td>
                      <td className="px-4 py-3 text-sm font-bold font-mono text-orange-700">{fmtINR(spResources.reduce((s:number,r:any)=>s+r.actual_cost,0))}</td>
                      <td className="px-4 py-3 text-sm font-bold font-mono text-blue-900">{fmtINR(spResources.reduce((s:number,r:any)=>s+r.amortized_cost,0))}</td>
                      <td className="px-4 py-3 text-sm font-bold font-mono text-green-700">{fmtINR(spResources.reduce((s:number,r:any)=>s+r.savings,0))}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

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
