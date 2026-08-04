"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import DateRangePicker, { DateRange, getLast30 } from "@/components/DateRangePicker";
import Link from "next/link";
import { ChevronRight, Download, Search, BarChart2 } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import toast from "react-hot-toast";

const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9","#27ae60"];

const RESOURCE_CATEGORIES: Record<string, { label: string; color: string; services: string[] }> = {
  compute:   { label: "Compute",    color: "#ec7211", services: ["AmazonEC2","AWSLambda","AmazonECS","AmazonEKS","AWSBatch","AmazonLightsail"] },
  storage:   { label: "Storage",    color: "#1a6fa8", services: ["AmazonS3","AmazonEBS","AmazonEFS","AmazonFSx","AWSBackup","AmazonGlacier"] },
  database:  { label: "Database",   color: "#1d8348", services: ["AmazonRDS","AmazonDynamoDB","AmazonElastiCache","AmazonRedshift","AmazonDocDB","AmazonNeptune"] },
  network:   { label: "Networking", color: "#8e44ad", services: ["AmazonVPC","AmazonCloudFront","AWSDirectConnect","AmazonRoute53","AWSELB","AWSNetworkFirewall","AmazonAPIGateway"] },
  security:  { label: "Security",   color: "#c0392b", services: ["AWSSecurityHub","AmazonGuardDuty","AWSShield","AWSWAF","AWSCertificateManager","AWSSecretsManager","awskms"] },
  analytics: { label: "Analytics",  color: "#2980b9", services: ["AmazonAthena","AWSGlue","AmazonEMR","AmazonKinesis","AmazonQuickSight","AWSDataPipeline"] },
  mgmt:      { label: "Management", color: "#16a085", services: ["AWSCloudTrail","AWSConfig","AmazonCloudWatch","AWSSystemsManager","AWSCostExplorer","AWSEvents"] },
  other:     { label: "Other",      color: "#7f8c8d", services: [] },
};

function getCategoryForService(service: string): string {
  for (const [key, cat] of Object.entries(RESOURCE_CATEGORIES)) {
    if (key === "other") continue;
    if (cat.services.some((s) => service.includes(s) || s.includes(service))) return key;
  }
  return "other";
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin border-blue-900" />
    </div>
  );
}

