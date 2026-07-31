"use client";
import { useEffect, useState, Fragment } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Link from "next/link";
import {
  ChevronRight, DollarSign, RefreshCw, TrendingDown, Download,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend,
} from "recharts";

const COLORS = ["#0f2d5e","#ec7211","#1d8348","#8e44ad","#1a6fa8","#c0392b","#16a085","#e67e22","#2980b9","#27ae60"];

const DEFAULT_CHARGE_TYPES = ["Usage"];

const ALL_CHARGE_TYPES = [
  "Usage", "SavingsPlanCoveredUsage", "SavingsPlanRecurringFee",
  "SavingsPlanNegation", "RIFee", "DiscountedUsage",
  "Tax", "DistributorDiscount", "Credit", "Refund", "OCBLateFee", "Fee",
];

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
  const y = now.getFullYear();
  const m = now.getMonth(); // current month index (0-based)
  // First day of last month
  const start = new Date(y, m - 1, 1);
  // Last day of last month = day 0 of current month
  const end = new Date(y, m, 0);
  // Format as YYYY-MM-DD using local date parts to avoid timezone shift
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

function getThisMonth(accurateUntil?: string) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    start: fmt(start),
    end: accurateUntil || fmt(now),
  };
}

function getLast7Days(accurateUntil?: string) {
  const end = accurateUntil ? new Date(accurateUntil) : new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function downloadCSV(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadMultiSheetXls(filename: string, sheets: { name: string; headers: string[]; rows: string[][] }[]) {
  const sheetXml = sheets.map((s) => `
    <Worksheet ss:Name="${s.name}">
      <Table>
        <Row>${s.headers.map((h) => `<Cell><Data ss:Type="String">${h}</Data></Cell>`).join("")}</Row>
        ${s.rows.map((r) => `<Row>${r.map((c) => `<Cell><Data ss:Type="String">${String(c).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</Data></Cell>`).join("")}</Row>`).join("")}
      </Table>
    </Worksheet>`).join("");
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  ${sheetXml}
</Workbook>`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
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
  const [selectedChargeTypes, setSelectedChargeTypes] = useState<string[]>(DEFAULT_CHARGE_TYPES);
  const [chargeFilterOpen, setChargeFilterOpen] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("service");
  const [showTrueCost, setShowTrueCost] = useState(false);
  const [trueCostView, setTrueCostView] = useState<"account" | "resource">("account");
  const [spResourceModal, setSpResourceModal] = useState<{ accountId: string; accountName: string } | null>(null);
  const [spResources, setSpResources] = useState<any[]>([]);
  const [spResLoading, setSpResLoading] = useState(false);
  const [allSpResources, setAllSpResources] = useState<any[]>([]);
  const [allSpResLoading, setAllSpResLoading] = useState(false);

  const openSpResources = async (accountId: string, accountName: string) => {
    setSpResourceModal({ accountId, accountName });
    setSpResources([]);
    setSpResLoading(true);
    try {
      const res = await api.get("/reports/savings/resources", {
        params: { start_date: startDate, end_date: endDate, account_ids: accountId, limit: 500 },
      });
      setSpResources(res.data);
    } catch (e) { console.error(e); }
    finally { setSpResLoading(false); }
  };

  const loadAllSpResources = async () => {
    if (allSpResources.length > 0) return;
    setAllSpResLoading(true);
    try {
      const accountParam = selectedAccounts.length > 0 ? selectedAccounts.join(",") : undefined;
      const res = await api.get("/reports/savings/resources", {
        params: { start_date: startDate, end_date: endDate, ...(accountParam ? { account_ids: accountParam } : {}), limit: 2000 },
      });
      setAllSpResources(res.data);
    } catch (e) { console.error(e); }
    finally { setAllSpResLoading(false); }
  };

  useEffect(() => { if (!token) router.push("/auth"); }, [token]);
  // Reset resource-wise cache when filters change
  useEffect(() => { setAllSpResources([]); }, [startDate, endDate, selectedAccounts]);

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
    charge_types: selectedChargeTypes.length > 0 ? selectedChargeTypes : null,
    start_date: startDate,
    end_date: endDate,
    granularity,
    metric: "unblended_cost",
    group_by: "account",
  };

  // Main summary — subaccount costs
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["ct-summary", ctId, startDate, endDate, granularity, selectedAccounts, selectedChargeTypes],
    queryFn: () => api.post("/reports/summary", filter).then((r) => r.data),
    enabled: !!token && !!ctId,
    staleTime: 2 * 60 * 1000,
  });

  // True cost with SP allocation — uses CT-specific distribution endpoint
  const { data: spDist, isLoading: spLoading } = useQuery({
    queryKey: ["ct-sp-dist", ctId, startDate, endDate],
    queryFn: () => api.get(`/reports/savings/ct-distribution`, {
      params: { ct_id: ctId, start_date: startDate, end_date: endDate }
    }).then((r) => r.data),
    enabled: !!token && !!ctId && showTrueCost,
    staleTime: 5 * 60 * 1000,
  });

  const trueCostData: any[] = spDist?.sub_accounts || [];
  const trueCostLoading = spLoading;

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
    queryKey: ["ct-tab", ctId, activeTab, startDate, endDate, selectedAccounts, selectedChargeTypes],
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
              { label: "This Month", fn: () => { const r = getThisMonth(boundary?.accurate_until); setStartDate(r.start); setEndDate(r.end); }},
              { label: "Last Month", fn: () => { const r = getLastMonth(); setStartDate(r.start); setEndDate(r.end); }},
              { label: "Last 7d",    fn: () => { const r = getLast7Days(boundary?.accurate_until); setStartDate(r.start); setEndDate(r.end); }},
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
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-black">Subaccount Costs</h2>
                {/* True Cost toggle */}
                <button
                  onClick={() => setShowTrueCost(!showTrueCost)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition ${
                    showTrueCost
                      ? "bg-green-700 text-white border-green-700"
                      : "bg-white text-black border-gray-300 hover:border-green-700 hover:text-green-700"
                  }`}>
                  <TrendingDown className="w-3 h-3" />
                  {showTrueCost ? "True Cost (SP Allocated)" : "Show True Cost"}
                </button>
                {showTrueCost && (
                  <span className="text-[10px] text-gray-500">
                    Usage + SP amortized cost distributed by usage
                  </span>
                )}
                {/* Account / Resource view toggle */}
                {showTrueCost && (
                  <div className="flex border border-gray-300 rounded-md overflow-hidden">
                    <button
                      onClick={() => setTrueCostView("account")}
                      className={`px-3 py-1 text-xs font-bold transition ${
                        trueCostView === "account" ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                      }`}>
                      Account Wise
                    </button>
                    <button
                      onClick={() => { setTrueCostView("resource"); loadAllSpResources(); }}
                      className={`px-3 py-1 text-xs font-bold border-l border-gray-300 transition ${
                        trueCostView === "resource" ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                      }`}>
                      Resource Wise
                    </button>
                  </div>
                )}
                {/* Download button for subaccount table */}
                <button
                  onClick={async () => {
                    if (showTrueCost && trueCostView === "resource") {
                      // Resource-wise XLS download
                      const data = allSpResources.length > 0 ? allSpResources : await api.get("/reports/savings/resources", {
                        params: { start_date: startDate, end_date: endDate, ...(selectedAccounts.length > 0 ? { account_ids: selectedAccounts.join(",") } : {}), limit: 2000 },
                      }).then((r: any) => r.data);
                      const headers = ["Service", "Resource ID", "Account", "Account ID", "Region", "On-Demand Cost", "SP Allocated (True Cost)", "Savings", "Savings %"];
                      const rows = (data as any[]).map((r: any) => [
                        r.service || "—", r.resource_id || "—", r.account_name || "—", r.aws_account_id || "—",
                        r.region || "—", r.on_demand_cost?.toFixed(2) || "0",
                        r.sp_allocated_cost?.toFixed(2) || "0", r.savings?.toFixed(2) || "0",
                        r.savings_pct ? `${r.savings_pct}%` : "0%",
                      ]);
                      downloadMultiSheetXls(`true-cost-resource-wise-${ct?.name}-${startDate}-${endDate}.xls`, [
                        { name: "Resource True Cost", headers, rows },
                      ]);
                    } else if (showTrueCost && trueCostData.length > 0) {
                      const tcHeaders = ["Account", "Account ID", "Usage Cost", "SP Allocated", "True Cost", "Savings", "Savings %"];
                      const tcRows = trueCostData
                        .filter((acc: any) => selectedAccounts.length === 0 || selectedAccounts.includes(acc.aws_account_id))
                        .map((acc: any) => [
                          acc.account_name || "", acc.aws_account_id,
                          acc.usage_cost?.toFixed(2) || "0",
                          acc.is_payer ? `-${acc.sp_fee_distributed?.toFixed(2)}` : (acc.sp_allocated?.toFixed(2) || "0"),
                          acc.true_cost?.toFixed(2) || "0", acc.savings?.toFixed(2) || "0",
                          acc.savings_pct ? `${acc.savings_pct}%` : "0%",
                        ]);
                      const accountsWithSp = trueCostData.filter((acc: any) => !acc.is_payer && acc.sp_resources > 0);
                      let spRows: string[][] = [];
                      const spHeaders = ["Account", "Account ID", "Resource ID", "Service", "Region", "On-Demand Cost", "SP Allocated", "Savings", "Savings %"];
                      if (accountsWithSp.length > 0) {
                        const results = await Promise.all(
                          accountsWithSp.map((acc: any) =>
                            api.get("/reports/savings/resources", {
                              params: { start_date: startDate, end_date: endDate, account_ids: acc.aws_account_id, limit: 1000 },
                            }).then((r) => ({ accountName: acc.account_name, accountId: acc.aws_account_id, resources: r.data }))
                            .catch(() => ({ accountName: acc.account_name, accountId: acc.aws_account_id, resources: [] }))
                          )
                        );
                        spRows = results.flatMap(({ accountName, accountId, resources }) =>
                          (resources as any[]).map((r: any) => [
                            accountName, accountId, r.resource_id || "—", r.service || "—", r.region || "—",
                            r.on_demand_cost?.toFixed(2) || "0", r.sp_allocated_cost?.toFixed(2) || "0",
                            r.savings?.toFixed(2) || "0", r.savings_pct ? `${r.savings_pct}%` : "0%",
                          ])
                        );
                      }
                      downloadMultiSheetXls(`true-cost-${ct?.name}-${startDate}-${endDate}.xls`, [
                        { name: "True Cost", headers: tcHeaders, rows: tcRows },
                        { name: "SP Resources", headers: spHeaders, rows: spRows },
                      ]);
                    } else if (!showTrueCost && summary?.per_account?.length > 0) {
                      const headers = ["Account", "Account ID", "Cost (USD)", "% of Total"];
                      const rows = (summary.per_account as any[])
                        .filter((acc: any) => selectedAccounts.length === 0 || selectedAccounts.includes(acc.aws_account_id))
                        .map((acc: any) => [
                          acc.account_name || "Unknown", acc.aws_account_id,
                          acc.cost?.toFixed(2) || "0",
                          totalCost > 0 ? `${((acc.cost / totalCost) * 100).toFixed(1)}%` : "0%",
                        ]);
                      downloadCSV(`subaccount-cost-${ct?.name}-${startDate}-${endDate}.csv`, [headers, ...rows]);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-gray-300 text-xs font-bold text-black hover:border-blue-900 hover:text-blue-900 transition bg-white"
                  title={showTrueCost ? "Download XLS" : "Download CSV"}>
                  <Download className="w-3.5 h-3.5" /> {showTrueCost ? "XLS" : "CSV"}
                </button>
              </div>
              <div className="flex items-center gap-3">
                {/* Charge Type filter */}
                <div className="relative">
                  <button
                    onClick={() => setChargeFilterOpen(!chargeFilterOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 border border-gray-400 rounded-md text-xs font-bold text-black bg-white hover:border-blue-900 transition">
                    Charge Types
                    <span className="bg-blue-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {selectedChargeTypes.length}
                    </span>
                  </button>
                  {chargeFilterOpen && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 w-56">
                      <div className="p-2 border-b border-gray-100 flex items-center justify-between">
                        <span className="text-xs font-bold text-black">Charge Types</span>
                        <button onClick={() => setChargeFilterOpen(false)} className="text-xs text-gray-400 hover:text-black">✕</button>
                      </div>
                      <div className="p-2 space-y-0.5 max-h-56 overflow-y-auto">
                        {[
                          { value: "Usage",                   label: "Usage" },
                          { value: "SavingsPlanCoveredUsage", label: "Savings Plan Usage" },
                          { value: "SavingsPlanRecurringFee", label: "Savings Plan Fee" },
                          { value: "SavingsPlanNegation",     label: "Savings Plan Negation" },
                          { value: "RIFee",                   label: "Reserved Instance Fee" },
                          { value: "DiscountedUsage",         label: "Discounted Usage" },
                          { value: "Tax",                     label: "Tax" },
                          { value: "DistributorDiscount",     label: "Distributor Discount" },
                          { value: "Credit",                  label: "Credit" },
                          { value: "Refund",                  label: "Refund" },
                          { value: "OCBLateFee",              label: "Late Fee (OCB)" },
                          { value: "Fee",                     label: "Fee" },
                        ].map((ct) => (
                          <label key={ct.value} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50 transition">
                            <input
                              type="checkbox"
                              checked={selectedChargeTypes.includes(ct.value)}
                              onChange={() => setSelectedChargeTypes((prev) =>
                                prev.includes(ct.value)
                                  ? prev.filter((x) => x !== ct.value)
                                  : [...prev, ct.value]
                              )}
                              className="w-3.5 h-3.5 accent-blue-900"
                            />
                            <span className="text-xs font-medium text-black">{ct.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="p-2 border-t border-gray-100 flex gap-2">
                        <button
                          onClick={() => { setSelectedChargeTypes([...DEFAULT_CHARGE_TYPES]); setChargeFilterOpen(false); }}
                          className="flex-1 text-xs font-bold text-blue-900 hover:underline">
                          Reset defaults
                        </button>
                        <button
                          onClick={() => { setSelectedChargeTypes([...ALL_CHARGE_TYPES]); setChargeFilterOpen(false); }}
                          className="flex-1 text-xs font-bold text-gray-500 hover:underline">
                          Select all
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Account multi-select dropdown */}
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
              </div> {/* end flex items-center gap-3 */}
            </div>
            {/* True cost table */}
            {showTrueCost ? (
              <>
                {trueCostView === "resource" ? (
                  /* ── Resource-wise true cost view ── */
                  <>
                    {allSpResLoading ? (
                      <div className="flex items-center justify-center h-32">
                        <RefreshCw className="w-5 h-5 animate-spin text-blue-900" />
                      </div>
                    ) : allSpResources.length === 0 ? (
                      <div className="p-10 text-center text-sm text-black">No SP covered resources found for this period.</div>
                    ) : (() => {
                      // Group by service
                      const byService: Record<string, any[]> = {};
                      allSpResources.forEach((r: any) => {
                        const svc = r.service || "Other";
                        if (!byService[svc]) byService[svc] = [];
                        byService[svc].push(r);
                      });
                      const services = Object.keys(byService).sort();
                      return (
                        <table className="w-full">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                              {["Resource ID", "Account", "Region", "On-Demand Cost", "SP Allocated", "True Cost", "Savings", "Savings %"].map((h) => (
                                <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-3">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {services.map((svc) => (
                              <Fragment key={svc}>
                                {/* Service category header row */}
                                <tr className="bg-blue-900">
                                  <td colSpan={8} className="px-4 py-2 text-xs font-bold text-white tracking-wider">
                                    {svc} <span className="font-normal opacity-75">({byService[svc].length} resources · {fmt(byService[svc].reduce((s: number, r: any) => s + (r.sp_allocated_cost || 0), 0))} true cost)</span>
                                  </td>
                                </tr>
                                {byService[svc].map((r: any, i: number) => (
                                  <tr key={i} className="border-b border-gray-200 hover:bg-blue-50 transition">
                                    <td className="px-4 py-2.5 text-xs font-mono font-semibold text-black max-w-[200px] truncate">{r.resource_id}</td>
                                    <td className="px-4 py-2.5">
                                      <div className="text-xs font-semibold text-black">{r.account_name}</div>
                                      <div className="text-[10px] font-mono text-gray-500">{r.aws_account_id}</div>
                                    </td>
                                    <td className="px-4 py-2.5 text-xs text-black">{r.region || "—"}</td>
                                    <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{fmt(r.on_demand_cost)}</td>
                                    <td className="px-4 py-2.5 text-xs font-bold font-mono text-orange-700">{fmt(r.sp_allocated_cost)}</td>
                                    {/* True Cost = sp_allocated_cost (what you actually pay) */}
                                    <td className="px-4 py-2.5 text-xs font-bold font-mono text-blue-900">{fmt(r.sp_allocated_cost)}</td>
                                    <td className="px-4 py-2.5 text-xs font-bold font-mono text-green-700">{fmt(r.savings)}</td>
                                    <td className="px-4 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                          <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(r.savings_pct, 100)}%` }} />
                                        </div>
                                        <span className="text-xs font-bold text-green-700">{r.savings_pct}%</span>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {/* Service subtotal */}
                                <tr className="bg-gray-50 border-b-2 border-gray-300">
                                  <td className="px-4 py-2 text-xs font-bold text-black" colSpan={3}>Subtotal — {svc}</td>
                                  <td className="px-4 py-2 text-xs font-bold font-mono text-gray-500">{fmt(byService[svc].reduce((s: number, r: any) => s + (r.on_demand_cost || 0), 0))}</td>
                                  <td className="px-4 py-2 text-xs font-bold font-mono text-orange-700">{fmt(byService[svc].reduce((s: number, r: any) => s + (r.sp_allocated_cost || 0), 0))}</td>
                                  <td className="px-4 py-2 text-xs font-bold font-mono text-blue-900">{fmt(byService[svc].reduce((s: number, r: any) => s + (r.sp_allocated_cost || 0), 0))}</td>
                                  <td className="px-4 py-2 text-xs font-bold font-mono text-green-700">{fmt(byService[svc].reduce((s: number, r: any) => s + (r.savings || 0), 0))}</td>
                                  <td className="px-4 py-2" />
                                </tr>
                              </Fragment>
                            ))}
                            {/* Grand total */}
                            <tr className="bg-blue-50 border-t-2 border-blue-900">
                              <td className="px-4 py-3 text-sm font-bold text-black" colSpan={3}>Grand Total ({allSpResources.length} resources)</td>
                              <td className="px-4 py-3 text-sm font-bold font-mono text-gray-500">{fmt(allSpResources.reduce((s: number, r: any) => s + (r.on_demand_cost || 0), 0))}</td>
                              <td className="px-4 py-3 text-sm font-bold font-mono text-orange-700">{fmt(allSpResources.reduce((s: number, r: any) => s + (r.sp_allocated_cost || 0), 0))}</td>
                              <td className="px-4 py-3 text-sm font-bold font-mono text-blue-900">{fmt(allSpResources.reduce((s: number, r: any) => s + (r.sp_allocated_cost || 0), 0))}</td>
                              <td className="px-4 py-3 text-sm font-bold font-mono text-green-700">{fmt(allSpResources.reduce((s: number, r: any) => s + (r.savings || 0), 0))}</td>
                              <td className="px-4 py-3" />
                            </tr>
                          </tbody>
                        </table>
                      );
                    })()}
                  </>
                ) : (
                  /* ── Account-wise true cost view ── */
                  <>
                {/* Payer account banner */}
                {spDist?.payer_accounts?.length > 0 && (
                  <div className="mx-5 mt-3 bg-orange-50 border border-orange-200 border-l-4 border-l-orange-500 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TrendingDown className="w-4 h-4 text-orange-600 flex-shrink-0" />
                      <span className="text-xs font-bold text-orange-900">
                        SP Fee in payer account{spDist.payer_accounts.length > 1 ? "s" : ""}:
                      </span>
                      {spDist.payer_accounts.map((p: any) => (
                        <span key={p.aws_account_id} className="text-xs font-mono font-bold text-orange-800 bg-orange-100 px-2 py-0.5 rounded">
                          {p.account_name} = {fmt(p.sp_fee)}
                        </span>
                      ))}
                      <span className="text-xs font-semibold text-orange-900 ml-2">
                        Total {fmt(spDist.total_sp_fee)} → distributed to sub-accounts below based on SP usage
                      </span>
                    </div>
                  </div>
                )}
                <table className="w-full mt-2">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {["Account", "Account ID", "Usage Cost", "SP Allocated", "True Cost", "Savings", "Savings %", "SP Resources"].map((h) => (
                        <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trueCostLoading ? (
                      <tr><td colSpan={8} className="px-5 py-8 text-center">
                        <RefreshCw className="w-5 h-5 animate-spin text-blue-900 mx-auto" />
                      </td></tr>
                    ) : (
                      trueCostData
                        .filter((acc: any) => selectedAccounts.length === 0 || selectedAccounts.includes(acc.aws_account_id))
                        .map((acc: any) => (
                          <tr key={acc.aws_account_id}
                            className={`border-b border-gray-200 transition ${
                              acc.is_payer ? "bg-orange-50 hover:bg-orange-100" : "hover:bg-blue-50"
                            }`}>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white ${
                                  acc.is_payer ? "bg-orange-600" : "bg-blue-900"
                                }`}>
                                  {(acc.account_name || "?")[0].toUpperCase()}
                                </div>
                                <div>
                                  <span className="text-sm font-bold text-black">{acc.account_name}</span>
                                  {acc.is_payer && (
                                    <div className="text-[10px] text-orange-700 font-semibold">
                                      SP fee {fmt(acc.sp_fee_distributed)} distributed to sub-accounts
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-xs font-mono font-semibold text-black">{acc.aws_account_id}</td>
                            {/* Usage Cost */}
                            <td className="px-5 py-3 text-sm font-mono font-semibold text-black">
                              {fmt(acc.usage_cost)}
                            </td>
                            {/* SP Allocated */}
                            <td className="px-5 py-3">
                              {acc.is_payer ? (
                                <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded">
                                  −{fmt(acc.sp_fee_distributed)} distributed
                                </span>
                              ) : acc.sp_allocated > 0 ? (
                                <div>
                                  <span className="text-sm font-bold font-mono text-orange-700">+{fmt(acc.sp_allocated)}</span>
                                  <div className="text-[10px] text-gray-500">{acc.sp_share_pct}% of SP pool</div>
                                </div>
                              ) : <span className="text-xs text-gray-400">—</span>}
                            </td>
                            {/* True Cost */}
                            <td className="px-5 py-3">
                              <span className="text-sm font-bold font-mono text-blue-900">{fmt(acc.true_cost)}</span>
                            </td>
                            {/* Savings */}
                            <td className="px-5 py-3">
                              {!acc.is_payer && acc.savings > 0
                                ? <span className="text-sm font-bold font-mono text-green-700">{fmt(acc.savings)}</span>
                                : <span className="text-xs text-gray-400">—</span>}
                            </td>
                            {/* Savings % */}
                            <td className="px-5 py-3">
                              {!acc.is_payer && acc.savings_pct > 0 ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(acc.savings_pct, 100)}%` }} />
                                  </div>
                                  <span className="text-xs font-bold text-green-700">{acc.savings_pct}%</span>
                                </div>
                              ) : <span className="text-xs text-gray-400">—</span>}
                            </td>
                            {/* SP Resources */}
                            <td className="px-5 py-3 text-sm font-semibold text-black">
                              {!acc.is_payer && acc.sp_resources > 0 ? (
                                <button
                                  onClick={() => openSpResources(acc.aws_account_id, acc.account_name)}
                                  className="flex items-center gap-1.5 text-xs font-bold text-blue-900 hover:underline">
                                  {acc.sp_resources.toLocaleString()} resources
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              ) : "—"}
                            </td>
                          </tr>
                        ))
                    )}
                    {!trueCostLoading && spDist && (
                      <tr className="bg-gray-50 border-t-2 border-gray-300">
                        <td className="px-5 py-3 text-sm font-bold text-black" colSpan={2}>Total</td>
                        <td className="px-5 py-3 text-sm font-bold font-mono text-black">{fmt(spDist.total_usage_cost || 0)}</td>
                        <td className="px-5 py-3 text-sm font-bold font-mono text-orange-700">+{fmt(spDist.total_sp_allocated)}</td>
                        <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">{fmt(spDist.total_true_cost)}</td>
                        <td className="px-5 py-3 text-sm font-bold font-mono text-green-700">{fmt(spDist.total_savings)}</td>
                        <td className="px-5 py-3" colSpan={2} />
                      </tr>
                    )}
                  </tbody>
                </table>
                </> {/* end account-wise */}
                )} {/* end trueCostView ternary */}
              </> {/* end showTrueCost outer fragment */}
            ) : (
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
            )}
          </div>

          {/* Service / Resource / Tag tabs */}
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200">
              <div className="flex">
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
              {tabData.length > 0 && (
                <button
                  onClick={() => {
                    if (activeTab === "service") {
                      const headers = ["Service", "Cost (USD)"];
                      const rows = (tabData as any[]).map((r: any) => [r.service || "—", r.cost?.toFixed(2) || "0"]);
                      downloadCSV(`service-wise-${ct?.name}-${startDate}-${endDate}.csv`, [headers, ...rows]);
                    } else if (activeTab === "resource") {
                      const headers = ["Resource ID", "Service", "Region", "Cost (USD)"];
                      const rows = (tabData as any[]).map((r: any) => [r.resource_id || "—", r.service || "—", r.region || "—", r.cost?.toFixed(2) || "0"]);
                      downloadCSV(`resource-wise-${ct?.name}-${startDate}-${endDate}.csv`, [headers, ...rows]);
                    } else {
                      const headers = ["Tag Key", "Tag Value", "Cost (USD)"];
                      const rows = (tabData as any[]).map((r: any) => [r.tag_key || "—", r.tag_value || "(untagged)", r.cost?.toFixed(2) || "0"]);
                      downloadCSV(`tag-wise-${ct?.name}-${startDate}-${endDate}.csv`, [headers, ...rows]);
                    }
                  }}
                  className="flex items-center gap-1.5 mr-4 px-3 py-1.5 rounded-md border border-gray-300 text-xs font-bold text-black hover:border-blue-900 hover:text-blue-900 transition bg-white"
                  title="Download CSV">
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
              )}
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
      {/* SP Resources Modal */}
      {spResourceModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h3 className="text-sm font-bold text-black flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-green-700" />
                  SP Covered Resources — {spResourceModal.accountName}
                </h3>
                <p className="text-[10px] text-gray-500 mt-0.5 font-mono">{spResourceModal.accountId} · {startDate} → {endDate}</p>
              </div>
              <button onClick={() => setSpResourceModal(null)} className="p-1.5 rounded hover:bg-gray-100 transition">
                <span className="text-black font-bold text-sm">✕</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {spResLoading ? (
                <div className="flex items-center justify-center h-40">
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-900" />
                </div>
              ) : spResources.length === 0 ? (
                <div className="p-12 text-center text-sm text-black">No SP covered resources found for this period.</div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      {["#", "Resource ID", "Service", "Region", "On-Demand Cost", "SP Allocated", "Savings", "Savings %"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {spResources.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-gray-200 hover:bg-blue-50 transition">
                        <td className="px-4 py-2.5 text-xs font-bold text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2.5 text-xs font-mono font-semibold text-black max-w-xs truncate">{r.resource_id}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900">{r.service}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-black">{r.region || "—"}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-gray-500">{fmt(r.on_demand_cost)}</td>
                        <td className="px-4 py-2.5 text-sm font-bold font-mono text-orange-700">{fmt(r.sp_allocated_cost)}</td>
                        <td className="px-4 py-2.5 text-sm font-bold font-mono text-green-700">{fmt(r.savings)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-14 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(r.savings_pct, 100)}%` }} />
                            </div>
                            <span className="text-xs font-bold text-green-700">{r.savings_pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 border-t-2 border-gray-300">
                      <td className="px-4 py-3 text-sm font-bold text-black" colSpan={4}>Total ({spResources.length} resources)</td>
                      <td className="px-4 py-3 text-sm font-mono font-bold text-gray-500">{fmt(spResources.reduce((s: number, r: any) => s + r.on_demand_cost, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono font-bold text-orange-700">{fmt(spResources.reduce((s: number, r: any) => s + r.sp_allocated_cost, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono font-bold text-green-700">{fmt(spResources.reduce((s: number, r: any) => s + r.savings, 0))}</td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}