"use client";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { RefreshCw, ChevronDown, ChevronRight, Calendar } from "lucide-react";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmt(n: number) {
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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
          }).then((r) => ({ data: r.data as Record<string, number> }))
            .catch(() => ({ data: {} }))
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

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-black">FinOps Dashboard</h1>
          <p className="text-sm text-black mt-0.5">Multi-cloud cost by Vertical &amp; Business</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Expand / Collapse */}
          <button onClick={() => setCollapsed({})}
            className="px-3 py-2 text-xs font-bold border border-gray-300 rounded-md text-black hover:bg-gray-50 transition">
            Expand All
          </button>
          <button onClick={() => {
            const all: Record<string, boolean> = {};
            verticals.forEach((v) => { all[v.id] = true; });
            setCollapsed(all);
          }}
            className="px-3 py-2 text-xs font-bold border border-gray-300 rounded-md text-black hover:bg-gray-50 transition">
            Collapse All
          </button>

          {/* Month selector */}
          <div className="relative" ref={dropRef}>
            <button
              onClick={() => setShowMonthDrop((p) => !p)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md bg-white text-xs font-bold text-black hover:border-blue-900 transition min-w-[170px] justify-between">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                {selectedMonth.label}
              </div>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {showMonthDrop && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[170px] max-h-64 overflow-y-auto">
                {months.map((m, i) => (
                  <button key={m.start} onClick={() => applyMonth(m)}
                    className={`w-full text-left px-4 py-2.5 text-xs font-semibold hover:bg-blue-50 transition flex items-center justify-between ${
                      m.start === selectedMonth.start ? "bg-blue-900 text-white" : "text-black"
                    }`}>
                    <span>{m.label}</span>
                    {i === 1 && m.start !== selectedMonth.start && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">Last</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => loadData(selectedMonth.start, selectedMonth.end)}
            className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition">
            <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-300">
              <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3 w-44">Vertical</th>
              <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">Business</th>
              <th className="text-right text-xs font-bold uppercase tracking-wider text-black px-5 py-3 w-44">
                <div className="flex items-center justify-end gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-orange-500" />AWS Cost
                </div>
              </th>
              <th className="text-right text-xs font-bold uppercase tracking-wider text-black px-5 py-3 w-44">
                <div className="flex items-center justify-end gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />Azure Cost
                </div>
              </th>
              <th className="text-right text-xs font-bold uppercase tracking-wider text-black px-5 py-3 w-44">Total Cost</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-5 py-3"><div className="h-3 bg-gray-200 rounded w-20 animate-pulse" /></td>
                  <td className="px-5 py-3"><div className="h-3 bg-gray-200 rounded w-28 animate-pulse" /></td>
                  <td className="px-5 py-3"><div className="h-3 bg-gray-200 rounded w-20 animate-pulse ml-auto" /></td>
                  <td className="px-5 py-3"><div className="h-3 bg-gray-200 rounded w-20 animate-pulse ml-auto" /></td>
                  <td className="px-5 py-3"><div className="h-3 bg-gray-200 rounded w-20 animate-pulse ml-auto" /></td>
                </tr>
              ))
            ) : (
              verticals.map((v) => {
                const vTotals = verticalTotals(v);
                const isCollapsed = collapsed[v.id];
                return [
                  // Vertical row
                  <tr key={`v-${v.id}`}
                    className="border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition"
                    style={{ background: `${v.color}10` }}
                    onClick={() => toggleCollapse(v.id)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: v.color }} />
                        <span className="text-sm font-bold text-black">{v.name}</span>
                        {isCollapsed
                          ? <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                          : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs font-semibold text-gray-400">
                      {v.businesses.length} business{v.businesses.length !== 1 ? "es" : ""}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-bold font-mono text-orange-700">
                      {vTotals.aws > 0 ? fmt(vTotals.aws) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-bold font-mono text-blue-700">
                      {vTotals.azure > 0 ? fmt(vTotals.azure) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-bold font-mono text-blue-900">
                      {vTotals.total > 0 ? fmt(vTotals.total) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                  </tr>,

                  // Business rows
                  ...(!isCollapsed ? v.businesses.map((b) => {
                    const c = costs[b.id] || { aws: 0, azure: 0, total: 0 };
                    const isAccount = (b.cost_type || "resource") === "account";
                    return (
                      <tr key={`b-${b.id}`} className="border-b border-gray-100 hover:bg-blue-50 transition">
                        <td className="px-5 py-2.5" />
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2 pl-4">
                            <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: `${v.color}60` }} />
                            <span className="text-sm font-semibold text-black">{b.name}</span>
                            {isAccount && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-green-50 text-green-700 border-green-200 uppercase tracking-wide">
                                Account
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-right text-sm font-mono text-orange-700">
                          {c.aws > 0 ? fmt(c.aws) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right text-sm font-mono text-blue-700">
                          {c.azure > 0 ? fmt(c.azure) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right text-sm font-semibold font-mono text-black">
                          {c.total > 0 ? fmt(c.total) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  }) : []),
                ];
              })
            )}

            {/* Grand Total */}
            {!loading && verticals.length > 0 && (
              <tr className="border-t-2 border-gray-300 bg-gray-100">
                <td className="px-5 py-3 text-sm font-bold text-black" colSpan={2}>Grand Total</td>
                <td className="px-5 py-3 text-right text-sm font-bold font-mono text-orange-700">
                  {fmt(grandTotal.aws)}
                </td>
                <td className="px-5 py-3 text-right text-sm font-bold font-mono text-blue-700">
                  {fmt(grandTotal.azure)}
                </td>
                <td className="px-5 py-3 text-right text-sm font-bold font-mono text-blue-900">
                  {fmt(grandTotal.total)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        {selectedMonth.start} → {selectedMonth.end} · Account-level businesses match CT dashboard · Azure populates after onboarding
      </p>
    </div>
  );
}
