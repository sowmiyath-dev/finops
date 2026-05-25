"use client";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { Download, RefreshCw, Filter, Layers, ChevronLeft, BarChart2, DollarSign, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");
const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9","#27ae60","#e67e22","#16a085"];

const GROUP_BY_OPTIONS = [
  { value: "vertical", label: "Vertical" },
  { value: "business", label: "Business" },
  { value: "owner",    label: "Owner" },
  { value: "billing",  label: "Billing Tag" },
];

const PRESETS = [
  { label: "This Month", fn: () => { const n = new Date(); return { s: fd(new Date(n.getFullYear(), n.getMonth(), 1)), e: fd(n) }; } },
  { label: "Last Month", fn: () => { const n = new Date(); return { s: fd(new Date(n.getFullYear(), n.getMonth()-1, 1)), e: fd(new Date(n.getFullYear(), n.getMonth(), 0)) }; } },
  { label: "Last 3M",    fn: () => { const n = new Date(); const s = new Date(n); s.setMonth(s.getMonth()-3); return { s: fd(s), e: fd(n) }; } },
  { label: "This Year",  fn: () => { const n = new Date(); return { s: `${n.getFullYear()}-01-01`, e: fd(n) }; } },
];

function fd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Always show full number: $32,328.45
function fmtCost(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface ReportRow {
  vertical: string; business: string; billing_tag: string;
  label: string; total_cost: number; resource_count: number;
}
interface Vertical { id: string; name: string; color: string; }

const inputCls = "border border-gray-400 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-900 transition";
const labelCls = "block text-xs font-bold mb-1 uppercase tracking-wide text-black";

// Column config per group_by:
// primary = first column (the grouped dimension)
// secondary = second column (vertical as context badge)
const COL_CONFIG: Record<string, { primary: string; secondary: string | null; tertiary: string | null }> = {
  vertical: { primary: "Vertical",    secondary: null,       tertiary: null },
  business: { primary: "Business",    secondary: "Vertical", tertiary: null },
  owner:    { primary: "Owner",       secondary: "Vertical", tertiary: "Business" },
  billing:  { primary: "Billing Tag", secondary: "Vertical", tertiary: null },
};

export default function VerticalReportPage() {
  const { token } = useAuthStore();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const router = useRouter();
  const getHeaders = () => ({ Authorization: `Bearer ${tokenRef.current}` });

  const now = new Date();
  const [startDate, setStartDate] = useState(fd(new Date(now.getFullYear(), now.getMonth()-1, 1)));
  const [endDate, setEndDate]     = useState(fd(new Date(now.getFullYear(), now.getMonth(), 0)));
  const [activePreset, setActivePreset] = useState("Last Month");
  const [groupBy, setGroupBy]     = useState("vertical");
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [selectedVerts, setSelectedVerts] = useState<string[]>([]);
  const [rows, setRows]           = useState<ReportRow[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [applied, setApplied]     = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!token) return;
    axios.get(`${BASE}/api/verticals/`, { headers: getHeaders() })
      .then((r) => setVerticals(r.data)).catch(() => {});
  }, [token]); // eslint-disable-line

  const applyPreset = (p: typeof PRESETS[0]) => {
    const r = p.fn(); setStartDate(r.s); setEndDate(r.e); setActivePreset(p.label);
  };

  const run = async () => {
    setLoading(true); setApplied(true);
    try {
      const params: any = { start_date: startDate, end_date: endDate, group_by: groupBy };
      if (selectedVerts.length > 0) params.vertical_ids = selectedVerts.join(",");
      const res = await axios.get(`${BASE}/api/verticals/report`, { headers: getHeaders(), params });
      // Sort: group by vertical name first, then by cost desc within each vertical
      const sorted = (res.data.rows || []).sort((a: ReportRow, b: ReportRow) =>
        groupBy !== "vertical"
          ? a.vertical.localeCompare(b.vertical) || b.total_cost - a.total_cost
          : b.total_cost - a.total_cost
      );
      setRows(sorted);
      setTotal(res.data.total || 0);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const exportCSV = () => {
    if (!rows.length) return;
    setExporting(true);
    try {
      const col = COL_CONFIG[groupBy];
      const hdrs = col.secondary
        ? [col.primary, col.secondary, "Resources", "Cost (USD)", "% of Total"]
        : [col.primary, "Resources", "Cost (USD)", "% of Total"];
      const csvRows = rows.map((r) => {
        const pct = total > 0 ? ((r.total_cost / total) * 100).toFixed(1) : "0.0";
        const primary = groupBy === "vertical" ? r.vertical
          : groupBy === "business" ? r.business
          : groupBy === "billing"  ? r.billing_tag
          : r.label;
        const base = [primary, r.resource_count, r.total_cost.toFixed(2), `${pct}%`];
        return col.secondary ? [primary, r.vertical, r.resource_count, r.total_cost.toFixed(2), `${pct}%`] : base;
      });
      const csv = [hdrs, ...csvRows].map((r) => r.join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `finoptix_${groupBy}_report_${startDate}_${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const toggleVert = (id: string) =>
    setSelectedVerts((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const chartData = rows.slice(0, 15).map((r, i) => ({
    name: r.label.length > 16 ? r.label.slice(0, 16) + "…" : r.label,
    cost: parseFloat(r.total_cost.toFixed(2)),
    fill: COLORS[i % COLORS.length],
  }));

  const col = COL_CONFIG[groupBy];

  // Get primary label for a row
  const getPrimary = (row: ReportRow) =>
    groupBy === "vertical" ? row.vertical
    : groupBy === "business" ? row.business
    : groupBy === "billing"  ? row.billing_tag
    : row.label;

  return (
    <div className="p-6" style={{ background: "#f1f4f9", minHeight: "100vh" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-black mb-2">
            <button onClick={() => router.push("/verticals")} className="hover:text-blue-900 flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" /> Verticals
            </button>
            <span className="text-gray-400">/</span>
            <span className="font-bold text-black">Cost Report</span>
          </div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-blue-900" /> Vertical Cost Report
          </h1>
          <p className="text-sm text-black mt-1">Analyse cost by Vertical, Business, Owner or Billing Tag with custom date range</p>
        </div>
        <button onClick={exportCSV} disabled={!rows.length || exporting}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-md transition disabled:opacity-40 bg-green-800 hover:bg-green-900">
          <Download className="w-4 h-4" />
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* Filter Panel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 space-y-5 sticky top-20">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
              <Filter className="w-4 h-4 text-blue-900" />
              <span className="text-sm font-bold text-black">Filters</span>
            </div>

            {/* Presets */}
            <div>
              <label className={labelCls}>Quick Range</label>
              <div className="grid grid-cols-2 gap-1">
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => applyPreset(p)}
                    className={`py-1.5 text-xs font-bold rounded-md border transition ${
                      activePreset === p.label ? "bg-blue-900 text-white border-blue-900" : "bg-white text-black border-gray-400 hover:border-blue-900"
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dates */}
            <div className="space-y-2">
              <div>
                <label className={labelCls}>Start Date</label>
                <input type="date" value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setActivePreset(""); }}
                  className={`${inputCls} w-full`} />
              </div>
              <div>
                <label className={labelCls}>End Date</label>
                <input type="date" value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setActivePreset(""); }}
                  className={`${inputCls} w-full`} />
              </div>
            </div>

            {/* Group By */}
            <div>
              <label className={labelCls}>Group By</label>
              <div className="space-y-1">
                {GROUP_BY_OPTIONS.map((g) => (
                  <label key={g.value}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer border transition text-xs font-semibold ${
                      groupBy === g.value ? "bg-blue-900 text-white border-blue-900" : "bg-white text-black border-gray-200 hover:border-blue-900"
                    }`}>
                    <input type="radio" name="groupby" value={g.value} checked={groupBy === g.value}
                      onChange={() => setGroupBy(g.value)} className="hidden" />
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      groupBy === g.value ? "border-white" : "border-gray-400"
                    }`}>
                      {groupBy === g.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    {g.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Vertical filter */}
            <div>
              <label className={labelCls}>
                Verticals
                {selectedVerts.length > 0 && (
                  <button onClick={() => setSelectedVerts([])} className="ml-2 text-[10px] font-bold text-red-600 hover:underline normal-case">Clear</button>
                )}
              </label>
              <div className="space-y-1 border border-gray-300 rounded-md p-2 bg-gray-50 max-h-48 overflow-y-auto">
                {verticals.length === 0 && <p className="text-xs text-gray-400 px-1 py-1">No verticals found</p>}
                {verticals.map((v) => {
                  const checked = selectedVerts.includes(v.id);
                  return (
                    <label key={v.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition text-xs font-semibold ${
                        checked ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-blue-50"
                      }`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleVert(v.id)} className="hidden" />
                      <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                        checked ? "bg-white border-white" : "border-gray-400"
                      }`}>
                        {checked && <div className="w-2 h-2 rounded-sm bg-blue-900" />}
                      </div>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: v.color }} />
                      {v.name}
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                {selectedVerts.length === 0 ? "All verticals" : `${selectedVerts.length} selected`}
              </p>
            </div>

            <button onClick={run} disabled={loading}
              className="w-full py-2.5 text-sm font-bold text-white rounded-md transition flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-60">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Generating..." : "Generate Report"}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="lg:col-span-3 space-y-5">

          {!applied && (
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
              <BarChart2 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm font-bold text-black mb-1">Configure your report</p>
              <p className="text-xs text-gray-500">Select date range, group by and click Generate Report</p>
            </div>
          )}

          {applied && loading && (
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 flex items-center justify-center gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-900" />
              <span className="text-sm font-semibold text-black">Generating report...</span>
            </div>
          )}

          {applied && !loading && (
            <>
              {/* KPI */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Total Cost",   value: fmtCost(total),  icon: DollarSign, color: "#0f2d5e" },
                  { label: `${col.primary} Groups`, value: rows.length, icon: Layers, color: "#1a6fa8" },
                  { label: "Period",       value: `${startDate} → ${endDate}`, icon: Tag, color: "#ec7211" },
                ].map((k) => (
                  <div key={k.label} className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <k.icon className="w-4 h-4" style={{ color: k.color }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-black">{k.label}</span>
                    </div>
                    <div className="text-lg font-bold font-mono truncate" style={{ color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Chart */}
              {chartData.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
                  <h3 className="text-sm font-bold text-black mb-4">
                    Cost by {col.primary} — {startDate} → {endDate}
                  </h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 50 }} barCategoryGap="30%">
                      <defs>
                        {chartData.map((d, i) => (
                          <linearGradient key={d.name} id={`vr-${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={d.fill} stopOpacity={1} />
                            <stop offset="100%" stopColor={d.fill} stopOpacity={0.7} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#374151" }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0} />
                      <YAxis tick={{ fontSize: 11, fill: "#374151" }}
                        tickFormatter={(v) => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}`}
                        axisLine={false} tickLine={false} width={65} />
                      <Tooltip
                        contentStyle={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                        formatter={(v: number) => [fmtCost(v), "Cost"]}
                        labelStyle={{ fontWeight: 700, color: "#000" }}
                      />
                      <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                        {chartData.map((d, i) => <Cell key={d.name} fill={`url(#vr-${i})`} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Table */}
              <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
                <div className="px-5 py-3 bg-gray-100 border-b border-gray-300 flex items-center justify-between">
                  <span className="text-sm font-bold text-black">{col.primary}-wise Cost Breakdown</span>
                  <span className="text-xs font-bold text-black">{rows.length} rows</span>
                </div>

                {rows.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-sm font-bold text-black">No data for this period</p>
                    <p className="text-xs text-gray-500 mt-1">Tag resources with Vertical / Business / Billing tags to see cost here</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-100 border-b-2 border-gray-300">
                          <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">#</th>
                          <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">{col.primary}</th>
                          {col.secondary && (
                            <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">{col.secondary}</th>
                          )}
                          {col.tertiary && (
                            <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">{col.tertiary}</th>
                          )}
                          <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Resources</th>
                          <th className="text-right px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Cost (USD)</th>
                          <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">% of Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => {
                          const pct = total > 0 ? (row.total_cost / total) * 100 : 0;
                          const color = COLORS[i % COLORS.length];
                          const primaryVal = getPrimary(row);
                          // Split comma-separated values into badge arrays
                          const vertBadges = row.vertical ? row.vertical.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
                          const bizBadges  = row.business ? row.business.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
                          return (
                            <tr key={i} className="border-b border-gray-200 hover:bg-blue-50 transition">
                              <td className="px-5 py-3 text-xs font-bold text-gray-400">{i + 1}</td>

                              {/* Primary cell */}
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                                  <span className="text-sm font-bold text-black">{primaryVal}</span>
                                </div>
                              </td>

                              {/* Secondary — Vertical as badges (supports multiple) */}
                              {col.secondary && (
                                <td className="px-5 py-3">
                                  <div className="flex flex-wrap gap-1">
                                    {vertBadges.map((v: string) => (
                                      <span key={v} className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-200">{v}</span>
                                    ))}
                                  </div>
                                </td>
                              )}

                              {/* Tertiary — Business as badges (supports multiple) */}
                              {col.tertiary && (
                                <td className="px-5 py-3">
                                  <div className="flex flex-wrap gap-1">
                                    {bizBadges.map((b: string) => (
                                      <span key={b} className="text-xs font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200">{b}</span>
                                    ))}
                                  </div>
                                </td>
                              )}

                              <td className="px-5 py-3 text-sm font-semibold text-black">{row.resource_count.toLocaleString()}</td>
                              <td className="px-5 py-3 text-right text-sm font-bold font-mono text-blue-900">{fmtCost(row.total_cost)}</td>
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                                  </div>
                                  <span className="text-xs font-bold text-black">{pct.toFixed(1)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {/* Total row */}
                        <tr className="bg-gray-50 border-t-2 border-gray-300">
                          <td className="px-5 py-3" colSpan={col.tertiary ? 5 : col.secondary ? 4 : 3}>
                            <span className="text-sm font-bold text-black">Total</span>
                          </td>
                          <td className="px-5 py-3 text-right text-sm font-bold font-mono text-blue-900">{fmtCost(total)}</td>
                          <td className="px-5 py-3 text-xs font-bold text-black">100%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
