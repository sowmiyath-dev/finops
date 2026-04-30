"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import toast from "react-hot-toast";
import { Download, Filter, RefreshCw, X, AlertCircle } from "lucide-react";
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

const inputCls = "w-full border rounded-md px-3 py-2 text-sm focus:outline-none transition bg-white text-gray-800 border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
const labelCls = "block text-xs font-semibold mb-1.5 uppercase tracking-wide text-gray-700";

function MultiSelect({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="max-h-36 overflow-y-auto rounded-md border p-2 space-y-0.5"
        style={{ borderColor: "#d1d9e6", background: "#fafbfc" }}>
        {options.length === 0 && (
          <p className="text-xs px-1 py-1 text-gray-500">No options</p>
        )}
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer transition hover:bg-blue-50"
            style={{ fontSize: "12px" }}>
            <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)}
              className="w-3 h-3 rounded" style={{ accentColor: "var(--primary)" }} />
            <span className="truncate text-gray-800">
              {o.length > 24 ? o.slice(0, 24) + "…" : o}
            </span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((s) => (
            <span key={s} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
              style={{ background: "#e8f0fe", color: "#0f2d5e", borderColor: "#c5d5f0" }}>
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

  const allAccounts = towers.flatMap((t: any) =>
    (t.sub_accounts || []).map((s: any) => ({ ...s, ct_name: t.name }))
  );

  const defaultEnd = boundary?.accurate_until || new Date().toISOString().slice(0, 10);
  const defaultStart = (() => {
    const d = new Date(defaultEnd);
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  })();

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
  const [filterKey, setFilterKey] = useState(0);
  const [activeFilter, setActiveFilter] = useState<any>(null);

  useEffect(() => {
    if (boundary) {
      setEndDate(boundary.accurate_until);
      applyQuickRange(quickRange, boundary.accurate_until);
    }
  }, [boundary]);

  const applyQuickRange = (range: string, end: string) => {
    const d = new Date(end);
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
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

  const applyFilters = () => { setActiveFilter(buildFilter()); setFilterKey((k) => k + 1); };

  const resetFilters = () => {
    setSelectedCTs([]); setSelectedAccounts([]); setSelectedServices([]);
    setSelectedRegions([]); setSelectedPurchaseTypes([]);
    setTagKey(""); setTagValue("");
    setMetric("unblended_cost"); setGroupBy("account"); setGranularity("daily");
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

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cost Reports</h1>
            <p className="text-sm mt-0.5 text-gray-600">
              {boundary && <>Data accurate up to <strong className="text-gray-900">{boundary.accurate_until}</strong> · Daily sync at 10:30 AM UTC</>}
            </p>
          </div>
          <button onClick={handleExport} disabled={exporting || !activeFilter}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-md transition disabled:opacity-40"
            style={{ background: "var(--success)" }}>
            <Download className="w-4 h-4" />
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>

        {/* Data boundary notice */}
        {boundary && (
          <div className="alert-info flex items-center gap-2 mb-6">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Cost data is accurate up to <strong>{boundary.accurate_until}</strong>. Daily sync runs at <strong>10:30 AM UTC</strong>.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* Filter Panel */}
          <div className="lg:col-span-1">
            <div className="card p-5 space-y-4 sticky top-20">
              <div className="flex items-center justify-between pb-3" style={{ borderBottom: "1px solid #d1d9e6" }}>
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                  <Filter className="w-4 h-4" style={{ color: "var(--primary)" }} /> Filters
                </div>
                <button onClick={resetFilters} className="text-xs font-medium text-gray-500 hover:text-red-600 transition">
                  Reset all
                </button>
              </div>

              {/* Quick range */}
              <div>
                <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Quick Range</label>
                <div className="flex gap-1">
                  {["7d", "30d", "90d"].map((r) => (
                    <button key={r} onClick={() => boundary && applyQuickRange(r, boundary.accurate_until)}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-md border transition"
                      style={{
                        borderColor: quickRange === r ? "var(--primary)" : "var(--border)",
                        background: quickRange === r ? "#e8f0fe" : "white",
                        color: quickRange === r ? "var(--primary)" : "var(--text-secondary)",
                      }}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Start</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} style={{ color: "var(--text-secondary)" }}>End</label>
                  <input type="date" value={endDate} max={boundary?.accurate_until} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                </div>
              </div>

              {/* Group by */}
              <div>
                <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Group By</label>
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={inputCls}>
                  {GROUP_BY.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>

              {/* Metric */}
              <div>
                <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Cost Metric</label>
                <select value={metric} onChange={(e) => setMetric(e.target.value)} className={inputCls}>
                  {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>

              {/* Granularity */}
              <div>
                <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Granularity</label>
                <div className="flex gap-1">
                  {["daily", "monthly"].map((g) => (
                    <button key={g} onClick={() => setGranularity(g)}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-md border transition capitalize"
                      style={{
                        borderColor: granularity === g ? "var(--primary)" : "var(--border)",
                        background: granularity === g ? "#e8f0fe" : "white",
                        color: granularity === g ? "var(--primary)" : "var(--text-secondary)",
                      }}>
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

              {groupBy === "tag" && (
                <div className="space-y-2">
                  <div>
                    <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Tag Key</label>
                    <select value={tagKey} onChange={(e) => setTagKey(e.target.value)} className={inputCls}>
                      <option value="">Select tag key</option>
                      {tagKeys.map((k: string) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Tag Value</label>
                    <input value={tagValue} onChange={(e) => setTagValue(e.target.value)} className={inputCls} placeholder="e.g. production" />
                  </div>
                </div>
              )}

              <button onClick={applyFilters}
                className="w-full py-2.5 text-sm font-semibold text-white rounded-md transition flex items-center justify-center gap-2"
                style={{ background: "var(--primary)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--primary-light)")}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--primary)")}>
                <RefreshCw className="w-4 h-4" /> Apply Filters
              </button>
            </div>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-3 space-y-5">

            {!activeFilter && (
              <div className="card p-16 text-center">
                <Filter className="w-10 h-10 mx-auto mb-3 text-gray-400" />
                <p className="text-sm text-gray-600">
                  Configure your filters and click <strong className="text-gray-900">Apply Filters</strong> to generate a report.
                </p>
              </div>
            )}

            {activeFilter && isLoading && (
              <div className="card p-16 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
              </div>
            )}

            {activeFilter && !isLoading && (
              <>
                {/* Summary cards */}
                {summaryData && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="stat-card">
                      <div className="stat-card-label">Total Cost</div>
                      <div className="stat-card-value">
                        ${(summaryData.total_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs mt-1 text-gray-500">
                        {startDate} → {endDate}
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label">Top Service</div>
                      <div className="text-base font-bold truncate" style={{ color: "var(--accent)" }}>
                        {summaryData.top_services?.[0]?.service || "—"}
                      </div>
                      <div className="text-xs mt-1 text-gray-500">
                        ${(summaryData.top_services?.[0]?.cost || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label">Records</div>
                      <div className="stat-card-value" style={{ color: "var(--success)" }}>
                        {reportData.length.toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}

                {/* Daily trend chart */}
                {summaryData?.daily_trend?.length > 0 && (
                  <div className="card p-5">
                    <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>Daily Cost Trend</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={summaryData.daily_trend}>
                        <XAxis dataKey="date" tick={{ fill: "#8a9ab0", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fill: "#8a9ab0", fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                        <Tooltip
                          contentStyle={{ background: "white", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "var(--shadow-md)" }}
                          labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
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
                <div className="card overflow-hidden">
                  <div className="px-5 py-3 flex items-center justify-between"
                    style={{ borderBottom: "1px solid #d1d9e6", background: "#f8fafc" }}>
                    <span className="text-sm font-bold capitalize text-gray-900">
                      {groupBy}-wise Cost Breakdown
                    </span>
                    <span className="text-xs text-gray-500">{reportData.length} rows</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr style={{ background: "#f8fafc", borderBottom: "2px solid #d1d9e6" }}>
                          {groupBy === "account" && (
                            <>
                              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Account</th>
                              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Account ID</th>
                            </>
                          )}
                          {groupBy === "service" && <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Service</th>}
                          {groupBy === "resource" && (
                            <>
                              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Resource ID</th>
                              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Service</th>
                            </>
                          )}
                          {groupBy === "tag" && (
                            <>
                              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Tag Key</th>
                              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Tag Value</th>
                            </>
                          )}
                          {granularity === "daily" && <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Date</th>}
                          <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Cost (USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.slice(0, 200).map((row: any, i: number) => (
                          <tr key={i} className="transition hover:bg-blue-50"
                            style={{ borderBottom: "1px solid #f0f4f8" }}>
                            {groupBy === "account" && (
                              <>
                                <td className="px-5 py-3 text-sm font-medium text-gray-900">{row.account_name || "—"}</td>
                                <td className="px-5 py-3 text-xs font-mono text-gray-600">{row.aws_account_id}</td>
                              </>
                            )}
                            {groupBy === "service" && (
                              <td className="px-5 py-3 text-sm font-medium text-gray-900">{row.service}</td>
                            )}
                            {groupBy === "resource" && (
                              <>
                                <td className="px-5 py-3 text-xs font-mono max-w-xs truncate text-gray-900">{row.resource_id}</td>
                                <td className="px-5 py-3 text-sm text-gray-600">{row.service}</td>
                              </>
                            )}
                            {groupBy === "tag" && (
                              <>
                                <td className="px-5 py-3 text-sm text-gray-600">{row.tag_key}</td>
                                <td className="px-5 py-3 text-sm font-medium text-gray-900">{row.tag_value || "(untagged)"}</td>
                              </>
                            )}
                            {granularity === "daily" && (
                              <td className="px-5 py-3 text-xs font-mono text-gray-600">{row.date}</td>
                            )}
                            <td className="px-5 py-3 text-right text-sm font-bold font-mono" style={{ color: "var(--primary)" }}>
                              ${row.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {reportData.length > 200 && (
                      <div className="px-5 py-3 text-xs text-gray-500 border-t" style={{ borderColor: "#d1d9e6" }}>
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
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
      </div>
    }>
      <ReportsContent />
    </Suspense>
  );
}
