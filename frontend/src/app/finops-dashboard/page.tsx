"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { RefreshCw, ChevronDown, ChevronRight, Calendar, Download } from "lucide-react";

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

interface Business { id: string; name: string; cost_type?: string; owner_name?: string; }
interface Vertical { id: string; name: string; color: string; businesses: Business[]; }
interface CostRow { aws: number; azure_actual: number; azure_savings: number; azure_true: number; total: number; }
interface CacheEntry { verticals: Vertical[]; costs: Record<string, CostRow>; }

// Module-level cache — survives navigation, cleared on refresh
const dataCache = new Map<string, CacheEntry>();

export default function FinOpsDashboard() {
  const { token } = useAuthStore();
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

  const loadData = useCallback(async (start: string, end: string, force = false) => {
    const cacheKey = `${start}__${end}`;
    if (!force && dataCache.has(cacheKey)) {
      const cached = dataCache.get(cacheKey)!;
      setVerticals(cached.verticals);
      setCosts(cached.costs);
      setLoading(false);
      return;
    }
    setLoading(true);
    setCosts({});
    try {
      // Single call replaces 1 + N vertical/business calls
      const [vertsRes, awsCostRes, azureCostRes] = await Promise.all([
        api.get(`/verticals/with-businesses`),
        api.get(`/verticals/all-businesses-cost`, {
          params: { granularity: "monthly", start_date: start, end_date: end },
        }).then((r) => r.data as Record<string, number>).catch(() => ({} as Record<string, number>)),
        api.get(`/azure-costs/business-costs`, {
          params: { start_date: start, end_date: end },
        }).then((r) => r.data as Record<string, { actual_cost: number; savings: number; true_cost: number }>).catch(() => ({} as Record<string, any>)),
      ]);

      const fullVerticals = vertsRes.data as Vertical[];

      const costMap: Record<string, CostRow> = {};
      for (const [bizId, awsCost] of Object.entries(awsCostRes)) {
        costMap[bizId] = { aws: awsCost as number, azure_actual: 0, azure_savings: 0, azure_true: 0, total: awsCost as number };
      }
      for (const [bizId, az] of Object.entries(azureCostRes)) {
        if (!costMap[bizId]) costMap[bizId] = { aws: 0, azure_actual: 0, azure_savings: 0, azure_true: 0, total: 0 };
        costMap[bizId].azure_actual = az.actual_cost || 0;
        costMap[bizId].azure_savings = az.savings || 0;
        costMap[bizId].azure_true = az.true_cost || 0;
        costMap[bizId].total = costMap[bizId].aws + (az.true_cost || 0);
      }

      dataCache.set(cacheKey, { verticals: fullVerticals, costs: costMap });
      setVerticals(fullVerticals);
      setCosts(costMap);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

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
    let aws = 0, azure_actual = 0, azure_savings = 0, azure_true = 0;
    for (const b of v.businesses) {
      aws += costs[b.id]?.aws || 0;
      azure_actual += costs[b.id]?.azure_actual || 0;
      azure_savings += costs[b.id]?.azure_savings || 0;
      azure_true += costs[b.id]?.azure_true || 0;
    }
    return { aws, azure_actual, azure_savings, azure_true, total: aws + azure_true };
  };

  const grandTotal = verticals.reduce((acc, v) => {
    const t = verticalTotals(v);
    return { aws: acc.aws + t.aws, azure_actual: acc.azure_actual + t.azure_actual, azure_savings: acc.azure_savings + t.azure_savings, azure_true: acc.azure_true + t.azure_true, total: acc.total + t.total };
  }, { aws: 0, azure_actual: 0, azure_savings: 0, azure_true: 0, total: 0 });

  const downloadCSV = () => {
    const rows: string[][] = [
      ["Vertical", "Business", "Owner", "Cost Type", "AWS Cost", "Azure Actual", "Azure Savings", "Azure True Cost", "Total Cost", "Period"],
    ];
    for (const v of verticals) {
      const vT = verticalTotals(v);
      rows.push([v.name, "", "", "", fmt(vT.aws), fmt(vT.azure_actual), fmt(vT.azure_savings), fmt(vT.azure_true), fmt(vT.total), selectedMonth.label]);
      for (const b of v.businesses) {
        const c = costs[b.id] || { aws: 0, azure_actual: 0, azure_savings: 0, azure_true: 0, total: 0 };
        rows.push([v.name, b.name, b.owner_name || "—", (b.cost_type || "resource") === "account" ? "Account" : "Resource",
          fmt(c.aws), fmt(c.azure_actual), fmt(c.azure_savings), fmt(c.azure_true), fmt(c.total), selectedMonth.label]);
      }
    }
    rows.push(["Grand Total", "", "", "", fmt(grandTotal.aws), fmt(grandTotal.azure_actual), fmt(grandTotal.azure_savings), fmt(grandTotal.azure_true), fmt(grandTotal.total), selectedMonth.label]);
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finops-cost-${selectedMonth.start}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const headers = [
    { label: "Vertical", align: "left" },
    { label: "Business", align: "left" },
    { label: "Owner", align: "left" },
    { label: "AWS Cost", align: "right", dot: "bg-orange-500" },
    { label: "Azure Actual", align: "right", dot: "bg-blue-400" },
    { label: "Azure Savings", align: "right", dot: "bg-green-500" },
    { label: "Azure True Cost", align: "right", dot: "bg-blue-600" },
    { label: "Total Cost", align: "right" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-black">FinOps Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Multi-cloud cost by Vertical &amp; Business · {selectedMonth.label}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCollapsed({})}
            className="px-3 py-2 text-xs font-bold border border-gray-300 rounded-md text-black hover:bg-gray-50 transition">
            Expand All
          </button>
          <button onClick={() => {
            const all: Record<string, boolean> = {};
            verticals.forEach((v) => { all[v.id] = true; });
            setCollapsed(all);
          }} className="px-3 py-2 text-xs font-bold border border-gray-300 rounded-md text-black hover:bg-gray-50 transition">
            Collapse All
          </button>

          <div className="relative" ref={dropRef}>
            <button onClick={() => setShowMonthDrop((p) => !p)}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md bg-white text-xs font-bold text-black hover:border-blue-900 transition min-w-[160px] justify-between">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                {selectedMonth.label}
              </div>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {showMonthDrop && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[160px] max-h-64 overflow-y-auto">
                {months.map((m, i) => (
                  <button key={m.start} onClick={() => applyMonth(m)}
                    className={`w-full text-left px-4 py-2.5 text-xs font-semibold hover:bg-blue-50 transition flex items-center justify-between ${m.start === selectedMonth.start ? "bg-blue-900 text-white" : "text-black"}`}>
                    <span>{m.label}</span>
                    {i === 1 && m.start !== selectedMonth.start && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">Last</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => loadData(selectedMonth.start, selectedMonth.end, true)}
            className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition">
            <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
          </button>

          <button onClick={downloadCSV} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-300">
              {headers.map((h) => (
                <th key={h.label}
                  className={`text-${h.align} text-xs font-bold uppercase tracking-wider text-gray-700 px-4 py-3 whitespace-nowrap`}>
                  {h.dot ? (
                    <div className={`flex items-center ${h.align === "right" ? "justify-end" : ""} gap-1.5`}>
                      <div className={`w-2 h-2 rounded-full ${h.dot}`} />
                      {h.label}
                    </div>
                  ) : h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {[...Array(8)].map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className={`h-3 bg-gray-200 rounded animate-pulse ${j >= 3 ? "ml-auto" : ""}`}
                        style={{ width: j >= 3 ? "80px" : j === 0 ? "80px" : "120px" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              verticals.map((v) => {
                const vTotals = verticalTotals(v);
                const isCollapsed = collapsed[v.id];
                return [
                  <tr key={`v-${v.id}`}
                    className="border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition"
                    style={{ background: `${v.color}0d` }}
                    onClick={() => toggleCollapse(v.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: v.color }} />
                        <span className="text-sm font-bold text-black">{v.name}</span>
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-semibold">{v.businesses.length} business{v.businesses.length !== 1 ? "es" : ""}</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right text-sm font-bold font-mono text-orange-700">
                      {vTotals.aws > 0 ? fmt(vTotals.aws) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-500">
                      {vTotals.azure_actual > 0 ? fmt(vTotals.azure_actual) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold font-mono text-green-700">
                      {vTotals.azure_savings > 0 ? fmt(vTotals.azure_savings) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-700">
                      {vTotals.azure_true > 0 ? fmt(vTotals.azure_true) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-900">
                      {vTotals.total > 0 ? fmt(vTotals.total) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                  </tr>,

                  ...(!isCollapsed ? v.businesses.map((b) => {
                    const c = costs[b.id] || { aws: 0, azure_actual: 0, azure_savings: 0, azure_true: 0, total: 0 };
                    const isAccount = (b.cost_type || "resource") === "account";
                    return (
                      <tr key={`b-${b.id}`} className="border-b border-gray-100 hover:bg-blue-50 transition">
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-3.5 rounded-full flex-shrink-0" style={{ background: `${v.color}50` }} />
                            <span className="text-sm font-semibold text-black">{b.name}</span>
                            {isAccount && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-green-50 text-green-700 border-green-200 uppercase tracking-wide">Acct</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 font-medium">
                          {b.owner_name || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono text-orange-700">
                          {c.aws > 0 ? fmt(c.aws) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono text-blue-500">
                          {c.azure_actual > 0 ? fmt(c.azure_actual) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono text-green-700">
                          {c.azure_savings > 0 ? fmt(c.azure_savings) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono text-blue-700">
                          {c.azure_true > 0 ? fmt(c.azure_true) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-semibold font-mono text-black">
                          {c.total > 0 ? fmt(c.total) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  }) : []),
                ];
              })
            )}

            {!loading && verticals.length > 0 && (
              <tr className="border-t-2 border-gray-300 bg-gray-100">
                <td className="px-4 py-3 text-sm font-bold text-black">Grand Total</td>
                <td className="px-4 py-3" colSpan={2} />
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-orange-700">{fmt(grandTotal.aws)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-500">{fmt(grandTotal.azure_actual)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-green-700">{fmt(grandTotal.azure_savings)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-700">{fmt(grandTotal.azure_true)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold font-mono text-blue-900">{fmt(grandTotal.total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        {selectedMonth.start} → {selectedMonth.end} · <span className="text-green-600 font-semibold">Acct</span> = account-level · Azure True Cost = amortized (RI/SP allocated)
      </p>
    </div>
  );
}