export default function AccountDetailPage() {
  const { ctId, accountId } = useParams<{ ctId: string; accountId: string }>();
  const searchParams = useSearchParams();
  const { token } = useAuthStore();
  const router = useRouter();

  const initialTab = (searchParams.get("tab") as "service" | "resource" | "tag") || "service";
  const [tab, setTab] = useState<"service" | "resource" | "tag">(initialTab);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [resourceSearch, setResourceSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTagKey, setSelectedTagKey] = useState("");

  useEffect(() => { if (!token) router.push("/auth"); }, [token]);

  const { data: boundary } = useQuery({
    queryKey: ["boundary"],
    queryFn: () => api.get("/reports/data-boundary").then((r) => r.data),
    enabled: !!token,
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    if (boundary && !dateRange) setDateRange(getLast30(boundary.accurate_until));
  }, [boundary]);

  const { data: towers = [] } = useQuery({
    queryKey: ["towers"],
    queryFn: () => api.get("/towers/").then((r) => r.data),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  const ct = towers.find((t: any) => t.id === ctId);
  // Match by UUID id OR aws_account_id as fallback
  const subAcc = ct?.sub_accounts?.find(
    (s: any) => s.id === accountId || s.aws_account_id === accountId
  );
  const awsAccountId = subAcc?.aws_account_id || "";

  const baseFilter = {
    control_tower_ids: [ctId],
    account_ids: awsAccountId ? [awsAccountId] : [],
    start_date: dateRange?.start || "",
    end_date: dateRange?.end || "",
    granularity: "daily",
    metric: "unblended_cost",
    group_by: "service",
  };

  const canQuery = !!token && !!dateRange && !!awsAccountId;

  const { data: serviceData = [], isLoading: svcLoading } = useQuery({
    queryKey: ["svc", accountId, dateRange?.start, dateRange?.end],
    queryFn: () => api.post("/reports/service-wise", { ...baseFilter, group_by: "service", granularity: "monthly" }).then((r) => r.data),
    enabled: canQuery,
    staleTime: 2 * 60 * 1000,
  });

  const { data: resourceData = [], isLoading: resLoading } = useQuery({
    queryKey: ["res", accountId, dateRange?.start, dateRange?.end],
    queryFn: () => api.post("/reports/resource-wise", { ...baseFilter, group_by: "resource" }).then((r) => r.data),
    enabled: canQuery && tab === "resource",
    staleTime: 2 * 60 * 1000,
  });

  const { data: tagKeys = [] } = useQuery({
    queryKey: ["tag-keys"],
    queryFn: () => api.get("/reports/meta/tag-keys").then((r) => r.data),
    enabled: !!token,
    staleTime: 10 * 60 * 1000,
  });

  const { data: tagData = [] } = useQuery({
    queryKey: ["tag", accountId, dateRange?.start, dateRange?.end, selectedTagKey],
    queryFn: () => api.post("/reports/tag-wise", { ...baseFilter, tag_key: selectedTagKey, group_by: "tag" }).then((r) => r.data),
    enabled: canQuery && tab === "tag" && !!selectedTagKey,
    staleTime: 2 * 60 * 1000,
  });

  const totalCost = serviceData.reduce((s: number, r: any) => s + r.cost, 0);

  // Show spinner while boundary or towers are still loading
  if (!dateRange) return <Spinner />;

  const resourcesByCategory = resourceData.reduce((acc: Record<string, any[]>, r: any) => {
    const cat = getCategoryForService(r.service);
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(r);
    return acc;
  }, {});

  const filteredResources = (selectedCategory
    ? resourcesByCategory[selectedCategory] || []
    : resourceData
  ).filter((r: any) =>
    !resourceSearch ||
    r.resource_id?.toLowerCase().includes(resourceSearch.toLowerCase()) ||
    r.service?.toLowerCase().includes(resourceSearch.toLowerCase())
  );

  const handleExport = async () => {
    try {
      const res = await api.post("/reports/export/csv", baseFilter, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cost_${subAcc?.account_name}_${dateRange?.start}_${dateRange?.end}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch { toast.error("Export failed"); }
  };

  const tabCls = (active: boolean) =>
    `px-4 py-2.5 text-sm font-bold border-b-2 transition ${
      active ? "border-blue-900 text-blue-900" : "border-transparent text-black hover:text-blue-900"
    }`;

  return (
    <div className="flex h-full">

      {/* Left Navigation */}
      <aside className="w-64 min-h-screen bg-white border-r border-gray-300 flex-shrink-0">
        <div className="px-4 py-4 border-b border-gray-200 bg-blue-900">
          <div className="text-xs font-bold text-white/70 uppercase tracking-wide mb-1">Control Tower</div>
          <Link href={`/dashboard/${ctId}`} className="text-sm font-bold text-white hover:text-white/80 truncate block">{ct?.name}</Link>
        </div>

        <nav className="py-2">
          <Link href={`/dashboard/${ctId}`}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-black hover:bg-blue-50 transition">
            <BarChart2 className="w-4 h-4 text-blue-900" />
            CT Overview
          </Link>

          <div className="mt-1">
            <div className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-black bg-gray-50 border-y border-gray-200">
              {subAcc?.account_name || accountId}
            </div>
            <div className="text-xs font-mono text-black px-4 py-1">{subAcc?.aws_account_id}</div>

            {[
              { label: "Service-wise Cost",  tab: "service"  },
              { label: "Resource-wise Cost", tab: "resource" },
              { label: "Tag-wise Cost",      tab: "tag"      },
            ].map((item) => (
              <button key={item.label}
                onClick={() => setTab(item.tab as any)}
                className={`w-full flex items-center gap-2 pl-6 pr-4 py-2.5 text-xs font-semibold transition text-left ${
                  tab === item.tab ? "bg-blue-50 text-blue-900 border-r-2 border-blue-900" : "text-black hover:bg-blue-50"
                }`}>
                <ChevronRight className="w-3 h-3" />
                {item.label}
              </button>
            ))}

            {tab === "resource" && (
              <div className="mt-1 border-t border-gray-100">
                <div className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-black bg-gray-50">
                  Categories
                </div>
                <button onClick={() => setSelectedCategory(null)}
                  className={`w-full text-left pl-6 pr-4 py-2 text-xs font-semibold transition ${
                    !selectedCategory ? "bg-blue-50 text-blue-900 border-r-2 border-blue-900" : "text-black hover:bg-blue-50"
                  }`}>
                  All Resources ({resourceData.length})
                </button>
                {Object.entries(RESOURCE_CATEGORIES).map(([key, cat]) => {
                  const count = resourcesByCategory[key]?.length || 0;
                  if (count === 0) return null;
                  return (
                    <button key={key}
                      onClick={() => setSelectedCategory(key === selectedCategory ? null : key)}
                      className={`w-full text-left pl-6 pr-4 py-2 text-xs font-semibold transition flex items-center justify-between ${
                        selectedCategory === key ? "bg-blue-50 text-blue-900 border-r-2 border-blue-900" : "text-black hover:bg-blue-50"
                      }`}>
                      <span style={{ color: selectedCategory === key ? "#0f2d5e" : cat.color }}>{cat.label}</span>
                      <span className="text-xs font-bold text-black">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 px-6 py-6 overflow-auto">

        {/* Breadcrumb + date picker */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Link href="/dashboard" className="text-black hover:text-blue-900 font-medium">Control Towers</Link>
            <ChevronRight className="w-3.5 h-3.5 text-black" />
            <Link href={`/dashboard/${ctId}`} className="text-black hover:text-blue-900 font-medium">{ct?.name}</Link>
            <ChevronRight className="w-3.5 h-3.5 text-black" />
            <span className="font-bold text-black">{subAcc?.account_name || accountId}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-white bg-green-800 hover:bg-green-900 rounded-md transition">
              <Download className="w-4 h-4" /> Export CSV
            </button>
            {boundary && dateRange && (
              <DateRangePicker boundary={boundary.accurate_until} value={dateRange} onChange={setDateRange} />
            )}
          </div>
        </div>

        {/* Account header */}
        <div className="mb-4">
          <h1 className="text-xl font-bold text-black">{subAcc?.account_name || accountId}</h1>
          <p className="text-sm font-mono text-black">{subAcc?.aws_account_id}</p>
        </div>

        {/* Total cost */}
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 inline-block mb-5">
          <div className="text-xs font-bold uppercase tracking-wide text-black mb-1">
            Total Cost ({dateRange?.start} → {dateRange?.end})
          </div>
          <div className="text-3xl font-bold text-blue-900">
            ${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-gray-300 mb-5 bg-white rounded-t-lg">
          <button onClick={() => setTab("service")}  className={tabCls(tab === "service")}>By Service</button>
          <button onClick={() => setTab("resource")} className={tabCls(tab === "resource")}>By Resource</button>
          <button onClick={() => setTab("tag")}      className={tabCls(tab === "tag")}>By Tag</button>
        </div>

        {/* Service Tab */}
        {tab === "service" && (
          svcLoading ? <Spinner /> :
          serviceData.length === 0 ? (
            <div className="text-center py-16 text-sm font-semibold text-black">No cost data for this period.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
                <h3 className="text-sm font-bold text-black mb-4">Service Cost Distribution</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={serviceData.slice(0, 8)} dataKey="cost" nameKey="service"
                      cx="50%" cy="50%" outerRadius={110}
                      label={({ name, percent }) => `${name?.slice(0, 10)} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}>
                      {serviceData.slice(0, 8).map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Cost"]}
                      contentStyle={{ background: "white", border: "2px solid #0f2d5e", borderRadius: 6 }}
                      labelStyle={{ color: "#000000", fontWeight: 700 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
                <div className="grid grid-cols-3 px-5 py-3 bg-gray-100 border-b-2 border-gray-300 text-xs font-bold uppercase tracking-wider text-black">
                  <span>Service</span><span className="text-right">Cost</span><span className="text-right">%</span>
                </div>
                <div className="overflow-y-auto max-h-72">
                  {serviceData.map((r: any, i: number) => (
                    <div key={r.service} className="grid grid-cols-3 px-5 py-2.5 border-b border-gray-200 hover:bg-blue-50 transition">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-sm font-semibold text-black truncate">{r.service}</span>
                      </div>
                      <span className="text-right text-sm font-bold font-mono text-blue-900">${r.cost.toFixed(2)}</span>
                      <span className="text-right text-sm font-semibold text-black">
                        {totalCost > 0 ? ((r.cost / totalCost) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        )}

        {/* Resource Tab */}
        {tab === "resource" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black" />
                <input
                  value={resourceSearch}
                  onChange={(e) => setResourceSearch(e.target.value)}
                  placeholder="Search resource ID or service..."
                  className="w-full pl-9 pr-4 py-2 border border-gray-400 rounded-md text-sm text-black bg-white focus:outline-none focus:border-blue-900"
                />
              </div>
              {selectedCategory && (
                <button onClick={() => setSelectedCategory(null)}
                  className="px-3 py-2 text-xs font-bold text-white bg-blue-900 rounded-md hover:bg-blue-800 transition">
                  Clear: {RESOURCE_CATEGORIES[selectedCategory]?.label}
                </button>
              )}
              <span className="text-sm font-bold text-black">{filteredResources.length} resources</span>
            </div>

            {!selectedCategory && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {Object.entries(RESOURCE_CATEGORIES).map(([key, cat]) => {
                  const items = resourcesByCategory[key] || [];
                  if (items.length === 0) return null;
                  const catCost = items.reduce((s: number, r: any) => s + r.cost, 0);
                  return (
                    <button key={key} onClick={() => setSelectedCategory(key)}
                      className="bg-white rounded-lg border-2 border-gray-200 hover:border-blue-900 p-4 text-left transition hover:shadow-md">
                      <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: cat.color }}>{cat.label}</div>
                      <div className="text-lg font-bold text-black">{items.length} resources</div>
                      <div className="text-xs font-bold text-blue-900 mt-1">
                        ${catCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
              <div className="grid grid-cols-12 px-5 py-3 bg-gray-100 border-b-2 border-gray-300 text-xs font-bold uppercase tracking-wider text-black">
                <span className="col-span-5">Resource ID</span>
                <span className="col-span-2">Service</span>
                <span className="col-span-2">Account</span>
                <span className="col-span-2">Region</span>
                <span className="col-span-1 text-right">Cost</span>
              </div>
              <div className="overflow-y-auto max-h-[500px]">
                {resLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin border-blue-900" />
                  </div>
                ) : filteredResources.length === 0 ? (
                  <div className="text-center py-12 text-sm font-semibold text-black">
                    No resources found{resourceSearch ? ` for "${resourceSearch}"` : ""}.
                  </div>
                ) : filteredResources.map((r: any, i: number) => (
                  <div key={i} className="grid grid-cols-12 px-5 py-3 border-b border-gray-200 hover:bg-blue-50 transition">
                    <span className="col-span-5 font-mono text-xs font-semibold text-black truncate">{r.resource_id}</span>
                    <span className="col-span-2 text-xs font-semibold text-black truncate">{r.service}</span>
                    <span className="col-span-2 text-xs font-semibold text-black truncate">{r.account_name || r.aws_account_id}</span>
                    <span className="col-span-2 text-xs font-semibold text-black">{r.region || "—"}</span>
                    <span className="col-span-1 text-right text-xs font-bold font-mono text-blue-900">
                      ${r.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tag Tab */}
        {tab === "tag" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-bold text-black">Tag Key:</label>
              <select value={selectedTagKey} onChange={(e) => setSelectedTagKey(e.target.value)}
                className="border border-gray-400 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-900">
                <option value="">Select a tag key</option>
                {tagKeys.map((k: string) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            {selectedTagKey && (
              <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
                <div className="grid grid-cols-3 px-5 py-3 bg-gray-100 border-b-2 border-gray-300 text-xs font-bold uppercase tracking-wider text-black">
                  <span>Tag Value</span><span>Account</span><span className="text-right">Cost (USD)</span>
                </div>
                {tagData.map((r: any, i: number) => (
                  <div key={i} className="grid grid-cols-3 px-5 py-3 border-b border-gray-200 hover:bg-blue-50 transition">
                    <span className="text-sm font-semibold text-black">{r.tag_value || "(untagged)"}</span>
                    <span className="text-xs font-mono font-semibold text-black">{r.aws_account_id}</span>
                    <span className="text-right text-sm font-bold font-mono text-blue-900">${r.cost.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
