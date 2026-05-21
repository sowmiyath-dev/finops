"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Link from "next/link";
import {
  ChevronRight, DollarSign, RefreshCw,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from "recharts";

const COLORS = ["#0f2d5e","#ec7211","#1d8348","#8e44ad","#1a6fa8","#c0392b","#16a085","#e67e22","#2980b9","#27ae60"];

const GRANULARITY = [
  { label: "Daily", value: "daily" },
  { label: "Monthly", value: "monthly" },
];

const TABS = [
  { label: "Service Wise", value: "service" },
  { label: "Resource Wise", value: "resource" },
  { label: "Tag Wise", value: "tag" },
];

function getLastMonth() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CTDetailPage() {
  const { ctId } = useParams<{ ctId: string }>();
  const { token } = useAuthStore();
  const router = useRouter();

  const lastMonth = getLastMonth();
  const [startDate, setStartDate] = useState(lastMonth.start);
  const [endDate, setEndDate] = useState(lastMonth.end);
  const [granularity, setGranularity] = useState("monthly");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("service");

  useEffect(() => { if (!token) router.push("/auth"); }, [token]);

  const { data: boundary } = useQuery({
    queryKey: ["boundary"],
    queryFn: () => api.get("/reports/data-boundary").then((r) => r.data),
    enabled: !!token,
    staleTime: 60 * 60 * 1000,
  });

  const { data: towers = [] } = useQuery({
    queryKey: ["towers"],
    queryFn: () => api.get("/towers/").then((r) => r.data),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  const ct = towers.find((t: any) => t.id === ctId);
  const subAccounts: any[] = ct?.sub_accounts || [];

  const filter = {
    control_tower_ids: [ctId],
    account_ids: selectedAccounts.length > 0 ? selectedAccounts : null,
    start_date: startDate,
    end_date: endDate,
    granularity,
    metric: "unblended_cost",
    group_by: "account",
  };

  // Main summary — subaccount costs
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["ct-summary", ctId, startDate, endDate, granularity, selectedAccounts],
    queryFn: () => api.post("/reports/summary", filter).then((r) => r.data),
    enabled: !!token && !!ctId,
    staleTime: 2 * 60 * 1000,
  });

  // Tab data
  const tabEndpoint = activeTab === "service" ? "/reports/service-wise"
    : activeTab === "resource" ? "/reports/resource-wise"
    : "/reports/tag-wise";

  const tabFilter = {
    ...filter,
    group_by: activeTab,
    granularity: "monthly",
  };

  const { data: tabData = [], isLoading: tabLoading } = useQuery({
    queryKey: ["ct-tab", ctId, activeTab, startDate, endDate, selectedAccounts],
    queryFn: () => api.post(tabEndpoint, tabFilter).then((r) => r.data),
    enabled: !!token && !!ctId,
    staleTime: 2 * 60 * 1000,
  });

  // Build stacked chart data — one bar per date, stacked by account
  const chartData = (() => {
    if (!summary?.daily_trend) return [];
    if (granularity === "monthly") {
      // group per_account by month
      return summary.per_account?.map((acc: any) => ({
        name: acc.account_name || acc.aws_account_id,
        cost: acc.cost,
      })) || [];
    }
    return summary.daily_trend.map((d: any) => ({ date: d.date.slice(5), cost: d.cost }));
  })();

  // Build per-account stacked data for the top chart
  const stackedData = (() => {
    if (!summary?.per_account) return [];
    // For daily: we need account-wise daily data — use per_account as totals for now
    return summary.per_account?.slice(0, 10).map((acc: any) => ({
      name: (acc.account_name || acc.aws_account_id).slice(0, 15),
      cost: parseFloat(acc.cost.toFixed(2)),
    })) || [];
  })();

  const totalCost = summary?.total_cost || 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-5">
        <Link href="/dashboard" className="text-black hover:text-blue-900 font-medium">
          AWS
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
        <span className="font-bold text-black">{ct?.name || "..."}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black">{ct?.name}</h1>
          <p className="text-xs text-black mt-0.5 font-mono">{ct?.management_account_id} · {ct?.management_account_name}</p>
        </div>

        {/* Date + Granularity controls */}
        <div className="flex items-center gap-3">
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {GRANULARITY.map((g) => (
              <button key={g.value} onClick={() => setGranularity(g.value)}
                className={`px-4 py-2 text-xs font-bold transition ${granularity === g.value ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
                {g.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              max={boundary?.accurate_until}
              className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
            <span className="text-xs text-black font-semibold">to</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              max={boundary?.accurate_until}
              className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          </div>
          {/* Quick presets */}
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {[
              { label: "This Month", fn: () => { const n = new Date(); setStartDate(new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0,10)); setEndDate(boundary?.accurate_until || n.toISOString().slice(0,10)); }},
              { label: "Last Month", fn: () => { const r = getLastMonth(); setStartDate(r.start); setEndDate(r.end); }},
              { label: "Last 7d", fn: () => { const e = boundary?.accurate_until || new Date().toISOString().slice(0,10); const s = new Date(e); s.setDate(s.getDate()-6); setStartDate(s.toISOString().slice(0,10)); setEndDate(e); }},
            ].map((p) => (
              <button key={p.label} onClick={p.fn}
                className="px-3 py-2 text-xs font-bold bg-white text-black hover:bg-gray-50 border-l border-gray-300 first:border-l-0 transition">
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {summaryLoading ? (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-900" />
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-blue-900" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-black">Total Cost</span>
              </div>
              <div className="text-2xl font-bold text-blue-900 font-mono">{fmt(totalCost)}</div>
              <div className="text-xs text-black mt-1">{startDate} → {endDate}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">Top Service</div>
              <div className="text-base font-bold text-orange-600 truncate">{summary?.top_services?.[0]?.service || "—"}</div>
              <div className="text-xs font-mono text-black mt-1">{fmt(summary?.top_services?.[0]?.cost || 0)}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">Sub-accounts</div>
              <div className="text-2xl font-bold text-green-800">{subAccounts.length}</div>
              <div className="text-xs text-black mt-1">tracked accounts</div>
            </div>
          </div>

          {/* Subaccount cost chart */}
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-black">Subaccount Cost — {granularity === "daily" ? "Daily Trend" : "By Account"}</h2>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stackedData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#000" }} />
                <YAxis tick={{ fontSize: 11, fill: "#000" }} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                <Tooltip formatter={(v: number) => [fmt(v), "Cost"]} />
                <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                  {stackedData.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Subaccount table + filter */}
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm mb-6">
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-black">Subaccount Costs</h2>
              {/* Multi-select dropdown */}
              <div className="relative">
                <button
                  onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 border border-gray-400 rounded-md text-xs font-bold text-black bg-white hover:border-blue-900 transition min-w-[180px] justify-between">
                  <span>
                    {selectedAccounts.length === 0
                      ? "All Accounts"
                      : `${selectedAccounts.length} account${selectedAccounts.length > 1 ? "s" : ""} selected`}
                  </span>
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${accountDropdownOpen ? "rotate-90" : ""}`} />
                </button>
                {accountDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 min-w-[220px]">
                    <div className="p-2 border-b border-gray-100">
                      <button
                        onClick={() => { setSelectedAccounts([]); setAccountDropdownOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-xs font-bold rounded transition ${
                          selectedAccounts.length === 0 ? "bg-blue-900 text-white" : "text-black hover:bg-gray-100"
                        }`}>
                        All Accounts
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto p-2 space-y-0.5">
                      {subAccounts.map((acc: any) => {
                        const selected = selectedAccounts.includes(acc.aws_account_id);
                        return (
                          <label key={acc.aws_account_id}
                            className="flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer hover:bg-gray-50 transition">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => setSelectedAccounts((prev) =>
                                selected
                                  ? prev.filter((a) => a !== acc.aws_account_id)
                                  : [...prev, acc.aws_account_id]
                              )}
                              className="w-3.5 h-3.5 accent-blue-900"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-black truncate">{acc.account_name}</div>
                              <div className="text-[10px] font-mono text-gray-500">{acc.aws_account_id}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    {selectedAccounts.length > 0 && (
                      <div className="p-2 border-t border-gray-100">
                        <button
                          onClick={() => setSelectedAccounts([])}
                          className="w-full text-xs font-bold text-red-600 hover:text-red-700 transition">
                          Clear selection
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {["Account", "Account ID", "Cost", "% of Total"].map((h) => (
                    <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(summary?.per_account || [])
                  .filter((acc: any) => selectedAccounts.length === 0 || selectedAccounts.includes(acc.aws_account_id))
                  .map((acc: any) => {
                    const pct = totalCost > 0 ? (acc.cost / totalCost) * 100 : 0;
                    return (
                      <tr key={acc.aws_account_id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-blue-900 flex items-center justify-center text-xs font-bold text-white">
                              {(acc.account_name || "?")[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-bold text-black">{acc.account_name || "Unknown"}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs font-mono font-semibold text-black">{acc.aws_account_id}</td>
                        <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">{fmt(acc.cost)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-blue-900" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-bold text-black">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Service / Resource / Tag tabs */}
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm">
            <div className="flex border-b border-gray-200">
              {TABS.map((tab) => (
                <button key={tab.value} onClick={() => setActiveTab(tab.value)}
                  className={`px-5 py-3 text-sm font-bold transition border-b-2 ${
                    activeTab === tab.value
                      ? "border-blue-900 text-blue-900"
                      : "border-transparent text-black hover:text-blue-900"
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-5">
              {tabLoading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-900" />
                </div>
              ) : (
                <>
                  {/* Cumulative cost chart for tab */}
                  {tabData.length > 0 && (
                    <div className="mb-5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-black mb-3">
                        Cumulative Cost — {TABS.find(t => t.value === activeTab)?.label}
                      </h3>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart
                          data={tabData.slice(0, 15).map((r: any) => ({
                            name: (r.service || r.resource_id || r.tag_value || "—").slice(0, 20),
                            cost: parseFloat((r.cost || 0).toFixed(2)),
                          }))}
                          margin={{ top: 0, right: 0, left: 0, bottom: 40 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#000" }} angle={-30} textAnchor="end" />
                          <YAxis tick={{ fontSize: 10, fill: "#000" }} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                          <Tooltip formatter={(v: number) => [fmt(v), "Cost"]} />
                          <Bar dataKey="cost" fill="#0f2d5e" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Tab table */}
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        {activeTab === "service" && (
                          <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Service</th>
                        )}
                        {activeTab === "resource" && (
                          <>
                            <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Resource ID</th>
                            <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Service</th>
                            <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Region</th>
                          </>
                        )}
                        {activeTab === "tag" && (
                          <>
                            <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Tag Key</th>
                            <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Tag Value</th>
                          </>
                        )}
                        <th className="text-right text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Cost (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabData.slice(0, 50).map((row: any, i: number) => (
                        <tr key={i} className="border-b border-gray-200 hover:bg-blue-50 transition">
                          {activeTab === "service" && (
                            <td className="px-4 py-2.5 text-sm font-semibold text-black">{row.service}</td>
                          )}
                          {activeTab === "resource" && (
                            <>
                              <td className="px-4 py-2.5 text-xs font-mono font-semibold text-black max-w-xs truncate">{row.resource_id}</td>
                              <td className="px-4 py-2.5 text-xs font-semibold text-black">{row.service}</td>
                              <td className="px-4 py-2.5 text-xs text-black">{row.region || "—"}</td>
                            </>
                          )}
                          {activeTab === "tag" && (
                            <>
                              <td className="px-4 py-2.5 text-sm font-semibold text-black">{row.tag_key}</td>
                              <td className="px-4 py-2.5 text-sm text-black">{row.tag_value || "(untagged)"}</td>
                            </>
                          )}
                          <td className="px-4 py-2.5 text-right text-sm font-bold font-mono text-blue-900">
                            {fmt(row.cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {tabData.length > 50 && (
                    <p className="text-xs text-black text-center py-3 border-t border-gray-200">
                      Showing 50 of {tabData.length} rows
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
