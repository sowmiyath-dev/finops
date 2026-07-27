"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { Download, RefreshCw, ChevronLeft, TrendingDown, DollarSign, Zap, BarChart2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");

function fd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PRESETS = [
  { label: "This Month", fn: () => { const n=new Date(); return { s: fd(new Date(n.getFullYear(),n.getMonth(),1)), e: fd(n) }; } },
  { label: "Last Month", fn: () => { const n=new Date(); return { s: fd(new Date(n.getFullYear(),n.getMonth()-1,1)), e: fd(new Date(n.getFullYear(),n.getMonth(),0)) }; } },
  { label: "Last 3M",    fn: () => { const n=new Date(); const s=new Date(n); s.setMonth(s.getMonth()-3); return { s: fd(s), e: fd(n) }; } },
  { label: "This Year",  fn: () => { const n=new Date(); return { s: `${n.getFullYear()}-01-01`, e: fd(n) }; } },
];

type ViewMode = "subscription" | "resource";

interface SubRow {
  subscription_id: string; subscription_name: string;
  actual_cost: number; amortized_cost: number;
  savings: number; savings_pct?: number;
  pricing_model?: string;
}

interface ResourceRow {
  resource_id: string; resource_name: string;
  service: string; resource_group: string;
  subscription_name: string; pricing_model: string;
  actual_cost: number; amortized_cost: number;
  savings: number; savings_pct: number;
}

interface Summary {
  actual_cost: number; amortized_cost: number;
  savings: number; sp_allocated: number; true_cost: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[200px]">
      <p className="text-xs font-bold text-black mb-2 border-b border-gray-100 pb-1.5 truncate">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: p.fill || p.color }} />
            <span className="text-xs text-black">{p.name}</span>
          </div>
          <span className="text-xs font-bold font-mono text-blue-900">{fmt(p.value || 0)}</span>
        </div>
      ))}
    </div>
  );
};

