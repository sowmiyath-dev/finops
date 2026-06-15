"use client";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { RefreshCw, ChevronDown, ChevronRight, TrendingUp, Cloud, DollarSign, Layers, Calendar } from "lucide-react";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
function fmtFull(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric" });
    const start = fmtDate(new Date(d.getFullYear(), d.getMonth(), 1));
    const end = fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    options.push({ label, start, end });
  }
  return options;
}

interface Business { id: string; name: string; cost_type?: string; }
interface Vertical { id: string; name: string; color: string; businesses: Business[]; }
interface CostRow { aws: number; azure: number; total: number; }

const VERTICAL_COLORS: Record<string, string> = {};

export default function FinOpsDashboard() {
  const { token } = useAuthStore();
  const headers = { Authorization: `Bearer ${token}` };
  const dropRef = useRef<HTMLDivElement>(null);

  const months = getMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(months[1]);
  const [showMonthDrop, setShowMonthDrop] = useState(false);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [costs, setCosts] = useState<Record<string, CostRow>>({});
  const [loading, setLoading] = useState(true);
  // All verticals expanded by default
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowMonthDrop(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadData = async (start: string, end: string) => {
    setLoading(true);
    setCosts({});
    try {
      const vertsRes = await axios.get(`${BASE}/api/verticals/`, { headers });
      const vertList = vertsRes.data as { id: string; name: string; color: string }[];

      const bizResults = await Promise.all(
        vertList.map((v) =>
          axios.get(`${BASE}/api/verticals/${v.id}/businesses`, { headers })
            .then((r) => ({ verticalId: v.id, businesses: r.data as Business[] }))
        )
      );

      const fullVerticals: Vertical[] = vertList.map((v) => ({
        ...v,
        businesses: bizResults.find((b) => b.verticalId === v.id)?.businesses || [],
      }));
      setVerticals(fullVerticals);

      const costResults = await Promise.all(
        fullVerticals.map((v) =>
          axios.get(`${BASE}/api/verticals/${v.id}/businesses-cost`, {
            headers,
            params: { granularity: "monthly", start_date: start, end_date: end },
          }).then((r) => ({ verticalId: v.id, data: r.data as Record<string, number> }))
            .catch(() => ({ verticalId: v.id, data: {} }))
        )
      );

      const costMap: Record<string, CostRow> = {};
      for (const result of costResults) {
        for (const [bizId, cost] of Object.entries(result.data)) {
          costMap[bizId] = { aws: cost as number, azure: 0, total: cost as number };
        }
      }
      setCosts(costMap);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) loadData(selectedMonth.start, selectedMonth.end);
  }, [token]); // eslint-disable-line

  const applyMonth = (m: typeof months[0]) => {
    setSelectedMonth(m);
    setShowMonthDrop(false);
    loadData(m.start, m.end);
  };

  const toggleCollapse = (id: string) => setCollapsed((p) => ({ ...p, [id]: !p[id] }));
  const collapseAll = () => {
    const all: Record<string, boolean> = {};
    verticals.forEach((v) => { all[v.id] = true; });
    setCollapsed(all);
  };
  const expandAll = () => setCollapsed({});

  const verticalTotals = (v: Vertical): CostRow => {
    let aws = 0, azure = 0;
    for (const b of v.businesses) {
      aws += costs[b.id]?.aws || 0;
      azure += costs[b.id]?.azure || 0;
    }
    return { aws, azure, total: aws + azure };
  };

  const grandTotal = verticals.reduce((acc, v) => {
    const t = verticalTotals(v);
    return { aws: acc.aws + t.aws, azure: acc.azure + t.azure, total: acc.total + t.total };
  }, { aws: 0, azure: 0, total: 0 });

  const activeVerticals = verticals.filter((v) => verticalTotals(v).total > 0).length;

  return (
    <div className="min-h-screen" style={{ background: "#f0f4f8" }}>
      {/* Top gradient header */}
      <div className="px-8 pt-8 pb-6" style={{ background: "linear-gradient(135deg, #0f2d5e 0%, #1a4a8a 60%, #1a6fa8 100%)" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-5 h-5 text-white/70" />
              <span className="text-white/70 text-xs font-semibold uppercase tracking-widest">Multi-Cloud FinOps</span>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Cost Dashboard</h1>
            <p className="text-white/60 text-sm mt-1">Vertical &amp; Business cost visibility across AWS and Azure</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Month selector */}
            <div className="relative" ref={dropRef}>
              <button
                onClick={() => setShowMonthDrop((p) => !p)}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition"
                style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.25)" }}>
                <Calendar className="w-4 h-4" />
                {selectedMonth.label}
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>
              {showMonthDrop && (
                <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 min-w-[200px] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Select Month</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {months.map((m, i) => (
                      <button key={m.start} onClick={() => applyMonth(m)}
                        className={`w-full text-left px-4 py-2.5 text-xs font-semibold transition flex items-center justify-between ${
                          m.start === selectedMonth.start
                            ? "bg-blue-900 text-white"
                            : "text-gray-700 hover:bg-blue-50"
                        }`}>
                        {m.label}
                        {i === 0 && m.start !== selectedMonth.start && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-bold">Current</span>
                        )}
                        {i === 1 && m.start !== selectedMonth.start && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">Last</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => loadData(selectedMonth.start, selectedMonth.end)}
              className="p-2.5 rounded-lg transition"
              style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)" }}>
              <RefreshCw className={`w-4 h-4 text-white ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4 mt-6">
          {[
            {
              label: "Total Cloud Cost",
              value: loading ? "—" : fmt(grandTotal.total),
              full: loading ? "" : fmtFull(grandTotal.total),
              icon: DollarSign,
              color: "#f59e0b",
              bg: "rgba(245,158,11,0.15)",
            },
            {
              label: "AWS Cost",
              value: loading ? "—" : fmt(grandTotal.aws),
              full: loading ? "" : fmtFull(grandTotal.aws),
              icon: Cloud,
              color: "#f97316",
              bg: "rgba(249,115,22,0.15)",
            },
            {
              label: "Azure Cost",
              value: loading ? "—" : fmt(grandTotal.azure),
              full: loading ? "" : fmtFull(grandTotal.azure),
              icon: Cloud,
              color: "#60a5fa",
              bg: "rgba(96,165,250,0.15)",
            },
            {
              label: "Active Verticals",
              value: loading ? "—" : activeVerticals,
              full: "",
              icon: TrendingUp,
              color: "#34d399",
              bg: "rgba(52,211,153,0.15)",
            },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">{kpi.label}</span>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: kpi.bg }}>
                  <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
                </div>
              </div>
              <div className="text-2xl font-bold text-white tracking-tight">{kpi.value}</div>
              {kpi.full && <div className="text-white/40 text-[10px] mt-0.5 font-mono">{kpi.full}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Table section */}
      <div className="px-8 py-6">
        {/* Table controls */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <span className="text-sm font-bold text-gray-700">{selectedMonth.label}</span>
            <span className="text-xs text-gray-400 ml-2">{selectedMonth.start} → {selectedMonth.end}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={expandAll} className="text-xs font-bold text-blue-700 hover:text-blue-900 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition">
              Expand All
            </button>
            <button onClick={collapseAll} className="text-xs font-bold text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition">
              Collapse All
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "#1e293b" }}>
                <th className="text-left px-6 py-4 w-52">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Vertical</span>
                </th>
                <th className="text-left px-6 py-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Business</span>
                </th>
                <th className="text-right px-6 py-4 w-44">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-2 h-2 rounded-full bg-orange-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-400">AWS Cost</span>
                  </div>
                </th>
                <th className="text-right px-6 py-4 w-44">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Azure Cost</span>
                  </div>
                </th>
                <th className="text-right px-6 py-4 w-44">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Cost</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-6 py-3.5"><div className="h-3 bg-slate-100 rounded-full w-20 animate-pulse" /></td>
                    <td className="px-6 py-3.5"><div className="h-3 bg-slate-100 rounded-full w-28 animate-pulse" /></td>
                    <td className="px-6 py-3.5"><div className="h-3 bg-slate-100 rounded-full w-20 animate-pulse ml-auto" /></td>
                    <td className="px-6 py-3.5"><div className="h-3 bg-slate-100 rounded-full w-20 animate-pulse ml-auto" /></td>
                    <td className="px-6 py-3.5"><div className="h-3 bg-slate-100 rounded-full w-20 animate-pulse ml-auto" /></td>
                  </tr>
                ))
              ) : (
                verticals.map((v) => {
                  const vTotals = verticalTotals(v);
                  const isCollapsed = collapsed[v.id];
                  return [
                    // ── Vertical row ──
                    <tr key={`v-${v.id}`}
                      className="cursor-pointer transition-colors border-b"
                      style={{ background: `${v.color}08`, borderColor: `${v.color}20` }}
                      onClick={() => toggleCollapse(v.id)}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: v.color }} />
                          <span className="text-sm font-bold text-slate-800">{v.name}</span>
                          <div className="ml-1 text-slate-400">
                            {isCollapsed
                              ? <ChevronRight className="w-3.5 h-3.5" />
                              : <ChevronDown className="w-3.5 h-3.5" />}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-semibold text-slate-400">
                          {v.businesses.length} business{v.businesses.length !== 1 ? "es" : ""}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-bold font-mono" style={{ color: vTotals.aws > 0 ? "#c2410c" : "#cbd5e1" }}>
                          {vTotals.aws > 0 ? fmtFull(vTotals.aws) : "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-bold font-mono" style={{ color: vTotals.azure > 0 ? "#1d4ed8" : "#cbd5e1" }}>
                          {vTotals.azure > 0 ? fmtFull(vTotals.azure) : "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {vTotals.total > 0 ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold font-mono text-white"
                            style={{ background: v.color }}>
                            {fmtFull(vTotals.total)}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-sm">—</span>
                        )}
                      </td>
                    </tr>,

                    // ── Business rows ──
                    ...(!isCollapsed ? v.businesses.map((b, bi) => {
                      const c = costs[b.id] || { aws: 0, azure: 0, total: 0 };
                      const isAccountLevel = (b.cost_type || "resource") === "account";
                      const isLast = bi === v.businesses.length - 1;
                      return (
                        <tr key={`b-${b.id}`}
                          className="transition-colors border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-6 py-3" />
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex items-center gap-1.5 ml-3">
                                <div className="w-px h-4" style={{ background: `${v.color}40` }} />
                                <div className="w-1.5 h-1.5 rounded-full" style={{ background: `${v.color}80` }} />
                              </div>
                              <span className="text-sm font-semibold text-slate-700">{b.name}</span>
                              {isAccountLevel && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                                  style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>
                                  Account
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm font-mono" style={{ color: c.aws > 0 ? "#ea580c" : "#cbd5e1" }}>
                              {c.aws > 0 ? fmtFull(c.aws) : "—"}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm font-mono" style={{ color: c.azure > 0 ? "#2563eb" : "#cbd5e1" }}>
                              {c.azure > 0 ? fmtFull(c.azure) : "—"}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm font-semibold font-mono" style={{ color: c.total > 0 ? "#1e293b" : "#cbd5e1" }}>
                              {c.total > 0 ? fmtFull(c.total) : "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    }) : []),
                  ];
                })
              )}

              {/* Grand Total */}
              {!loading && verticals.length > 0 && (
                <tr style={{ background: "#1e293b" }}>
                  <td className="px-6 py-4" colSpan={2}>
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-bold text-white">Grand Total</span>
                      <span className="text-xs text-slate-400 ml-1">{selectedMonth.label}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-bold font-mono text-orange-300">{fmtFull(grandTotal.aws)}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-bold font-mono text-blue-300">{fmtFull(grandTotal.azure)}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-base font-bold font-mono text-amber-300">{fmtFull(grandTotal.total)}</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-400">
            Azure cost will populate after Azure CT onboarding · Account-level cost matches CT dashboard exactly
          </p>
          <p className="text-xs text-gray-400">
            {verticals.reduce((s, v) => s + v.businesses.length, 0)} businesses across {verticals.length} verticals
          </p>
        </div>
      </div>
    </div>
  );
}
