"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { Download, RefreshCw, ChevronLeft, TrendingDown, DollarSign, Zap, BarChart2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend,
} from "recharts";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");
const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9","#27ae60","#e67e22","#16a085"];

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

type ViewMode = "account" | "resource";

interface AccountRow {
  aws_account_id: string; account_name: string;
  usage_cost: number; sp_on_demand_equiv: number;
  sp_allocated_cost: number; true_cost: number;
  on_demand_total: number; savings: number;
  savings_pct: number; sp_share_pct: number;
  sp_resource_count: number;
}

interface ResourceRow {
  resource_id: string; aws_account_id: string; account_name: string;
  service: string; region: string; usage_type: string;
  on_demand_cost: number; sp_allocated_cost: number;
  savings: number; savings_pct: number;
}

interface Summary {
  total_sp_recurring_fee: number;
  total_usage_cost: number;
  total_sp_allocated: number;
  total_true_cost: number;
  total_savings: number;
  overall_savings_pct: number;
  per_account: AccountRow[];
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

export default function SavingsPage() {
  const { token } = useAuthStore();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const router = useRouter();
  const getHeaders = () => ({ Authorization: `Bearer ${tokenRef.current}` });

  const now = new Date();
  const [startDate, setStartDate] = useState(fd(new Date(now.getFullYear(), now.getMonth()-1, 1)));
  const [endDate, setEndDate]     = useState(fd(new Date(now.getFullYear(), now.getMonth(), 0)));
  const [activePreset, setActivePreset] = useState("Last Month");
  const [viewMode, setViewMode]   = useState<ViewMode>("account");
  const [summary, setSummary]     = useState<Summary | null>(null);
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
      const [sumRes, resRes] = await Promise.all([
        axios.get(`${BASE}/api/reports/savings/summary`, {
          headers: getHeaders(), params: { start_date: startDate, end_date: endDate },
        }),
        axios.get(`${BASE}/api/reports/savings/resources`, {
          headers: getHeaders(), params: { start_date: startDate, end_date: endDate, limit: 500 },
        }),
      ]);
      setSummary(sumRes.data);
      setResources(resRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const exportCSV = () => {
    setExporting(true);
    try {
      let csv = "";
      if (viewMode === "account" && summary) {
        csv = ["Account", "Account ID", "Usage Cost", "SP On-Demand Equiv", "SP Allocated Cost", "True Cost", "Savings", "Savings %", "SP Resources"].join(",") + "\n";
        csv += summary.per_account.map((r) =>
          [r.account_name, r.aws_account_id, r.usage_cost.toFixed(2), r.sp_on_demand_equiv.toFixed(2),
           r.sp_allocated_cost.toFixed(2), r.true_cost.toFixed(2), r.savings.toFixed(2), `${r.savings_pct}%`, r.sp_resource_count].join(",")
        ).join("\n");
      } else {
        csv = ["Resource ID", "Account", "Service", "Region", "On-Demand Cost", "SP Allocated Cost", "Savings", "Savings %"].join(",") + "\n";
        csv += resources.map((r) =>
          [r.resource_id, r.account_name, r.service, r.region,
           r.on_demand_cost.toFixed(2), r.sp_allocated_cost.toFixed(2), r.savings.toFixed(2), `${r.savings_pct}%`].join(",")
        ).join("\n");
      }
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `finoptix_savings_${viewMode}_${startDate}_${endDate}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  // Chart data — top 10 accounts by true cost, stacked: usage + sp_allocated
  const chartData = (summary?.per_account || []).slice(0, 10).map((r) => ({
    name: (r.account_name || r.aws_account_id).slice(0, 16),
    "Usage Cost": parseFloat(r.usage_cost.toFixed(2)),
    "SP Allocated": parseFloat(r.sp_allocated_cost.toFixed(2)),
    savings: parseFloat(r.savings.toFixed(2)),
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
            <span className="font-bold text-black">Savings Plan Allocation</span>
          </div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <TrendingDown className="w-6 h-6 text-green-700" /> Savings Plan Cost Allocation
          </h1>
          <p className="text-sm text-black mt-1">
            True cost per account = Usage + SP allocated cost (distributed proportionally by usage)
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
        {/* Presets */}
        <div className="flex border border-gray-300 rounded-md overflow-hidden">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className={`px-3 py-2 text-xs font-bold transition border-l border-gray-300 first:border-l-0 ${
                activePreset === p.label ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        {/* Date inputs */}
        <input type="date" value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setActivePreset(""); }}
          className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
        <span className="text-xs text-black font-semibold">to</span>
        <input type="date" value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setActivePreset(""); }}
          className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-60">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading..." : "Generate"}
        </button>
      </div>

