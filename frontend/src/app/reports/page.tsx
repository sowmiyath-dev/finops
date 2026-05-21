"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import toast from "react-hot-toast";
import { Download, Filter, RefreshCw, X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9","#27ae60","#e67e22","#16a085"];

const METRICS = [
  { value: "unblended_cost",     label: "Unblended Cost" },
  { value: "blended_cost",       label: "Blended Cost" },
  { value: "net_unblended_cost", label: "Net Unblended Cost" },
  { value: "amortized_cost",     label: "Amortized Cost" },
];

const GROUP_BY = [
  { value: "account",  label: "Account-wise" },
  { value: "service",  label: "Service-wise" },
  { value: "resource", label: "Resource-wise" },
  { value: "tag",      label: "Tag-wise" },
];

const inputCls = "w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-900 focus:ring-2 focus:ring-blue-100 transition";
const labelCls = "block text-xs font-bold mb-1.5 uppercase tracking-wide text-black";

function MultiSelect({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="max-h-36 overflow-y-auto rounded-md border border-gray-400 p-2 space-y-0.5 bg-white">
        {options.length === 0 && <p className="text-xs px-1 py-1 text-black">No options</p>}
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-blue-50 transition"
            style={{ fontSize: "12px" }}>
            <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)}
              className="w-3 h-3 rounded accent-blue-900" />
            <span className="truncate text-black font-medium">
              {o.length > 24 ? o.slice(0, 24) + "…" : o}
            </span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((s) => (
            <span key={s} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-blue-900 bg-blue-100 text-blue-900 font-semibold">
              {s.length > 18 ? s.slice(0, 18) + "…" : s}
              <button onClick={() => toggle(s)}><X className="w-2.5 h-2.5" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportsContent() {
  const params = useSearchParams();
  const { token } = useAuthStore();
  const router = useRouter();

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

  const { data: services = [] } = useQuery({
    queryKey: ["meta-services"],
    queryFn: () => api.get("/reports/meta/services").then((r) => r.data),
    enabled: !!token,
    staleTime: 30 * 60 * 1000, // fresh for 30 minutes
  });

  const { data: regions = [] } = useQuery({
    queryKey: ["meta-regions"],
    queryFn: () => api.get("/reports/meta/regions").then((r) => r.data),
    enabled: !!token,
    staleTime: 30 * 60 * 1000,
  });

  const { data: tagKeys = [] } = useQuery({
    queryKey: ["tag-keys"],
    queryFn: () => api.get("/reports/meta/tag-keys").then((r) => r.data),
    enabled: !!token,
    staleTime: 30 * 60 * 1000,
  });

  const { data: chargeTypes = [] } = useQuery({
    queryKey: ["charge-types"],
    queryFn: () => api.get("/reports/meta/charge-types").then((r) => r.data),
    enabled: !!token,
    staleTime: 30 * 60 * 1000,
  });

  const allAccounts = towers.flatMap((t: any) =>
    (t.sub_accounts || []).map((s: any) => ({ ...s, ct_name: t.name }))
  );

  const defaultStart = (() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
  })();
  const defaultEndLastMonth = (() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), 0);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEndLastMonth);
  const [selectedCTs, setSelectedCTs] = useState<string[]>(params.get("ct") ? [params.get("ct")!] : []);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedPurchaseTypes, setSelectedPurchaseTypes] = useState<string[]>([]);
  const DEFAULT_CHARGE_TYPES = [
    "Usage",
    "SavingsPlanCoveredUsage",
    "SavingsPlanRecurringFee",
    "SavingsPlanNegation",
    "RIFee",
    "DiscountedUsage",
  ];

  const [selectedChargeTypes, setSelectedChargeTypes] = useState<string[]>(DEFAULT_CHARGE_TYPES);
  const [marketplaceOnly, setMarketplaceOnly] = useState<string>("all");
  const [metric, setMetric] = useState("unblended_cost");
  const [groupBy, setGroupBy] = useState("account");
  const [granularity, setGranularity] = useState("daily");
  const [tagKey, setTagKey] = useState("");
  const [tagValue, setTagValue] = useState("");
  const [quickRange, setQuickRange] = useState("last-month");
  const [exporting, setExporting] = useState(false);
  const [filterKey, setFilterKey] = useState(0);
  const [activeFilter, setActiveFilter] = useState<any>(null);

  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const applyQuickRange = (range: string) => {
    const now = new Date();
    const accurate = boundary?.accurate_until || fmtDate(now);
    if (range === "this-month") {
      setStartDate(fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setEndDate(accurate);
    } else if (range === "last-month") {
      setStartDate(fmtDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setEndDate(fmtDate(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else if (range === "7d") {
      const e = new Date(accurate);
      const s = new Date(e); s.setDate(s.getDate() - 6);
      setStartDate(fmtDate(s)); setEndDate(accurate);
    } else if (range === "30d") {
      const e = new Date(accurate);
      const s = new Date(e); s.setDate(s.getDate() - 29);
      setStartDate(fmtDate(s)); setEndDate(accurate);
    } else if (range === "90d") {
      const e = new Date(accurate);
      const s = new Date(e); s.setDate(s.getDate() - 89);
      setStartDate(fmtDate(s)); setEndDate(accurate);
    }
    setQuickRange(range);
  };

  const buildFilter = () => ({
    control_tower_ids: selectedCTs.length
      ? towers.filter((t: any) => selectedCTs.includes(t.name)).map((t: any) => t.id)
      : null,
    account_ids: selectedAccounts.length
      ? selectedAccounts.map((a) => a.match(/\(([0-9]{12})\)/)?.[1] || a)
      : null,
    services: selectedServices.length ? selectedServices : null,
    regions: selectedRegions.length ? selectedRegions : null,
    purchase_types: selectedPurchaseTypes.length ? selectedPurchaseTypes : null,
    charge_types: selectedChargeTypes.length ? selectedChargeTypes : null,
    marketplace_only: marketplaceOnly === "yes" ? true : marketplaceOnly === "no" ? false : null,
    tag_key: tagKey || null,
    tag_value: tagValue || null,
    start_date: startDate,
    end_date: endDate,
    granularity,
    metric,
    group_by: groupBy,
  });

  const applyFilters = () => { setActiveFilter(buildFilter()); setFilterKey((k) => k + 1); };

  const resetFilters = () => {
    setSelectedCTs([]); setSelectedAccounts([]); setSelectedServices([]);
    setSelectedRegions([]); setSelectedPurchaseTypes([]); setSelectedChargeTypes(DEFAULT_CHARGE_TYPES); setMarketplaceOnly("all");
    setTagKey(""); setTagValue("");
    setMetric("unblended_cost"); setGroupBy("account"); setGranularity("daily");
    applyQuickRange("last-month");
  };

  const endpoint = groupBy === "account" ? "/reports/account-wise"
    : groupBy === "service" ? "/reports/service-wise"
    : groupBy === "resource" ? "/reports/resource-wise"
    : "/reports/tag-wise";

  const { data: reportData = [], isLoading } = useQuery({
    queryKey: ["report", filterKey, activeFilter],
    queryFn: () => api.post(endpoint, activeFilter).then((r) => r.data),
    enabled: !!token && !!activeFilter,
  });

  const { data: summaryData } = useQuery({
    queryKey: ["report-summary", filterKey, activeFilter],
    queryFn: () => api.post("/reports/summary", activeFilter).then((r) => r.data),
    enabled: !!token && !!activeFilter,
  });

  const handleExport = async () => {
    if (!activeFilter) { toast.error("Apply filters first"); return; }
    setExporting(true);
    try {
      const res = await api.post("/reports/export/csv", activeFilter, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `finops_cost_${startDate}_${endDate}_${groupBy}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch { toast.error("Export failed"); }
    finally { setExporting(false); }
  };

  const qBtnCls = (active: boolean) =>
    `flex-1 py-1.5 text-xs font-bold rounded-md border transition ${
      active
        ? "bg-blue-900 text-white border-blue-900"
        : "bg-white text-black border-gray-400 hover:border-blue-900 hover:text-blue-900"
    }`;

  return (
    <div className="min-h-screen" style={{ background: "#f1f4f9" }}>
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-black">Cost Reports</h1>
            <p className="text-sm mt-0.5 text-black">
              {boundary && <>Last synced up to <strong>{boundary.accurate_until}</strong> · Daily sync at 10:30 AM IST</>}
            </p>
          </div>
          <button onClick={handleExport} disabled={exporting || !activeFilter}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-md transition disabled:opacity-40 bg-green-800 hover:bg-green-900">
            <Download className="w-4 h-4" />
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>

        {/* Boundary notice removed */}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* Filter Panel */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 space-y-4 sticky top-20">
              <div className="flex items-center justify-between pb-3 border-b border-gray-300">
                <div className="flex items-center gap-2 text-sm font-bold text-black">
                  <Filter className="w-4 h-4 text-blue-900" /> Filters
                </div>
                <button onClick={resetFilters} className="text-xs font-bold text-black hover:text-red-700 transition">
                  Reset all
                </button>
              </div>

              {/* Quick range */}
              <div>
                <label className={labelCls}>Quick Range</label>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    { label: "This Month", value: "this-month" },
                    { label: "Last Month", value: "last-month" },
                    { label: "Last 7d",    value: "7d" },
                    { label: "Last 30d",   value: "30d" },
                  ].map((r) => (
                    <button key={r.value} onClick={() => applyQuickRange(r.value)}
                      className={qBtnCls(quickRange === r.value)}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Start</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>End</label>
                  <input type="date" value={endDate} max={boundary?.accurate_until} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                </div>
              </div>

              {/* Group by */}
              <div>
                <label className={labelCls}>Group By</label>
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={inputCls}>
                  {GROUP_BY.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>

              {/* Metric */}
              <div>
                <label className={labelCls}>Cost Metric</label>
                <select value={metric} onChange={(e) => setMetric(e.target.value)} className={inputCls}>
                  {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>

              {/* Granularity */}
              <div>
                <label className={labelCls}>Granularity</label>
                <div className="flex gap-1">
                  {["daily", "monthly"].map((g) => (
                    <button key={g} onClick={() => setGranularity(g)}
                      className={`${qBtnCls(granularity === g)} capitalize`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <MultiSelect label="Control Towers" options={towers.map((t: any) => t.name)} selected={selectedCTs} onChange={setSelectedCTs} />
              <MultiSelect label="Accounts" options={allAccounts.map((a: any) => `${a.account_name} (${a.aws_account_id})`)} selected={selectedAccounts} onChange={setSelectedAccounts} />
              <MultiSelect label="Services" options={services} selected={selectedServices} onChange={setSelectedServices} />
              <MultiSelect label="Regions" options={regions} selected={selectedRegions} onChange={setSelectedRegions} />
              <MultiSelect label="Purchase Types" options={["OnDemand", "Reserved", "SavingsPlan", "Spot"]} selected={selectedPurchaseTypes} onChange={setSelectedPurchaseTypes} />

              {/* Charge Type — with friendly names and smart defaults */}
              <div>
                <label className={labelCls}>Charge Types</label>
                <div className="space-y-1 border border-gray-400 rounded-md p-2 bg-white max-h-48 overflow-y-auto">
                  {[
                    { value: "Usage",                    label: "Usage",                  default: true },
                    { value: "SavingsPlanCoveredUsage",  label: "Savings Plan Usage",     default: true },
                    { value: "SavingsPlanRecurringFee",  label: "Savings Plan Fee",       default: true },
                    { value: "SavingsPlanNegation",      label: "Savings Plan Negation",  default: true },
                    { value: "RIFee",                    label: "Reserved Instance Fee",  default: true },
                    { value: "DiscountedUsage",          label: "Discounted Usage",       default: true },
                    { value: "Tax",                      label: "Tax",                    default: false },
                    { value: "DistributorDiscount",      label: "Distributor Discount",   default: false },
                    { value: "Credit",                   label: "Credit",                 default: false },
                    { value: "Refund",                   label: "Refund",                 default: false },
                    { value: "OCBLateFee",               label: "Late Fee (OCB)",         default: false },
                    { value: "Fee",                      label: "Fee",                    default: false },
                    { value: "BundledDiscount",          label: "Bundled Discount",       default: false },
                  ].map((ct) => (
                    <label key={ct.value} className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-blue-50 transition">
                      <input
                        type="checkbox"
                        checked={selectedChargeTypes.includes(ct.value)}
                        onChange={() => {
                          setSelectedChargeTypes((prev) =>
                            prev.includes(ct.value)
                              ? prev.filter((x) => x !== ct.value)
                              : [...prev, ct.value]
                          );
                        }}
                        className="w-3 h-3 accent-blue-900"
                      />
                      <span className="text-xs font-medium text-black">{ct.label}</span>
                      {!ct.default && (
                        <span className="text-[10px] text-gray-400 ml-auto">excluded</span>
                      )}
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Tax &amp; discounts excluded by default</p>
              </div>

              {/* Marketplace */}
              <div>
                <label className={labelCls}>Marketplace</label>
                <div className="flex gap-1">
                  {(["all", "yes", "no"] as const).map((v) => (
                    <button key={v} onClick={() => setMarketplaceOnly(v)}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-md border transition capitalize ${
                        marketplaceOnly === v
                          ? "bg-blue-900 text-white border-blue-900"
                          : "bg-white text-black border-gray-400 hover:border-blue-900 hover:text-blue-900"
                      }`}>
                      {v === "all" ? "All" : v === "yes" ? "Only" : "Exclude"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-black mt-1">AWS Marketplace charges</p>
              </div>

              {groupBy === "tag" && (
                <div className="space-y-2">
                  <div>
                    <label className={labelCls}>Tag Key</label>
                    <select value={tagKey} onChange={(e) => setTagKey(e.target.value)} className={inputCls}>
                      <option value="">Select tag key</option>
                      {tagKeys.map((k: string) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Tag Value</label>
                    <input value={tagValue} onChange={(e) => setTagValue(e.target.value)} className={inputCls} placeholder="e.g. production" />
                  </div>
                </div>
              )}

              <button onClick={applyFilters}
                className="w-full py-2.5 text-sm font-bold text-white rounded-md transition flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800">
                <RefreshCw className="w-4 h-4" /> Apply Filters
              </button>
            </div>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-3 space-y-5">

            {!activeFilter && (
              <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
                <Filter className="w-10 h-10 mx-auto mb-3 text-black" />
                <p className="text-sm text-black font-medium">
                  Configure your filters and click <strong>Apply Filters</strong> to generate a report.
                </p>
              </div>
            )}

            {activeFilter && isLoading && (
              <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin border-blue-900" />
              </div>
            )}

            {activeFilter && !isLoading && (
              <>
                {/* Summary cards */}
                {summaryData && (
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      {
                        label: "Total Cost",
                        value: `$${(summaryData.total_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                        sub: `${startDate} → ${endDate}`,
                        color: "#0f2d5e",
                      },
                      {
                        label: "Top Service",
                        value: summaryData.top_services?.[0]?.service || "—",
                        sub: `$${(summaryData.top_services?.[0]?.cost || 0).toFixed(2)}`,
                        color: "#ec7211",
                      },
                      {
                        label: "Records",
                        value: reportData.length.toLocaleString(),
                        sub: "matching rows",
                        color: "#1d8348",
                      },
                    ].map((card) => (
                      <div key={card.label} className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
                        <div className="text-xs font-bold uppercase tracking-wide text-black mb-1">{card.label}</div>
                        <div className="text-2xl font-bold truncate" style={{ color: card.color }}>{card.value}</div>
                        <div className="text-xs font-semibold text-black mt-1">{card.sub}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Chart */}
                {summaryData?.daily_trend?.length > 0 && (
                  <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
                    <h3 className="text-sm font-bold text-black mb-4">Daily Cost Trend</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={summaryData.daily_trend}>
                        <XAxis dataKey="date" tick={{ fill: "#000000", fontSize: 10, fontWeight: 600 }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fill: "#000000", fontSize: 10, fontWeight: 600 }} tickFormatter={(v) => `$${v}`} />
                        <Tooltip
                          contentStyle={{ background: "white", border: "1px solid #374151", borderRadius: 6 }}
                          labelStyle={{ color: "#000000", fontWeight: 700 }}
                          formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Cost"]}
                        />
                        <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                          {summaryData.daily_trend.map((_: any, i: number) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Data table */}
                <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 flex items-center justify-between bg-gray-100 border-b border-gray-300">
                    <span className="text-sm font-bold text-black capitalize">{groupBy}-wise Cost Breakdown</span>
                    <span className="text-xs font-bold text-black">{reportData.length} rows</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-100 border-b-2 border-gray-300">
                          {groupBy === "account" && (
                            <>
                              <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Account</th>
                              <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Account ID</th>
                            </>
                          )}
                          {groupBy === "service" && <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Service</th>}
                          {groupBy === "resource" && (
                            <>
                              <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Resource ID</th>
                              <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Service</th>
                              <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Account</th>
                              <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Region</th>
                            </>
                          )}
                          {groupBy === "tag" && (
                            <>
                              <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Tag Key</th>
                              <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Tag Value</th>
                            </>
                          )}
                          {granularity === "daily" && <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Date</th>}
                          <th className="text-right px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">Cost (USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.slice(0, 200).map((row: any, i: number) => (
                          <tr key={i} className="border-b border-gray-200 hover:bg-blue-50 transition">
                            {groupBy === "account" && (
                              <>
                                <td className="px-5 py-3 text-sm font-semibold text-black">{row.account_name || "—"}</td>
                                <td className="px-5 py-3 text-xs font-mono font-semibold text-black">{row.aws_account_id}</td>
                              </>
                            )}
                            {groupBy === "service" && (
                              <td className="px-5 py-3 text-sm font-semibold text-black">{row.service}</td>
                            )}
                            {groupBy === "resource" && (
                              <>
                                <td className="px-5 py-3 text-xs font-mono font-semibold text-black max-w-xs truncate">{row.resource_id}</td>
                                <td className="px-5 py-3 text-sm font-semibold text-black">{row.service}</td>
                                <td className="px-5 py-3 text-xs font-semibold text-black">{row.account_name || row.aws_account_id}</td>
                                <td className="px-5 py-3 text-xs font-semibold text-black">{row.region || "—"}</td>
                              </>
                            )}
                            {groupBy === "tag" && (
                              <>
                                <td className="px-5 py-3 text-sm font-semibold text-black">{row.tag_key}</td>
                                <td className="px-5 py-3 text-sm font-semibold text-black">{row.tag_value || "(untagged)"}</td>
                              </>
                            )}
                            {granularity === "daily" && (
                              <td className="px-5 py-3 text-xs font-mono font-semibold text-black">{row.date}</td>
                            )}
                            <td className="px-5 py-3 text-right text-sm font-bold font-mono text-blue-900">
                              ${row.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {reportData.length > 200 && (
                      <div className="px-5 py-3 text-xs font-semibold text-black border-t border-gray-300">
                        Showing 200 of {reportData.length} rows. Export CSV to get all data.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f1f4f9" }}>
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin border-blue-900" />
      </div>
    }>
      <ReportsContent />
    </Suspense>
  );
}
