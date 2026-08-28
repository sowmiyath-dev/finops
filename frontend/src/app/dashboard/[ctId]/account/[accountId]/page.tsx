"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import DateRangePicker, { DateRange, getLast30 } from "@/components/DateRangePicker";
import Link from "next/link";
import { ChevronRight, Download, Search, BarChart2 } from "lucide-react";
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
  // usage_quantity is GB-months for EBS, hours for EC2
  const qty: number = r.usage_quantity || 0;

  const attachHint =
    at["instance-id"] || at["instanceid"] || at["attached-to"] || at["attachedto"] ||
    at["ec2-name"] || at["ec2name"] || at["source-instance"] || at["sourceinstance"] || "";
  const volHint = at["volume-id"] || at["volumeid"] || at["source-volume"] || at["sourcevolume"] || "";

  // EBS Volume
  if (rid.startsWith("vol-")) {
    // Prefer product/volumeApiName (gp3, io2 etc), fallback to usage_type parse
    let vt = volumeType;
    if (!vt) {
      const m = usageType.match(/VolumeUsage\.?(\w+)?/i);
      if (m?.[1]) vt = m[1];
    }
    const sizePart = qty > 0 ? ` · ${Math.round(qty)} GB` : "";
    const mediaPart = storageMedia ? ` (${storageMedia})` : "";
    const desc = vt ? `EBS Volume · ${vt}${mediaPart}${sizePart}` : `EBS Volume${mediaPart}${sizePart}`;
    const attachment = attachHint ? `Attached to: ${attachHint}` : "";
    return { desc, attachment };
  }

  // EBS Snapshot
  if (rid.startsWith("snap-")) {
    const sizePart = qty > 0 ? ` · ${Math.round(qty)} GB` : "";
    const desc = `EBS Snapshot${sizePart}`;
    const parts: string[] = [];
    if (volHint) parts.push(`From volume: ${volHint}`);
    if (attachHint) parts.push(`Instance: ${attachHint}`);
    return { desc, attachment: parts.join(" · ") };
  }

  // EC2 Instance
  if (rid.startsWith("i-")) {
    // Prefer product/instanceType, fallback to usage_type parse
    let itype = instanceType;
    if (!itype) {
      const m = usageType.match(/BoxUsage:(\S+)/i);
      if (m) itype = m[1];
    }
    const osPart = os ? ` · ${os}` : "";
    const desc = itype ? `EC2 Instance · ${itype}${osPart}` : `EC2 Instance${osPart}`;
    return { desc, attachment: "" };
  }

  // Elastic IP
  if (ut.includes("elasticip") || ut.includes("elastic-ip") || ut.includes("eip")) {
    const idle = ut.includes("idle") || ut.includes("unassociated");
    const desc = idle ? "Elastic IP · Idle / Unassociated" : "Elastic IP";
    const attachment = attachHint ? `Associated with: ${attachHint}` : idle ? "Not attached to any instance" : "";
    return { desc, attachment };
  }

  // ENI
  if (rid.startsWith("eni-")) {
    let desc = "Network Interface (ENI)";
    if (ut.includes("natgateway") || ut.includes("nat-gateway")) desc = "NAT Gateway ENI";
    else if (ut.includes("vpcendpoint") || ut.includes("vpc-endpoint")) desc = "VPC Endpoint ENI";
    else if (ut.includes("transitgateway") || ut.includes("transit-gateway")) desc = "Transit Gateway ENI";
    const attachment = attachHint ? `Attached to: ${attachHint}` : "";
    return { desc, attachment };
  }

  // NAT Gateway
  if (rid.startsWith("nat-") || ut.includes("natgateway")) {
    const desc = ut.includes("bytes") ? "NAT Gateway · Data Transfer" : "NAT Gateway";
    return { desc, attachment: "" };
  }

  // Load Balancer
  if (rid.includes("loadbalancer") || rid.includes("app/") || rid.includes("net/")) {
    let desc = "Load Balancer";
    if (rid.includes("app/")) desc = "Application Load Balancer";
    else if (rid.includes("net/")) desc = "Network Load Balancer";
    return { desc, attachment: "" };
  }

  // RDS
  if (rid.startsWith("db:") || rid.includes(":db:")) {
    const desc = operation.toLowerCase().includes("snapshot") ? "RDS Snapshot" : "RDS Instance";
    return { desc, attachment: "" };
  }

  return { desc: "", attachment: "" };
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
    queryFn: () => api.post("/reports/service-wise", { ...baseFilter, group_by: "service", granularity: "daily" }).then((r) => r.data),
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

  // Build pivot: { service -> { date -> cost } } for AWS-portal-style table
  const allDates: string[] = Array.from(
    new Set(serviceData.map((r: any) => r.date as string))
  ).sort() as string[];

  const pivotMap: Record<string, Record<string, number>> = {};
  for (const r of serviceData) {
    if (!pivotMap[r.service]) pivotMap[r.service] = {};
    pivotMap[r.service][r.date] = (pivotMap[r.service][r.date] || 0) + r.cost;
  }

  const serviceRows = Object.entries(pivotMap)
    .map(([service, byDate]) => ({
      service,
      total: Object.values(byDate).reduce((s, v) => s + v, 0),
      byDate,
    }))
    .sort((a, b) => b.total - a.total);

  const grandTotal = serviceRows.reduce((s, r) => s + r.total, 0);
  const colTotals: Record<string, number> = {};
  for (const d of allDates) {
    colTotals[d] = serviceRows.reduce((s, r) => s + (r.byDate[d] || 0), 0);
  }

  const totalCost = grandTotal;

  const fmtDate = (d: string) => {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
  };

  const fmtUSD = (v: number) =>
    v === 0 ? "-" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  ).filter((r: any) => {
    if (!resourceSearch) return true;
    const q = resourceSearch.toLowerCase();
    const { desc, attachment } = getResourceDescription(r);
    return (
      r.resource_id?.toLowerCase().includes(q) ||
      r.resource_name?.toLowerCase().includes(q) ||
      r.service?.toLowerCase().includes(q) ||
      desc.toLowerCase().includes(q) ||
      attachment.toLowerCase().includes(q)
    );
  });

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

        {/* Service Tab — AWS-portal-style pivot table */}
        {tab === "service" && (
          svcLoading ? <Spinner /> :
          serviceRows.length === 0 ? (
            <div className="text-center py-16 text-sm font-semibold text-black">No cost data for this period.</div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
              <div className="text-xs font-bold text-black px-4 py-2 bg-gray-50 border-b border-gray-200">
                {serviceRows.length} services &nbsp;·&nbsp; {allDates.length} days
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black sticky left-0 bg-gray-100 min-w-[200px]">Service</th>
                      <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-black whitespace-nowrap">Service Total</th>
                      {allDates.map((d) => (
                        <th key={d} className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-black whitespace-nowrap">
                          {fmtDate(d)}
                        </th>
                      ))}
                    </tr>
                    {/* Grand total row */}
                    <tr className="bg-blue-900 text-white border-b-2 border-blue-800">
                      <td className="px-4 py-2.5 text-xs font-bold sticky left-0 bg-blue-900">Total costs</td>
                      <td className="text-right px-4 py-2.5 text-xs font-bold font-mono">{fmtUSD(grandTotal)}</td>
                      {allDates.map((d) => (
                        <td key={d} className="text-right px-4 py-2.5 text-xs font-bold font-mono">{fmtUSD(colTotals[d] || 0)}</td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {serviceRows.map((row, i) => (
                      <tr key={row.service} className={`border-b border-gray-200 hover:bg-blue-50 transition ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                        <td className={`px-4 py-2.5 text-xs font-semibold text-black sticky left-0 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"} hover:bg-blue-50`}>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                            <span className="truncate max-w-[180px]" title={row.service}>{row.service}</span>
                          </div>
                        </td>
                        <td className="text-right px-4 py-2.5 text-xs font-bold font-mono text-blue-900 whitespace-nowrap">{fmtUSD(row.total)}</td>
                        {allDates.map((d) => (
                          <td key={d} className="text-right px-4 py-2.5 text-xs font-mono text-black whitespace-nowrap">
                            {fmtUSD(row.byDate[d] || 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  placeholder="Search resource ID, name or service..."
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
                <span className="col-span-3">Resource ID / Name</span>
                <span className="col-span-3">Description / Attachment</span>
                <span className="col-span-2">Service</span>
                <span className="col-span-2">Region</span>
                <span className="col-span-2 text-right">Cost</span>
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
                ) : filteredResources.map((r: any, i: number) => {
                  const { desc, attachment } = getResourceDescription(r);
                  return (
                    <div key={i} className="grid grid-cols-12 px-5 py-3 border-b border-gray-200 hover:bg-blue-50 transition items-start">
                      <span className="col-span-3 text-xs text-black">
                        <span className="font-mono font-semibold truncate block">{r.resource_id}</span>
                        {r.resource_name && (
                          <span className="text-blue-700 font-semibold truncate block">{r.resource_name}</span>
                        )}
                      </span>
                      <span className="col-span-3 text-xs text-black">
                        {desc && <span className="font-semibold text-slate-700 block">{desc}</span>}
                        {attachment && (
                          <span className="text-amber-700 font-medium block truncate" title={attachment}>{attachment}</span>
                        )}
                        {!desc && !attachment && <span className="text-slate-300">—</span>}
                      </span>
                      <span className="col-span-2 text-xs font-semibold text-black truncate">{r.service}</span>
                      <span className="col-span-2 text-xs font-semibold text-black">{r.region || "—"}</span>
                      <span className="col-span-2 text-right text-xs font-bold font-mono text-blue-900">
                        ${r.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </span>
                    </div>
                  );
                })}
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
