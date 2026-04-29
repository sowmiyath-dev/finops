"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import toast from "react-hot-toast";
import { Download, Filter, RefreshCw, X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";

const COLORS = ["#7c3aed","#06b6d4","#10b981","#f59e0b","#f43f5e","#a855f7","#22d3ee","#34d399","#fb923c","#38bdf8"];

const METRICS = [
  { value: "unblended_cost", label: "Unblended Cost" },
  { value: "blended_cost", label: "Blended Cost" },
  { value: "net_unblended_cost", label: "Net Unblended Cost" },
  { value: "amortized_cost", label: "Amortized Cost" },
];

const GROUP_BY = [
  { value: "account", label: "Account-wise" },
  { value: "service", label: "Service-wise" },
  { value: "resource", label: "Resource-wise" },
  { value: "tag", label: "Tag-wise" },
];

function MultiSelect({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
      <div className="max-h-36 overflow-y-auto border border-slate-700 rounded-lg bg-slate-900 p-2 space-y-1">
        {options.length === 0 && <p className="text-xs text-slate-500 px-1">No options</p>}
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2 px-1 py-0.5 hover:bg-[#7c3aed]/10 rounded cursor-pointer">
            <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)}
              className="accent-[#7c3aed] w-3 h-3" />
            <span className="text-xs text-slate-300 truncate">{o}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((s) => (
            <span key={s} className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-[#7c3aed]/20 text-[#c084fc] border border-[#7c3aed]/30 rounded-full">
              {s.length > 20 ? s.slice(0, 20) + "…" : s}
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
  });

  const { data: towers = [] } = useQuery({
    queryKey: ["towers"],
    queryFn: () => api.get("/towers/").then((r) => r.data),
    enabled: !!token,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["meta-services"],
    queryFn: () => api.get("/reports/meta/services").then((r) => r.data),
    enabled: !!token,
  });

  const { data: regions = [] } = useQuery({
    queryKey: ["meta-regions"],
    queryFn: () => api.get("/reports/meta/regions").then((r) => r.data),
    enabled: !!token,
  });

  const { data: tagKeys = [] } = useQuery({
    queryKey: ["tag-keys"],
    queryFn: () => api.get("/reports/meta/tag-keys").then((r) => r.data),
    enabled: !!token,
  });

  // All sub-accounts across all towers
  const allAccounts = towers.flatMap((t: any) =>
    (t.sub_accounts || []).map((s: any) => ({ ...s, ct_name: t.name, ct_id: t.id }))
  );

  const defaultEnd = boundary?.accurate_until || new Date().toISOString().slice(0, 10);
  const defaultStart = (() => {
    const d = new Date(defaultEnd);
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  })();

  // Filters state
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [selectedCTs, setSelectedCTs] = useState<string[]>(params.get("ct") ? [params.get("ct")!] : []);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedPurchaseTypes, setSelectedPurchaseTypes] = useState<string[]>([]);
  const [metric, setMetric] = useState("unblended_cost");
  const [groupBy, setGroupBy] = useState("account");
  const [granularity, setGranularity] = useState("daily");
  const [tagKey, setTagKey] = useState("");
  const [tagValue, setTagValue] = useState("");
  const [quickRange, setQuickRange] = useState("30d");
  const [exporting, setExporting] = useState(false);

  // Update dates when boundary loads
  useEffect(() => {
    if (boundary) {
      setEndDate(boundary.accurate_until);
      applyQuickRange(quickRange, boundary.accurate_until);
    }
  }, [boundary]);

  const applyQuickRange = (range: string, end: string) => {
    const d = new Date(end);
    const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 30;
    d.setDate(d.getDate() - days + 1);
    setStartDate(d.toISOString().slice(0, 10));
    setQuickRange(range);
  };

  const buildFilter = () => ({
    control_tower_ids: selectedCTs.length ? selectedCTs : null,
    account_ids: selectedAccounts.length ? selectedAccounts : null,
    services: selectedServices.length ? selectedServices : null,
    regions: selectedRegions.length ? selectedRegions : null,
    purchase_types: selectedPurchaseTypes.length ? selectedPurchaseTypes : null,
    tag_key: tagKey || null,
    tag_value: tagValue || null,
    start_date: startDate,
    end_date: endDate,
    granularity,
    metric,
    group_by: groupBy,
  });

  const [filterKey, setFilterKey] = useState(0);
  const [activeFilter, setActiveFilter] = useState<any>(null);

  const applyFilters = () => {
    setActiveFilter(buildFilter());
    setFilterKey((k) => k + 1);
  };

  const resetFilters = () => {
    setSelectedCTs([]);
    setSelectedAccounts([]);
    setSelectedServices([]);
    setSelectedRegions([]);
    setSelectedPurchaseTypes([]);
    setTagKey("");
    setTagValue("");
    setMetric("unblended_cost");
    setGroupBy("account");
    setGranularity("daily");
    if (boundary) applyQuickRange("30d", boundary.accurate_until);
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

  const inputCls = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#7c3aed] transition";

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-10">

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-1">Cost Reports</h1>
            <p className="text-[#94a3c4] text-sm">
              {boundary && <>Data accurate up to <strong className="text-white">{boundary.accurate_until}</strong> · Daily sync at 10:30 AM UTC</>}
            </p>
          </div>
          <button onClick={handleExport} disabled={exporting || !activeFilter}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition">
            <Download className="w-4 h-4" />
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* ── Filter Panel ── */}
          <div className="lg:col-span-1 space-y-4">
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Filter className="w-4 h-4 text-[#c084fc]" /> Filters
                </div>
                <button onClick={resetFilters} className="text-xs text-slate-500 hover:text-slate-300 transition">Reset</button>
              </div>

              {/* Quick range */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Quick Range</label>
                <div className="flex gap-1">
                  {["7d","30d","90d"].map((r) => (
                    <button key={r} onClick={() => boundary && applyQuickRange(r, boundary.accurate_until)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition ${quickRange === r ? "bg-[#7c3aed]/20 text-[#c084fc] border-[#7c3aed]/40" : "text-slate-400 border-slate-700 hover:border-slate-500"}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Start Date</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">End Date</label>
                  <input type="date" value={endDate} max={boundary?.accurate_until} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                </div>
              </div>

              {/* Group by */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Group By</label>
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={inputCls}>
                  {GROUP_BY.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>

              {/* Metric */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Cost Metric</label>
                <select value={metric} onChange={(e) => setMetric(e.target.value)} className={inputCls}>
                  {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>

              {/* Granularity */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Granularity</label>
                <div className="flex gap-1">
                  {["daily","monthly"].map((g) => (
                    <button key={g} onClick={() => setGranularity(g)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition capitalize ${granularity === g ? "bg-[#7c3aed]/20 text-[#c084fc] border-[#7c3aed]/40" : "text-slate-400 border-slate-700 hover:border-slate-500"}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Control Towers */}
              <MultiSelect
                label="Control Towers"
                options={towers.map((t: any) => t.id)}
                selected={selectedCTs}
                onChange={setSelectedCTs}
              />

              {/* Accounts */}
              <MultiSelect
                label="Accounts"
                options={allAccounts.map((a: any) => a.aws_account_id)}
                selected={selectedAccounts}
                onChange={setSelectedAccounts}
              />

              {/* Services */}
              <MultiSelect label="Services" options={services} selected={selectedServices} onChange={setSelectedServices} />

              {/* Regions */}
              <MultiSelect label="Regions" options={regions} selected={selectedRegions} onChange={setSelectedRegions} />

              {/* Purchase types */}
              <MultiSelect
                label="Purchase Types"
                options={["OnDemand", "Reserved", "SavingsPlan", "Spot"]}
                selected={selectedPurchaseTypes}
                onChange={setSelectedPurchaseTypes}
              />

              {/* Tag filter */}
              {groupBy === "tag" && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Tag Key</label>
                    <select value={tagKey} onChange={(e) => setTagKey(e.target.value)} className={inputCls}>
                      <option value="">Select tag key</option>
                      {tagKeys.map((k: string) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Tag Value (optional)</label>
                    <input value={tagValue} onChange={(e) => setTagValue(e.target.value)} className={inputCls} placeholder="e.g. production" />
                  </div>
                </div>
              )}

              <button onClick={applyFilters}
                className="w-full py-2.5 bg-[#7c3aed] hover:bg-[#6d28d9] text-white rounded-lg font-semibold text-sm transition flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4" /> Apply Filters
              </button>
            </div>
          </div>

          {/* ── Results Panel ── */}
          <div className="lg:col-span-3 space-y-6">

            {!activeFilter && (
              <div className="card p-12 text-center">
                <Filter className="w-10 h-10 text-[#4a5578] mx-auto mb-3" />
                <p className="text-slate-400">Configure your filters and click <strong className="text-white">Apply Filters</strong> to generate a report.</p>
              </div>
            )}

            {activeFilter && isLoading && (
              <div className="card p-12 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {activeFilter && !isLoading && (
              <>
                {/* Summary row */}
                {summaryData && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="card p-4">
                      <div className="text-xs text-slate-400 mb-1">Total Cost</div>
                      <div className="text-xl font-bold text-[#22d3ee]">
                        ${(summaryData.total_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="card p-4">
                      <div className="text-xs text-slate-400 mb-1">Top Service</div>
                      <div className="text-sm font-bold text-[#c084fc] truncate">{summaryData.top_services?.[0]?.service || "—"}</div>
                      <div className="text-xs text-slate-500">${(summaryData.top_services?.[0]?.cost || 0).toFixed(2)}</div>
                    </div>
                    <div className="card p-4">
                      <div className="text-xs text-slate-400 mb-1">Records</div>
                      <div className="text-xl font-bold text-emerald-400">{reportData.length.toLocaleString()}</div>
                    </div>
                  </div>
                )}

                {/* Chart */}
                {summaryData?.daily_trend?.length > 0 && (
                  <div className="card p-6">
                    <h3 className="text-sm font-semibold text-white mb-4">Daily Cost Trend</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={summaryData.daily_trend}>
                        <XAxis dataKey="date" tick={{ fill: "#4a5578", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fill: "#4a5578", fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                        <Tooltip contentStyle={{ background: "#0d1424", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 8 }}
                          formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Cost"]} />
                        <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                          {summaryData.daily_trend.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Data table */}
                <div className="card overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between">
                    <span className="text-sm font-semibold text-white capitalize">{groupBy}-wise Cost Breakdown</span>
                    <span className="text-xs text-slate-400">{reportData.length} rows</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-800">
                          {groupBy === "account" && <><th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase">Account</th><th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase">Account ID</th></>}
                          {groupBy === "service" && <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase">Service</th>}
                          {groupBy === "resource" && <><th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase">Resource ID</th><th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase">Service</th></>}
                          {groupBy === "tag" && <><th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase">Tag Key</th><th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase">Tag Value</th></>}
                          {granularity === "daily" && <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase">Date</th>}
                          <th className="text-right px-5 py-3 text-xs font-medium text-slate-400 uppercase">Cost (USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.slice(0, 200).map((row: any, i: number) => (
                          <tr key={i} className="border-b border-slate-800/50 hover:bg-[#7c3aed]/5 transition text-sm">
                            {groupBy === "account" && <><td className="px-5 py-3 text-white">{row.account_name || "—"}</td><td className="px-5 py-3 font-mono text-xs text-slate-400">{row.aws_account_id}</td></>}
                            {groupBy === "service" && <td className="px-5 py-3 text-white">{row.service}</td>}
                            {groupBy === "resource" && <><td className="px-5 py-3 font-mono text-xs text-slate-300 max-w-xs truncate">{row.resource_id}</td><td className="px-5 py-3 text-slate-400">{row.service}</td></>}
                            {groupBy === "tag" && <><td className="px-5 py-3 text-slate-400">{row.tag_key}</td><td className="px-5 py-3 text-white">{row.tag_value || "(untagged)"}</td></>}
                            {granularity === "daily" && <td className="px-5 py-3 text-slate-400 text-xs">{row.date}</td>}
                            <td className="px-5 py-3 text-right font-mono font-semibold text-[#22d3ee]">
                              ${row.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {reportData.length > 200 && (
                      <div className="px-5 py-3 text-xs text-slate-500 border-t border-slate-800">
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
    <Suspense fallback={<div className="min-h-screen bg-[#080d1a] flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin" /></div>}>
      <ReportsContent />
    </Suspense>
  );
}
