"use client";
import * as XLSX from "xlsx";
import { useEffect, useState, Fragment } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

const TABS = [
  { label: "Service Wise", value: "service" },
  { label: "Resource Wise", value: "resource" },
  { label: "Tag Wise", value: "tag" },
];

function getLastMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

function getThisMonth(accurateUntil?: string) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: accurateUntil || fmt(now) };
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
  const Q = String.fromCharCode(34);
  const csv = rows.map((r) => r.map((c) => Q + String(c).split(Q).join(Q + Q) + Q).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Cost column header keywords — these columns get numeric cells + left alignment
const COST_HEADERS = new Set(["Usage Cost", "SP Allocated", "True Cost", "Actual Cost", "Savings", "On-Demand Equiv", "On-Demand Cost", "Uncovered Cost", "Cost (USD)", "Usage Cost (USD)", "Actual Cost (USD)"]);

function getResourceDescription(r: any): { desc: string; attachment: string } {
  const rid: string = r.resource_id || "";
  const usageType: string = r.usage_type || "";
  const operation: string = r.operation || "";
  const ut = usageType.toLowerCase();
  const at = r.attachment_tags || {};
  const instanceType: string = r.instance_type || "";
  const os: string = r.os || "";
  const volumeType: string = r.volume_type || "";
  const storageMedia: string = r.storage_media || "";
  const qty: number = r.usage_quantity || 0;

  const attachHint =
    at["instance-id"] || at["instanceid"] || at["attached-to"] || at["attachedto"] ||
    at["ec2-name"] || at["ec2name"] || at["source-instance"] || at["sourceinstance"] || "";
  const volHint = at["volume-id"] || at["volumeid"] || at["source-volume"] || at["sourcevolume"] || "";

  if (rid.startsWith("vol-")) {
    let vt = volumeType;
    if (!vt) { const m = usageType.match(/VolumeUsage\.?(\w+)?/i); if (m?.[1]) vt = m[1]; }
    const sizePart = qty > 0 ? ` · ${Math.round(qty)} GB` : "";
    const mediaPart = storageMedia ? ` (${storageMedia})` : "";
    const desc = vt ? `EBS Volume · ${vt}${mediaPart}${sizePart}` : `EBS Volume${mediaPart}${sizePart}`;
    return { desc, attachment: attachHint ? `Attached to: ${attachHint}` : "" };
  }
  if (rid.startsWith("snap-")) {
    const sizePart = qty > 0 ? ` · ${Math.round(qty)} GB` : "";
    const parts: string[] = [];
    if (volHint) parts.push(`From volume: ${volHint}`);
    if (attachHint) parts.push(`Instance: ${attachHint}`);
    return { desc: `EBS Snapshot${sizePart}`, attachment: parts.join(" · ") };
  }
  if (rid.startsWith("i-")) {
    let itype = instanceType;
    if (!itype) { const m = usageType.match(/BoxUsage:(\S+)/i); if (m) itype = m[1]; }
    const osPart = os ? ` · ${os}` : "";
    return { desc: itype ? `EC2 Instance · ${itype}${osPart}` : `EC2 Instance${osPart}`, attachment: "" };
  }
  if (ut.includes("elasticip") || ut.includes("elastic-ip")) {
    const idle = ut.includes("idle") || ut.includes("unassociated");
    return {
      desc: idle ? "Elastic IP · Idle / Unassociated" : "Elastic IP",
      attachment: attachHint ? `Associated with: ${attachHint}` : idle ? "Not attached to any instance" : "",
    };
  }
  if (rid.startsWith("eni-")) {
    let desc = "Network Interface (ENI)";
    if (ut.includes("natgateway")) desc = "NAT Gateway ENI";
    else if (ut.includes("vpcendpoint")) desc = "VPC Endpoint ENI";
    else if (ut.includes("transitgateway")) desc = "Transit Gateway ENI";
    return { desc, attachment: attachHint ? `Attached to: ${attachHint}` : "" };
  }
  if (rid.startsWith("nat-") || ut.includes("natgateway"))
    return { desc: ut.includes("bytes") ? "NAT Gateway · Data Transfer" : "NAT Gateway", attachment: "" };
  if (rid.includes("loadbalancer") || rid.includes("app/") || rid.includes("net/"))
    return { desc: rid.includes("app/") ? "Application Load Balancer" : rid.includes("net/") ? "Network Load Balancer" : "Load Balancer", attachment: "" };
  if (rid.startsWith("db:") || rid.includes(":db:"))
    return { desc: operation.toLowerCase().includes("snapshot") ? "RDS Snapshot" : "RDS Instance", attachment: "" };
  return { desc: "", attachment: "" };
}

function downloadMultiSheetXls(filename: string, sheets: { name: string; headers: string[]; rows: (string | number)[][] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows]);
    // Apply left alignment + number format to cost columns
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    s.headers.forEach((h, colIdx) => {
      if (!COST_HEADERS.has(h)) return;
      for (let row = 1; row <= range.e.r; row++) {
        const addr = XLSX.utils.encode_cell({ r: row, c: colIdx });
        if (!ws[addr]) return;
        const raw = ws[addr].v;
        const num = typeof raw === "number" ? raw : parseFloat(String(raw));
        ws[addr] = { t: "n", v: isNaN(num) ? 0 : num, z: "#,##0.00", s: { alignment: { horizontal: "left" } } };
      }
    });
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, filename);
}