      {!applied && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
          <TrendingDown className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-bold text-black mb-1">Select date range and click Generate</p>
          <p className="text-xs text-gray-500">Shows how Savings Plan costs are distributed across accounts based on actual usage</p>
        </div>
      )}

      {applied && loading && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 flex items-center justify-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-900" />
          <span className="text-sm font-semibold text-black">Calculating savings allocation...</span>
        </div>
      )}

      {applied && !loading && summary && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
            {[
              { label: "SP Recurring Fee",   value: fmt(summary.total_sp_recurring_fee), icon: DollarSign, color: "#c0392b", bg: "#fdedec" },
              { label: "Total Usage Cost",   value: fmt(summary.total_usage_cost),       icon: BarChart2,  color: "#0f2d5e", bg: "#e8f0fe" },
              { label: "SP Allocated Cost",  value: fmt(summary.total_sp_allocated),     icon: Zap,        color: "#ec7211", bg: "#fff4ec" },
              { label: "True Total Cost",    value: fmt(summary.total_true_cost),        icon: DollarSign, color: "#1a6fa8", bg: "#eaf4fb" },
              { label: "Total Savings",      value: fmt(summary.total_savings),          icon: TrendingDown, color: "#1d8348", bg: "#eafaf1" },
            ].map((k) => (
              <div key={k.label} className="bg-white rounded-lg border border-gray-300 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: k.bg }}>
                    <k.icon className="w-3.5 h-3.5" style={{ color: k.color }} />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-black">{k.label}</span>
                </div>
                <div className="text-lg font-bold font-mono" style={{ color: k.color }}>{k.value}</div>
                {k.label === "Total Savings" && (
                  <div className="text-xs font-semibold text-green-700 mt-0.5">{summary.overall_savings_pct}% saved vs on-demand</div>
                )}
              </div>
            ))}
          </div>

          {/* Info banner */}
          <div className="bg-blue-50 border border-blue-200 border-l-4 border-l-blue-600 rounded-lg px-4 py-3 mb-5 text-xs font-semibold text-blue-900">
            <strong>How this works:</strong> The SP Recurring Fee (${summary.total_sp_recurring_fee.toLocaleString("en-US", {minimumFractionDigits:2})}) sits in the payer account.
            It is distributed to each sub-account using <code className="bg-blue-100 px-1 rounded">amortized_cost</code> from <code className="bg-blue-100 px-1 rounded">SavingsPlanCoveredUsage</code> rows in CUR —
            which is AWS's own allocation of the SP commitment based on actual usage.
            True Cost = Usage Cost + SP Allocated Cost.
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 mb-5">
              <h3 className="text-sm font-bold text-black mb-4">True Cost by Account — Usage + SP Allocated (Top 10)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 50 }} barCategoryGap="30%">
                  <defs>
                    <linearGradient id="grad-usage" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0f2d5e" stopOpacity={1} />
                      <stop offset="100%" stopColor="#0f2d5e" stopOpacity={0.75} />
                    </linearGradient>
                    <linearGradient id="grad-sp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ec7211" stopOpacity={1} />
                      <stop offset="100%" stopColor="#ec7211" stopOpacity={0.75} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#374151" }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={(v) => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}`} axisLine={false} tickLine={false} width={65} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(15,45,94,0.04)" }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="Usage Cost"   stackId="a" fill="url(#grad-usage)" radius={[0,0,0,0]} />
                  <Bar dataKey="SP Allocated" stackId="a" fill="url(#grad-sp)"    radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* View toggle */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex border border-gray-300 rounded-md overflow-hidden">
              {(["account", "resource"] as ViewMode[]).map((v) => (
                <button key={v} onClick={() => setViewMode(v)}
                  className={`px-4 py-2 text-xs font-bold transition capitalize ${
                    viewMode === v ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                  }`}>
                  {v === "account" ? "Account View" : "Resource View"}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500">
              {viewMode === "account" ? `${summary.per_account.length} accounts` : `${resources.length} resources`}
            </span>
          </div>

          {/* Account table */}
          {viewMode === "account" && (
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-100 border-b border-gray-300">
                <span className="text-sm font-bold text-black">Account-wise True Cost with SP Allocation</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      {["#", "Account", "Usage Cost", "SP On-Demand Equiv", "SP Allocated Cost", "True Cost", "Savings", "Savings %", "SP Resources"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.per_account.map((row, i) => (
                      <tr key={row.aws_account_id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                        <td className="px-4 py-3 text-xs font-bold text-gray-400">{i+1}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-sm text-black">{row.account_name}</div>
                          <div className="text-[10px] font-mono text-gray-500">{row.aws_account_id}</div>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono font-semibold text-black">{fmt(row.usage_cost)}</td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-500">{fmt(row.sp_on_demand_equiv)}</td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold font-mono text-orange-700">{fmt(row.sp_allocated_cost)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold font-mono text-blue-900">{fmt(row.true_cost)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold font-mono text-green-700">{fmt(row.savings)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(row.savings_pct, 100)}%` }} />
                            </div>
                            <span className="text-xs font-bold text-green-700">{row.savings_pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-black">{row.sp_resource_count.toLocaleString()}</td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                      <td className="px-4 py-3" colSpan={2}><span className="text-sm font-bold text-black">Total</span></td>
                      <td className="px-4 py-3 text-sm font-mono font-bold text-black">{fmt(summary.total_usage_cost)}</td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3 text-sm font-mono font-bold text-orange-700">{fmt(summary.total_sp_allocated)}</td>
                      <td className="px-4 py-3 text-sm font-mono font-bold text-blue-900">{fmt(summary.total_true_cost)}</td>
                      <td className="px-4 py-3 text-sm font-mono font-bold text-green-700">{fmt(summary.total_savings)}</td>
                      <td className="px-4 py-3 text-xs font-bold text-green-700">{summary.overall_savings_pct}%</td>
                      <td className="px-4 py-3" />
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
                <span className="text-sm font-bold text-black">Resources Covered by Savings Plan</span>
                <span className="text-xs font-bold text-black">{resources.length} resources</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      {["#", "Resource ID", "Account", "Service", "Region", "On-Demand Cost", "SP Allocated Cost", "Savings", "Savings %"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resources.map((row, i) => (
                      <tr key={i} className="border-b border-gray-200 hover:bg-blue-50 transition">
                        <td className="px-4 py-3 text-xs font-bold text-gray-400">{i+1}</td>
                        <td className="px-4 py-3 text-xs font-mono font-semibold text-black max-w-xs truncate">{row.resource_id}</td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-semibold text-black">{row.account_name}</div>
                          <div className="text-[10px] font-mono text-gray-500">{row.aws_account_id}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900">{row.service}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-black">{row.region}</td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-500">{fmt(row.on_demand_cost)}</td>
                        <td className="px-4 py-3 text-sm font-bold font-mono text-orange-700">{fmt(row.sp_allocated_cost)}</td>
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
                    Showing top 500 resources by on-demand cost. Export CSV for full data.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