export default function AzureSavingsPage() {
  const { token } = useAuthStore();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const router = useRouter();
  const getHeaders = () => ({ Authorization: `Bearer ${tokenRef.current}` });

  const now = new Date();
  const [startDate, setStartDate] = useState(fd(new Date(now.getFullYear(), now.getMonth()-1, 1)));
  const [endDate, setEndDate]     = useState(fd(new Date(now.getFullYear(), now.getMonth(), 0)));
  const [activePreset, setActivePreset] = useState("Last Month");
  const [viewMode, setViewMode]   = useState<ViewMode>("subscription");
  const [summary, setSummary]     = useState<Summary | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubRow[]>([]);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [applied, setApplied]     = useState(false);
  const [exporting, setExporting] = useState(false);

  const applyPreset = (p: typeof PRESETS[0]) => {
    const r = p.fn(); setStartDate(r.s); setEndDate(r.e); setActivePreset(p.label);
  };

  const run = async () => {
    setLoading(true); setApplied(true);
    try {
      const params = { start_date: startDate, end_date: endDate };
      const [overviewRes, resRes] = await Promise.all([
        axios.get(`${BASE}/api/azure-costs/overview`, { headers: getHeaders(), params }),
        axios.get(`${BASE}/api/azure-costs/savings-resources`, { headers: getHeaders(), params: { ...params, limit: 500 } }),
      ]);
      setSummary(overviewRes.data.summary);
      // Enrich subscriptions with savings_pct
      const subs: SubRow[] = (overviewRes.data.subscriptions || []).map((s: any) => ({
        ...s,
        savings_pct: s.actual_cost > 0 ? parseFloat(((s.savings / s.actual_cost) * 100).toFixed(2)) : 0,
      }));
      setSubscriptions(subs);
      setResources(resRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const exportCSV = () => {
    setExporting(true);
    try {
      let csv = "";
      if (viewMode === "subscription" && subscriptions.length) {
        csv = ["Subscription", "Subscription ID", "Actual Cost", "Amortized Cost", "Savings", "Savings %"].join(",") + "\n";
        csv += subscriptions.map((r) =>
          [r.subscription_name, r.subscription_id, r.actual_cost.toFixed(2),
           r.amortized_cost.toFixed(2), r.savings.toFixed(2), `${r.savings_pct}%`].join(",")
        ).join("\n");
      } else {
        csv = ["Resource", "Resource ID", "Service", "Resource Group", "Subscription", "Pricing Model", "Actual Cost", "Amortized Cost", "Savings", "Savings %"].join(",") + "\n";
        csv += resources.map((r) =>
          [r.resource_name, r.resource_id, r.service, r.resource_group, r.subscription_name,
           r.pricing_model, r.actual_cost.toFixed(2), r.amortized_cost.toFixed(2),
           r.savings.toFixed(2), `${r.savings_pct}%`].join(",")
        ).join("\n");
      }
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `azure_savings_${viewMode}_${startDate}_${endDate}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const chartData = subscriptions.slice(0, 10).map((r) => ({
    name: (r.subscription_name || r.subscription_id).slice(0, 16),
    "Actual Cost":    parseFloat(r.actual_cost.toFixed(2)),
    "Amortized Cost": parseFloat(r.amortized_cost.toFixed(2)),
    savings:          parseFloat(r.savings.toFixed(2)),
  }));

  return (
    <div className="p-6" style={{ background: "#f1f4f9", minHeight: "100vh" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-black mb-2">
            <button onClick={() => router.push("/reports")} className="hover:text-blue-900 flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" /> Reports
            </button>
            <span className="text-gray-400">/</span>
            <span className="font-bold text-black">Azure RI / Savings Plan Allocation</span>
          </div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <TrendingDown className="w-6 h-6 text-[#0078D4]" />
            <span className="text-[#0078D4]">Azure</span> Reservation & Savings Plan Cost
          </h1>
          <p className="text-sm text-black mt-1">
            True cost per subscription = Actual cost vs Amortized cost (RI / Savings Plan distributed)
          </p>
        </div>
        <button onClick={exportCSV} disabled={!applied || loading || exporting}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-md transition disabled:opacity-40 bg-green-800 hover:bg-green-900">
          <Download className="w-4 h-4" />
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-4 mb-5 flex items-center gap-4 flex-wrap">
        <div className="flex border border-gray-300 rounded-md overflow-hidden">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className={`px-3 py-2 text-xs font-bold transition border-l border-gray-300 first:border-l-0 ${
                activePreset === p.label ? "bg-[#0078D4] text-white" : "bg-white text-black hover:bg-gray-50"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <input type="date" value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setActivePreset(""); }}
          className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-[#0078D4] outline-none" />
        <span className="text-xs text-black font-semibold">to</span>
        <input type="date" value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setActivePreset(""); }}
          className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-[#0078D4] outline-none" />
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-[#0078D4] hover:bg-[#006CBF] text-white text-xs font-bold rounded-md transition disabled:opacity-60">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading..." : "Generate"}
        </button>
      </div>

      {!applied && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
          <TrendingDown className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-bold text-black mb-1">Select date range and click Generate</p>
          <p className="text-xs text-gray-500">Shows Azure Reservation and Savings Plan cost distribution across subscriptions</p>
        </div>
      )}

      {applied && loading && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 flex items-center justify-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-[#0078D4]" />
          <span className="text-sm font-semibold text-black">Calculating Azure savings allocation...</span>
        </div>
      )}

      {applied && !loading && summary && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            {[
              { label: "Total Actual Cost",    value: fmt(summary.actual_cost),    icon: DollarSign,   color: "#0f2d5e", bg: "#e8f0fe" },
              { label: "Amortized Cost",        value: fmt(summary.amortized_cost), icon: Zap,          color: "#0078D4", bg: "#e6f2fb" },
              { label: "RI / SP Savings",       value: fmt(summary.savings),        icon: TrendingDown, color: "#1d8348", bg: "#eafaf1" },
              { label: "True Cost",             value: fmt(summary.true_cost),      icon: BarChart2,    color: "#ec7211", bg: "#fff4ec" },
            ].map((k) => (
              <div key={k.label} className="bg-white rounded-lg border border-gray-300 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: k.bg }}>
                    <k.icon className="w-3.5 h-3.5" style={{ color: k.color }} />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-black">{k.label}</span>
                </div>
                <div className="text-lg font-bold font-mono" style={{ color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Info banner */}
          <div className="bg-blue-50 border border-blue-200 border-l-4 border-l-[#0078D4] rounded-lg px-4 py-3 mb-5 text-xs font-semibold text-blue-900">
            <strong>How this works:</strong> Azure exports both <code className="bg-blue-100 px-1 rounded">ActualCost</code> (pay-as-you-go equivalent) and{" "}
            <code className="bg-blue-100 px-1 rounded">AmortizedCost</code> (RI/SP commitment spread across usage period).
            Savings = Actual − Amortized. Resources with <strong>Reservation</strong> or <strong>SavingsPlan</strong> pricing model are shown in the resource view.
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 mb-5">
              <h3 className="text-sm font-bold text-black mb-4">Actual vs Amortized Cost by Subscription (Top 10)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 50 }} barCategoryGap="30%">
                  <defs>
                    <linearGradient id="grad-actual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0078D4" stopOpacity={1} />
                      <stop offset="100%" stopColor="#0078D4" stopOpacity={0.75} />
                    </linearGradient>
                    <linearGradient id="grad-amortized" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1d8348" stopOpacity={1} />
                      <stop offset="100%" stopColor="#1d8348" stopOpacity={0.75} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#374151" }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={(v) => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}`} axisLine={false} tickLine={false} width={65} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,120,212,0.04)" }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="Actual Cost"    fill="url(#grad-actual)"    radius={[3,3,0,0]} />
                  <Bar dataKey="Amortized Cost" fill="url(#grad-amortized)" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* View toggle */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex border border-gray-300 rounded-md overflow-hidden">
              {(["subscription", "resource"] as ViewMode[]).map((v) => (
                <button key={v} onClick={() => setViewMode(v)}
                  className={`px-4 py-2 text-xs font-bold transition capitalize ${
                    viewMode === v ? "bg-[#0078D4] text-white" : "bg-white text-black hover:bg-gray-50"
                  }`}>
                  {v === "subscription" ? "Subscription View" : "Resource View"}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500">
              {viewMode === "subscription" ? `${subscriptions.length} subscriptions` : `${resources.length} resources`}
            </span>
          </div>

          {/* Subscription table */}
          {viewMode === "subscription" && (
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-100 border-b border-gray-300">
                <span className="text-sm font-bold text-black">Subscription-wise Cost with RI / SP Allocation</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      {["#", "Subscription", "Actual Cost", "Amortized Cost", "Savings", "Savings %"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((row, i) => (
                      <tr key={row.subscription_id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                        <td className="px-4 py-3 text-xs font-bold text-gray-400">{i+1}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-sm text-black">{row.subscription_name}</div>
                          <div className="text-[10px] font-mono text-gray-500">{row.subscription_id}</div>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono font-semibold text-black">{fmt(row.actual_cost)}</td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold font-mono text-[#0078D4]">{fmt(row.amortized_cost)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold font-mono text-green-700">{fmt(row.savings)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(row.savings_pct || 0, 100)}%` }} />
                            </div>
                            <span className="text-xs font-bold text-green-700">{row.savings_pct || 0}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr className="bg-gray-50 border-t-2 border-gray-300">
                      <td className="px-4 py-3" colSpan={2}><span className="text-sm font-bold text-black">Total</span></td>
                      <td className="px-4 py-3 text-sm font-mono font-bold text-black">{fmt(summary.actual_cost)}</td>
                      <td className="px-4 py-3 text-sm font-mono font-bold text-[#0078D4]">{fmt(summary.amortized_cost)}</td>
                      <td className="px-4 py-3 text-sm font-mono font-bold text-green-700">{fmt(summary.savings)}</td>
                      <td className="px-4 py-3 text-xs font-bold text-green-700">
                        {summary.actual_cost > 0 ? ((summary.savings / summary.actual_cost) * 100).toFixed(2) : 0}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Resource table */}
          {viewMode === "resource" && (
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-100 border-b border-gray-300 flex items-center justify-between">
                <span className="text-sm font-bold text-black">Resources Covered by Reservation / Savings Plan</span>
                <span className="text-xs font-bold text-black">{resources.length} resources</span>
              </div>
              {resources.length === 0 ? (
                <div className="p-12 text-center text-sm text-gray-500">
                  No resources with Reservation or Savings Plan pricing found for this period.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-100 border-b-2 border-gray-300">
                        {["#", "Resource", "Service", "Resource Group", "Subscription", "Pricing Model", "Actual Cost", "Amortized Cost", "Savings", "Savings %"].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {resources.map((row, i) => (
                        <tr key={i} className="border-b border-gray-200 hover:bg-blue-50 transition">
                          <td className="px-4 py-3 text-xs font-bold text-gray-400">{i+1}</td>
                          <td className="px-4 py-3">
                            <div className="text-xs font-semibold text-black truncate max-w-[160px]">{row.resource_name}</div>
                            <div className="text-[10px] font-mono text-gray-400 truncate max-w-[160px]">{row.resource_id.split("/").pop()}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-[#0078D4]">{row.service}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-black truncate max-w-[120px]">{row.resource_group}</td>
                          <td className="px-4 py-3 text-xs font-semibold text-black">{row.subscription_name}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              row.pricing_model === "Reservation" ? "bg-purple-100 text-purple-800" : "bg-green-100 text-green-800"
                            }`}>{row.pricing_model}</span>
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-black">{fmt(row.actual_cost)}</td>
                          <td className="px-4 py-3 text-sm font-bold font-mono text-[#0078D4]">{fmt(row.amortized_cost)}</td>
                          <td className="px-4 py-3 text-sm font-bold font-mono text-green-700">{fmt(row.savings)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(row.savings_pct, 100)}%` }} />
                              </div>
                              <span className="text-xs font-bold text-green-700">{row.savings_pct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {resources.length >= 500 && (
                    <div className="px-5 py-3 text-xs font-semibold text-black border-t border-gray-200">
                      Showing top 500 resources. Export CSV for full data.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