export default function CTDetailPage() {
  const { ctId } = useParams<{ ctId: string }>();
  const { token } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["ct-primary", ctId] });
    qc.invalidateQueries({ queryKey: ["ct-tab", ctId] });
  };

  const lastMonth = getLastMonth();

  const [startDate, setStartDate] = useState(lastMonth.start);
  const [endDate, setEndDate] = useState(lastMonth.end);
  const granularity = "monthly";
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedChargeTypes, setSelectedChargeTypes] = useState<string[]>(DEFAULT_CHARGE_TYPES);
  const [chargeFilterOpen, setChargeFilterOpen] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [pendingAccounts, setPendingAccounts] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("service");
  const [showTrueCost] = useState(true);
  const [trueCostView, setTrueCostView] = useState<"account" | "sp_resource">("account");
  const [spResourceModal, setSpResourceModal] = useState<{ accountId: string; accountName: string } | null>(null);
  const [spResources, setSpResources] = useState<any[]>([]);
  const [spResLoading, setSpResLoading] = useState(false);
  const [allSpResources, setAllSpResources] = useState<any[]>([]);
  const [allSpResLoading, setAllSpResLoading] = useState(false);
  const [allSpResLoaded, setAllSpResLoaded] = useState(false);

  const openSpResources = async (accountId: string, accountName: string) => {
    setSpResourceModal({ accountId, accountName });
    setSpResources([]);
    setSpResLoading(true);
    try {
      const res = await api.get("/reports/savings/resources", {
        params: { ct_id: ctId, start_date: startDate, end_date: endDate, account_ids: accountId, limit: 500 },
      });
      setSpResources(res.data);
    } catch (e) { console.error(e); }
    finally { setSpResLoading(false); }
  };

  const loadAllSpResources = async () => {
    setAllSpResLoading(true);
    try {
      const params: any = { ct_id: ctId, start_date: startDate, end_date: endDate, limit: 2000 };
      if (selectedAccounts.length > 0) params.account_ids = selectedAccounts.join(",");
      const res = await api.get("/reports/savings/resources", { params });
      setAllSpResources(res.data);
    } catch (e) { console.error(e); }
    finally { setAllSpResLoading(false); setAllSpResLoaded(true); }
  };

  useEffect(() => { if (!token) router.push("/auth"); }, [token]);
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

  useEffect(() => { setAllSpResources([]); setAllSpResLoaded(false); }, [startDate, endDate, selectedAccounts]);

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

  // Merge summary + spDist into one parallel fetch — halves initial API round-trips
  const { data: primaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ["ct-primary", ctId, startDate, endDate, granularity, selectedAccounts, selectedChargeTypes],
    queryFn: async () => {
      const [summaryRes, spDistRes] = await Promise.all([
        api.post("/reports/summary", filter),
        api.get("/reports/savings/ct-distribution", {
          params: { ct_id: ctId, start_date: startDate, end_date: endDate },
        }).catch(() => ({ data: null })),
      ]);
      return { summary: summaryRes.data, spDist: spDistRes.data };
    },
    enabled: !!token && !!ctId,
    staleTime: 30 * 60 * 1000,
  });

  const summary = primaryData?.summary;
  const spDist = primaryData?.spDist;
  const trueCostData: any[] = spDist?.sub_accounts || [];
  const trueCostLoading = summaryLoading;

  // Tab query deferred until primary data is ready — avoids 3 simultaneous heavy queries on load
  const tabEndpoint = activeTab === "service" ? "/reports/service-wise"
    : activeTab === "resource" ? "/reports/resource-wise"
    : "/reports/tag-wise";

  const tabFilter = {
    ...filter,
    group_by: activeTab,
    granularity: "monthly",
    // For resource tab always include SP rows so actual_cost reflects true cost (usage + SP amortized)
    ...(activeTab === "resource" ? { charge_types: null } : {}),
  };

  const { data: tabData = [], isLoading: tabLoading } = useQuery({
    queryKey: ["ct-tab", ctId, activeTab, startDate, endDate, selectedAccounts, selectedChargeTypes],
    queryFn: () => api.post(tabEndpoint, tabFilter).then((r) => r.data),
    enabled: !!token && !!ctId && !summaryLoading,
    staleTime: 30 * 60 * 1000,
  });

  const stackedData = (() => {
    if (!summary?.per_account) return [];
    return summary.per_account?.slice(0, 10).map((acc: any) => ({
      name: (acc.account_name || acc.aws_account_id).slice(0, 15),
      cost: parseFloat(acc.cost.toFixed(2)),
    })) || [];
  })();

  const totalCost = summary?.total_cost || 0;

  const byService: Record<string, any[]> = {};
  allSpResources.forEach((r: any) => {
    const svc = r.service || "Other";
    if (!byService[svc]) byService[svc] = [];
    byService[svc].push(r);
  });
  const serviceKeys = Object.keys(byService).sort();

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
          <p className="text-xs text-black mt-0.5 font-mono">{ct?.management_account_id} &middot; {ct?.management_account_name}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              max={boundary?.accurate_until}
              className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
            <span className="text-xs text-black font-semibold">to</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              max={boundary?.accurate_until}
              className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          </div>
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
          <button onClick={refreshAll} title="Refresh data"
            className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition">
            <RefreshCw className={`w-4 h-4 text-black ${summaryLoading ? "animate-spin" : ""}`} />
          </button>
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
              <div className="text-xs text-black mt-1">{startDate} to {endDate}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">Top Service</div>
              <div className="text-base font-bold text-orange-600 truncate">{summary?.top_services?.[0]?.service || "-"}</div>
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
              <h2 className="text-sm font-bold text-black">Subaccount Cost - By Account</h2>
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
                <div className="flex border border-gray-300 rounded-md overflow-hidden">
                  <button
                    onClick={() => setTrueCostView("account")}
                    className={`px-3 py-1 text-xs font-bold transition ${
                      trueCostView === "account" ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                    }`}>
                    Account Wise
                  </button>
                  <button
                    onClick={() => { setAllSpResources([]); setAllSpResLoaded(false); setTrueCostView("sp_resource"); loadAllSpResources(); }}
                    className={`px-3 py-1 text-xs font-bold border-l border-gray-300 transition ${
                      trueCostView === "sp_resource" ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                    }`}>
                    SP Cost per Resource
                  </button>
                </div>
                <button
                  onClick={async () => {
                    if (trueCostView === "sp_resource") {
                      const xlsParams: any = { ct_id: ctId, start_date: startDate, end_date: endDate, limit: 2000 };
                      if (selectedAccounts.length > 0) xlsParams.account_ids = selectedAccounts.join(",");
                      const data = allSpResources.length > 0 ? allSpResources : await api.get("/reports/savings/resources", { params: xlsParams }).then((r: any) => r.data);
                      const headers = ["Service", "Resource ID", "Instance Type", "Account", "Account ID", "Region", "Usage Time", "On-Demand Equiv", "SP Allocated", "Uncovered Cost", "Actual Cost", "Savings", "Savings %"];
                      const rows = (data as any[]).map((r: any) => [
                        r.service || "-", r.resource_id || "-", r.instance_type || "-", r.account_name || "-", r.aws_account_id || "-",
                        r.region || "-", r.total_hours != null ? `${Math.floor(r.total_hours)}h ${Math.round((r.total_hours % 1) * 60)}m` : "-",
                        r.on_demand_cost ?? 0,
                        r.sp_allocated_cost ?? 0,
                        r.uncovered_cost ?? 0,
                        r.true_cost ?? 0,
                        r.savings ?? 0,
                        r.savings_pct ? `${r.savings_pct}%` : "0%",
                      ]);
                      downloadMultiSheetXls(`true-cost-resource-wise-${ct?.name}-${startDate}-${endDate}.xlsx`, [
                        { name: "Resource True Cost", headers, rows },
                      ]);
                    } else if (trueCostData.length > 0) {
                      const tcHeaders = ["Account", "Account ID", "Usage Cost", "SP Allocated", "True Cost"];
                      const filteredAccounts = trueCostData.filter((acc: any) => selectedAccounts.length === 0 || selectedAccounts.includes(acc.aws_account_id));
                      const tcRows = filteredAccounts.map((acc: any) => [
                          acc.account_name || "", acc.aws_account_id,
                          acc.usage_cost ?? 0,
                          acc.is_payer ? -(acc.sp_fee_distributed ?? 0) : (acc.sp_allocated ?? 0),
                          acc.true_cost ?? 0,
                        ]);
                      // Total row
                      tcRows.push([
                        "Total", "",
                        filteredAccounts.reduce((s: number, a: any) => s + (a.usage_cost ?? 0), 0),
                        filteredAccounts.reduce((s: number, a: any) => s + (a.is_payer ? -(a.sp_fee_distributed ?? 0) : (a.sp_allocated ?? 0)), 0),
                        filteredAccounts.reduce((s: number, a: any) => s + (a.true_cost ?? 0), 0),
                      ]);
                      const monthLabel = new Date(startDate).toLocaleString("en-US", { month: "long", year: "numeric" }).replace(" ", "");
                      const accountLabel = selectedAccounts.length === 1
                        ? (trueCostData.find((a: any) => a.aws_account_id === selectedAccounts[0])?.account_name || selectedAccounts[0])
                        : (ct?.name || "All");
                      downloadMultiSheetXls(`${accountLabel}-cost-${monthLabel}.xlsx`, [
                        { name: "True Cost", headers: tcHeaders, rows: tcRows },
                      ]);
                    } else if (summary?.per_account?.length > 0) {
                      const headers = ["Account", "Account ID", "Cost (USD)", "% of Total"];
                      const rows = (summary.per_account as any[])
                        .filter((acc: any) => selectedAccounts.length === 0 || selectedAccounts.includes(acc.aws_account_id))
                        .map((acc: any) => [
                          acc.account_name || "Unknown", acc.aws_account_id,
                          acc.cost ?? 0,
                          totalCost > 0 ? `${((acc.cost / totalCost) * 100).toFixed(1)}%` : "0%",
                        ]);
                      downloadMultiSheetXls(`subaccount-cost-${ct?.name}-${startDate}-${endDate}.xlsx`, [
                        { name: "Subaccount Costs", headers, rows },
                      ]);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-gray-300 text-xs font-bold text-black hover:border-blue-900 hover:text-blue-900 transition bg-white"
                  title="Download XLS">
                  <Download className="w-3.5 h-3.5" /> XLS
                </button>
              </div>
              <div className="flex items-center gap-3">
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
                        <button onClick={() => setChargeFilterOpen(false)} className="text-xs text-gray-400 hover:text-black">x</button>
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
                        ].map((chargeType) => (
                          <label key={chargeType.value} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50 transition">
                            <input
                              type="checkbox"
                              checked={selectedChargeTypes.includes(chargeType.value)}
                              onChange={() => setSelectedChargeTypes((prev) =>
                                prev.includes(chargeType.value)
                                  ? prev.filter((x) => x !== chargeType.value)
                                  : [...prev, chargeType.value]
                              )}
                              className="w-3.5 h-3.5 accent-blue-900"
                            />
                            <span className="text-xs font-medium text-black">{chargeType.label}</span>
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
                <div className="relative">
                  <button
                    onClick={() => { setPendingAccounts(selectedAccounts); setAccountSearch(""); setAccountDropdownOpen(!accountDropdownOpen); }}
                    className="flex items-center gap-2 px-3 py-1.5 border border-gray-400 rounded-md text-xs font-bold text-black bg-white hover:border-blue-900 transition min-w-[180px] justify-between">
                    <span>
                      {selectedAccounts.length === 0
                        ? "All Accounts"
                        : `${selectedAccounts.length} account${selectedAccounts.length > 1 ? "s" : ""} selected`}
                    </span>
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${accountDropdownOpen ? "rotate-90" : ""}`} />
                  </button>
                  {accountDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 min-w-[240px]">
                      <div className="p-2 border-b border-gray-100">
                        <input
                          type="text"
                          value={accountSearch}
                          onChange={(e) => setAccountSearch(e.target.value)}
                          placeholder="Search by name or account ID..."
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md outline-none focus:border-blue-900"
                          autoFocus
                        />
                      </div>
                      <div className="p-1.5 border-b border-gray-100">
                        <button
                          onClick={() => setPendingAccounts([])}
                          className={`w-full text-left px-3 py-1.5 text-xs font-bold rounded transition ${
                            pendingAccounts.length === 0 ? "bg-blue-900 text-white" : "text-black hover:bg-gray-100"
                          }`}>
                          All Accounts
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto p-1.5 space-y-0.5">
                        {subAccounts
                          .filter((acc: any) =>
                            !accountSearch ||
                            acc.account_name.toLowerCase().includes(accountSearch.toLowerCase()) ||
                            acc.aws_account_id.includes(accountSearch)
                          )
                          .map((acc: any) => {
                            const checked = pendingAccounts.includes(acc.aws_account_id);
                            return (
                              <label key={acc.aws_account_id}
                                className="flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer hover:bg-gray-50 transition">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => setPendingAccounts((prev) =>
                                    checked ? prev.filter((a) => a !== acc.aws_account_id) : [...prev, acc.aws_account_id]
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
                      <div className="p-2 border-t border-gray-100 flex items-center justify-between gap-2">
                        <button
                          onClick={() => setPendingAccounts([])}
                          className="text-xs font-bold text-red-500 hover:text-red-700 transition">
                          Clear
                        </button>
                        <button
                          onClick={() => { setSelectedAccounts(pendingAccounts); setAccountDropdownOpen(false); }}
                          className="px-4 py-1.5 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition">
                          OK
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {trueCostView === "sp_resource" ? (
                  <>
                    {allSpResLoading ? (
                      <div className="flex items-center justify-center h-32">
                        <RefreshCw className="w-5 h-5 animate-spin text-blue-900" />
                      </div>
                    ) : !allSpResLoaded ? (
                      <div className="p-10 text-center">
                        <p className="text-sm text-black mb-3">Click to load SP covered resources for this period.</p>
                        <button onClick={loadAllSpResources}
                          className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition">
                          Load Resources
                        </button>
                      </div>
                    ) : allSpResources.length === 0 ? (
                      <div className="p-10 text-center">
                        <p className="text-sm text-black">No Savings Plan covered resources found for this period.</p>
                        <p className="text-xs text-gray-500 mt-1">This account may not have any active Savings Plans.</p>
                      </div>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            {["Resource ID", "Instance Type", "Account", "Region", "Usage Time", "On-Demand Equiv", "SP Allocated", "Uncovered Cost", "Actual Cost", "Savings", "Savings %"].map((h) => (
                              <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-3">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {serviceKeys.map((svc) => (
                            <Fragment key={svc}>
                              <tr className="bg-blue-900">
                                <td colSpan={11} className="px-4 py-2 text-xs font-bold text-white tracking-wider">
                                  {svc} <span className="font-normal opacity-75">({byService[svc].length} resources - {fmt(byService[svc].reduce((s: number, r: any) => s + (r.true_cost || 0), 0))} true cost)</span>
                                </td>
                              </tr>
                              {byService[svc].map((r: any, i: number) => (
                                <tr key={i} className="border-b border-gray-200 hover:bg-blue-50 transition">
                                  <td className="px-4 py-2.5 text-xs font-mono font-semibold text-black max-w-[200px] truncate">{r.resource_id}</td>
                                  <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{r.instance_type || <span className="text-gray-300">-</span>}</td>
                                  <td className="px-4 py-2.5">
                                    <div className="text-xs font-semibold text-black">{r.account_name}</div>
                                    <div className="text-[10px] font-mono text-gray-500">{r.aws_account_id}</div>
                                  </td>
                                  <td className="px-4 py-2.5 text-xs text-black">{r.region || "-"}</td>
                                  <td className="px-4 py-2.5 text-xs font-mono text-gray-600">
                                    {r.total_hours != null ? `${Math.floor(r.total_hours)}h ${Math.round((r.total_hours % 1) * 60)}m` : "-"}
                                  </td>
                                  <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{fmt(r.on_demand_cost)}</td>
                                  <td className="px-4 py-2.5 text-xs font-bold font-mono text-orange-700">{fmt(r.sp_allocated_cost)}</td>
                                  <td className="px-4 py-2.5 text-xs font-mono text-red-600">
                                  {r.uncovered_cost > 0 ? fmt(r.uncovered_cost) : <span className="text-gray-300">-</span>}
                                  </td>
                                  <td className="px-4 py-2.5 text-xs font-bold font-mono text-blue-900">{fmt(r.true_cost)}</td>
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
                              <tr className="bg-gray-50 border-b-2 border-gray-300">
                                <td className="px-4 py-2 text-xs font-bold text-black" colSpan={3}>Subtotal - {svc}</td>
                                <td className="px-4 py-2 text-xs font-bold font-mono text-gray-600">
                                  {(() => { const h = byService[svc].reduce((s: number, r: any) => s + (r.total_hours || 0), 0); return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`; })()}
                                </td>
                                <td className="px-4 py-2 text-xs font-bold font-mono text-gray-500">{fmt(byService[svc].reduce((s: number, r: any) => s + (r.on_demand_cost || 0), 0))}</td>
                                <td className="px-4 py-2 text-xs font-bold font-mono text-orange-700">{fmt(byService[svc].reduce((s: number, r: any) => s + (r.sp_allocated_cost || 0), 0))}</td>
                                <td className="px-4 py-2 text-xs font-bold font-mono text-red-600">{fmt(byService[svc].reduce((s: number, r: any) => s + (r.uncovered_cost || 0), 0))}</td>
                                <td className="px-4 py-2 text-xs font-bold font-mono text-blue-900">{fmt(byService[svc].reduce((s: number, r: any) => s + (r.true_cost || 0), 0))}</td>
                                <td className="px-4 py-2 text-xs font-bold font-mono text-green-700">{fmt(byService[svc].reduce((s: number, r: any) => s + (r.savings || 0), 0))}</td>
                                <td className="px-4 py-2" />
                              </tr>
                            </Fragment>
                          ))}
                          <tr className="bg-blue-50 border-t-2 border-blue-900">
                            <td className="px-4 py-3 text-sm font-bold text-black" colSpan={3}>Grand Total ({allSpResources.length} resources)</td>
                            <td className="px-4 py-3 text-sm font-bold font-mono text-gray-500">{fmt(allSpResources.reduce((s: number, r: any) => s + (r.on_demand_cost || 0), 0))}</td>
                            <td className="px-4 py-3 text-sm font-bold font-mono text-orange-700">{fmt(allSpResources.reduce((s: number, r: any) => s + (r.sp_allocated_cost || 0), 0))}</td>
                            <td className="px-4 py-3 text-sm font-bold font-mono text-red-600">{fmt(allSpResources.reduce((s: number, r: any) => s + (r.uncovered_cost || 0), 0))}</td>
                            <td className="px-4 py-3 text-sm font-bold font-mono text-blue-900">{fmt(allSpResources.reduce((s: number, r: any) => s + (r.true_cost || 0), 0))}</td>
                            <td className="px-4 py-3 text-sm font-bold font-mono text-green-700">{fmt(allSpResources.reduce((s: number, r: any) => s + (r.savings || 0), 0))}</td>
                            <td className="px-4 py-3" />
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </>
            ) : (
              <>
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
                            Total {fmt(spDist.total_sp_fee)} - distributed to sub-accounts below based on SP usage
                          </span>
                        </div>
                      </div>
                    )}
                <table className="w-full mt-2">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {["Account", "Account ID", "Usage Cost", "SP Allocated", "Actual Cost", "Savings", "Savings %", "SP Resources"].map((h) => (
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
                          <td className="px-5 py-3 text-sm font-mono font-semibold text-black">{fmt(acc.usage_cost)}</td>
                          <td className="px-5 py-3">
                            {acc.is_payer ? (
                              <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded">
                                -{fmt(acc.sp_fee_distributed)} distributed
                              </span>
                            ) : acc.sp_allocated > 0 ? (
                              <div>
                                <span className="text-sm font-bold font-mono text-orange-700">+{fmt(acc.sp_allocated)}</span>
                                <div className="text-[10px] text-gray-500">{acc.sp_share_pct}% of SP pool</div>
                              </div>
                            ) : <span className="text-xs text-gray-400">-</span>}
                          </td>
                          <td className="px-5 py-3">
                            <span className="text-sm font-bold font-mono text-blue-900">{fmt(acc.true_cost)}</span>
                          </td>
                          <td className="px-5 py-3">
                            {!acc.is_payer && acc.savings > 0
                              ? <span className="text-sm font-bold font-mono text-green-700">{fmt(acc.savings)}</span>
                              : <span className="text-xs text-gray-400">-</span>}
                          </td>
                          <td className="px-5 py-3">
                            {!acc.is_payer && acc.savings_pct > 0 ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(acc.savings_pct, 100)}%` }} />
                                </div>
                                <span className="text-xs font-bold text-green-700">{acc.savings_pct}%</span>
                              </div>
                            ) : <span className="text-xs text-gray-400">-</span>}
                          </td>
                          <td className="px-5 py-3 text-sm font-semibold text-black">
                            {!acc.is_payer && acc.sp_resources > 0 ? (
                              <button
                                onClick={() => openSpResources(acc.aws_account_id, acc.account_name)}
                                className="flex items-center gap-1.5 text-xs font-bold text-blue-900 hover:underline">
                                {acc.sp_resources.toLocaleString()} resources
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            ) : "-"}
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
            </>
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
                      const headers = ["Service", "Usage Cost (USD)", "Actual Cost (USD)"];
                      const rows = (tabData as any[]).map((r: any) => [r.service || "-", r.usage_cost?.toFixed(2) || "0", r.actual_cost?.toFixed(2) || "0"]);
                      downloadCSV(`service-wise-${ct?.name}-${startDate}-${endDate}.csv`, [headers, ...rows]);
                    } else if (activeTab === "resource") {
                      const headers = ["Resource ID", "Resource Name", "Description", "Attachment", "Service", "Region", "Usage Cost (USD)", "True Cost incl SP (USD)"];
                      const rows = (tabData as any[]).map((r: any) => {
                        const { desc, attachment } = getResourceDescription(r);
                        return [r.resource_id || "-", r.resource_name || "-", desc || "-", attachment || "-", r.service || "-", r.region || "-", r.usage_cost?.toFixed(2) || "0", r.actual_cost?.toFixed(2) || "0"];
                      });
                      downloadCSV(`resource-wise-${ct?.name}-${startDate}-${endDate}.csv`, [headers, ...rows]);
                    } else {
                      const headers = ["Tag Key", "Tag Value", "Usage Cost (USD)", "Actual Cost (USD)"];
                      const rows = (tabData as any[]).map((r: any) => [r.tag_key || "-", r.tag_value || "(untagged)", r.usage_cost?.toFixed(2) || "0", r.actual_cost?.toFixed(2) || "0"]);
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
                  {tabData.length > 0 && (
                    <div className="mb-5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-black mb-3">
                        Cumulative Cost - {TABS.find(t => t.value === activeTab)?.label}
                      </h3>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart
                          data={tabData.slice(0, 15).map((r: any) => ({
                            name: (r.service || r.resource_id || r.tag_value || "-").slice(0, 20),
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
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        {activeTab === "service" && (
                          <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Service</th>
                        )}
                        {activeTab === "resource" && (
                          <>
                            <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Resource ID</th>
                            <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Resource Name</th>
                            <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Description</th>
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
                        <th className="text-right text-xs font-bold uppercase tracking-wider text-black px-4 py-2">Usage Cost</th>
                        <th className="text-right text-xs font-bold uppercase tracking-wider text-black px-4 py-2">{activeTab === "resource" ? "True Cost (incl. SP)" : "Actual Cost"}</th>
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
                              <td className="px-4 py-2.5 text-xs font-mono font-semibold text-black max-w-[160px] truncate">{row.resource_id}</td>
                              <td className="px-4 py-2.5 text-xs text-blue-700 font-semibold max-w-[140px] truncate">{row.resource_name || <span className="text-gray-300">—</span>}</td>
                              <td className="px-4 py-2.5 text-xs text-black max-w-[180px]">
                                {(() => { const { desc, attachment } = getResourceDescription(row); return (<>
                                  {desc && <span className="font-semibold text-slate-700 block">{desc}</span>}
                                  {attachment && <span className="text-amber-700 font-medium block truncate" title={attachment}>{attachment}</span>}
                                  {!desc && !attachment && <span className="text-gray-300">—</span>}
                                </>); })()}
                              </td>
                              <td className="px-4 py-2.5 text-xs font-semibold text-black">{row.service}</td>
                              <td className="px-4 py-2.5 text-xs text-black">{row.region || "-"}</td>
                            </>
                          )}
                          {activeTab === "tag" && (
                            <>
                              <td className="px-4 py-2.5 text-sm font-semibold text-black">{row.tag_key}</td>
                              <td className="px-4 py-2.5 text-sm text-black">{row.tag_value || "(untagged)"}</td>
                            </>
                          )}
                          <td className="px-4 py-2.5 text-right text-sm font-mono text-gray-500">
                            {fmt(row.usage_cost ?? row.cost)}
                          </td>
                          <td className={`px-4 py-2.5 text-right text-sm font-bold font-mono ${
                            row.has_sp ? "text-orange-700 bg-orange-50" : "text-blue-900"
                          }`}>
                            {fmt(row.actual_cost ?? row.cost)}
                            {row.has_sp && <div className="text-[10px] font-normal text-orange-500">incl. SP</div>}
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
                  SP Covered Resources - {spResourceModal.accountName}
                </h3>
                <p className="text-[10px] text-gray-500 mt-0.5 font-mono">{spResourceModal.accountId} - {startDate} to {endDate}</p>
              </div>
              <button onClick={() => setSpResourceModal(null)} className="p-1.5 rounded hover:bg-gray-100 transition">
                <span className="text-black font-bold text-sm">x</span>
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
                        <td className="px-4 py-2.5 text-xs text-black">{r.region || "-"}</td>
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

