"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { ChevronRight, Download } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import toast from "react-hot-toast";

const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9","#27ae60"];

export default function AccountDetailPage() {
  const { ctId, accountId } = useParams<{ ctId: string; accountId: string }>();
  const { token } = useAuthStore();
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<"service" | "resource" | "tag">("service");

  useEffect(() => { if (!token) router.push("/auth"); }, [token]);

  const { data: boundary } = useQuery({
    queryKey: ["boundary"],
    queryFn: () => api.get("/reports/data-boundary").then((r) => r.data),
    enabled: !!token,
  });

  const endDate = boundary?.accurate_until || new Date().toISOString().slice(0, 10);
  const startDate = (() => {
    const d = new Date(endDate);
    d.setDate(d.getDate() - days + 1);
    return d.toISOString().slice(0, 10);
  })();

  const { data: towers = [] } = useQuery({
    queryKey: ["towers"],
    queryFn: () => api.get("/towers/").then((r) => r.data),
    enabled: !!token,
  });

  const ct = towers.find((t: any) => t.id === ctId);
  const subAcc = ct?.sub_accounts?.find((s: any) => s.id === accountId);

  const baseFilter = {
    control_tower_ids: [ctId],
    account_ids: subAcc ? [subAcc.aws_account_id] : [],
    start_date: startDate,
    end_date: endDate,
    granularity: "daily",
    metric: "unblended_cost",
    group_by: tab,
  };

  const { data: serviceData = [] } = useQuery({
    queryKey: ["svc", accountId, startDate, endDate],
    queryFn: () => api.post("/reports/service-wise", { ...baseFilter, group_by: "service" }).then((r) => r.data),
    enabled: !!token && !!subAcc && !!boundary,
  });

  const { data: resourceData = [], isLoading: resLoading } = useQuery({
    queryKey: ["res", accountId, startDate, endDate],
    queryFn: () => api.post("/reports/resource-wise", { ...baseFilter, group_by: "resource" }).then((r) => r.data),
    enabled: !!token && !!subAcc && !!boundary && tab === "resource",
  });

  const { data: tagKeys = [] } = useQuery({
    queryKey: ["tag-keys"],
    queryFn: () => api.get("/reports/meta/tag-keys").then((r) => r.data),
    enabled: !!token,
  });

  const [selectedTagKey, setSelectedTagKey] = useState("");
  const { data: tagData = [] } = useQuery({
    queryKey: ["tag", accountId, startDate, endDate, selectedTagKey],
    queryFn: () => api.post("/reports/tag-wise", { ...baseFilter, tag_key: selectedTagKey, group_by: "tag" }).then((r) => r.data),
    enabled: !!token && !!subAcc && !!boundary && tab === "tag" && !!selectedTagKey,
  });

  const totalCost = serviceData.reduce((s: number, r: any) => s + r.cost, 0);

  const handleExport = async () => {
    try {
      const res = await api.post("/reports/export/csv", baseFilter, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cost_${subAcc?.account_name}_${startDate}_${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch { toast.error("Export failed"); }
  };

  const btnStyle = (active: boolean) => ({
    borderColor: active ? "var(--primary)" : "var(--border)",
    background: active ? "#e8f0fe" : "white",
    color: active ? "var(--primary)" : "var(--text-secondary)",
  });

  const tabStyle = (active: boolean) => ({
    background: active ? "var(--primary)" : "transparent",
    color: active ? "white" : "var(--text-secondary)",
  });

  const inputCls = "border rounded-md px-3 py-2 text-sm focus:outline-none transition bg-white text-gray-800 border-gray-300 focus:border-blue-600";

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <Link href="/dashboard" style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}>
            Control Towers
          </Link>
          <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
          <Link href={`/dashboard/${ctId}`} style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}>
            {ct?.name || "..."}
          </Link>
          <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{subAcc?.account_name || "..."}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{subAcc?.account_name}</h1>
            <p className="text-sm font-mono mt-0.5" style={{ color: "var(--text-secondary)" }}>{subAcc?.aws_account_id}</p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className="px-3 py-1.5 text-xs font-semibold rounded-md border transition"
                style={btnStyle(days === d)}>
                {d}d
              </button>
            ))}
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-md transition"
              style={{ background: "var(--success)" }}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
        </div>

        {/* Total cost */}
        <div className="stat-card inline-block mb-6">
          <div className="stat-card-label">Total Cost ({startDate} → {endDate})</div>
          <div className="stat-card-value text-3xl">
            ${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 rounded-lg w-fit" style={{ background: "#f1f4f9" }}>
          {(["service", "resource", "tag"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-2 text-sm font-semibold rounded-md transition capitalize"
              style={tabStyle(tab === t)}>
              {t === "service" ? "By Service" : t === "resource" ? "By Resource" : "By Tag"}
            </button>
          ))}
        </div>

        {/* Service tab */}
        {tab === "service" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-5">
              <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>Service Cost Distribution</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={serviceData.slice(0, 8)} dataKey="cost" nameKey="service"
                    cx="50%" cy="50%" outerRadius={100}
                    label={({ name, percent }) => `${name?.slice(0, 10)} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}>
                    {serviceData.slice(0, 8).map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Cost"]}
                    contentStyle={{ background: "white", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "var(--shadow-md)" }}
                    labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="card overflow-hidden">
              <div className="grid grid-cols-3 px-5 py-3 text-xs font-semibold uppercase tracking-wider"
                style={{ borderBottom: "2px solid var(--border)", background: "#f8fafc", color: "var(--text-secondary)" }}>
                <span>Service</span><span className="text-right">Cost</span><span className="text-right">%</span>
              </div>
              <div className="overflow-y-auto max-h-72">
                {serviceData.map((r: any, i: number) => (
                  <div key={r.service} className="grid grid-cols-3 px-5 py-2.5 transition text-sm"
                    style={{ borderBottom: "1px solid #f0f4f8" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="truncate font-medium" style={{ color: "var(--text-primary)" }}>{r.service}</span>
                    </div>
                    <span className="text-right font-mono font-bold" style={{ color: "var(--primary)" }}>${r.cost.toFixed(2)}</span>
                    <span className="text-right" style={{ color: "var(--text-secondary)" }}>
                      {totalCost > 0 ? ((r.cost / totalCost) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Resource tab */}
        {tab === "resource" && (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-4 px-5 py-3 text-xs font-semibold uppercase tracking-wider"
              style={{ borderBottom: "2px solid var(--border)", background: "#f8fafc", color: "var(--text-secondary)" }}>
              <span>Resource ID</span><span>Service</span>
              <span className="text-right">Cost (USD)</span><span className="text-right">Account</span>
            </div>
            <div className="overflow-y-auto max-h-[500px]">
              {resLoading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
                </div>
              ) : resourceData.length === 0 ? (
                <div className="text-center py-12 text-sm" style={{ color: "var(--text-muted)" }}>
                  No resource-level data available for this period.
                </div>
              ) : resourceData.map((r: any) => (
                <div key={r.resource_id} className="grid grid-cols-4 px-5 py-3 transition text-sm"
                  style={{ borderBottom: "1px solid #f0f4f8" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <span className="font-mono text-xs truncate" style={{ color: "var(--text-primary)" }}>{r.resource_id}</span>
                  <span className="truncate" style={{ color: "var(--text-secondary)" }}>{r.service}</span>
                  <span className="text-right font-mono font-bold" style={{ color: "var(--primary)" }}>${r.cost.toFixed(4)}</span>
                  <span className="text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{r.aws_account_id}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tag tab */}
        {tab === "tag" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Tag Key:</label>
              <select value={selectedTagKey} onChange={(e) => setSelectedTagKey(e.target.value)} className={inputCls}>
                <option value="">Select a tag key</option>
                {tagKeys.map((k: string) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            {selectedTagKey && (
              <div className="card overflow-hidden">
                <div className="grid grid-cols-3 px-5 py-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ borderBottom: "2px solid var(--border)", background: "#f8fafc", color: "var(--text-secondary)" }}>
                  <span>Tag Value</span><span>Account</span><span className="text-right">Cost (USD)</span>
                </div>
                {tagData.map((r: any, i: number) => (
                  <div key={i} className="grid grid-cols-3 px-5 py-3 transition text-sm"
                    style={{ borderBottom: "1px solid #f0f4f8" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                    <span className="font-medium" style={{ color: "var(--text-primary)" }}>{r.tag_value || "(untagged)"}</span>
                    <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>{r.aws_account_id}</span>
                    <span className="text-right font-mono font-bold" style={{ color: "var(--primary)" }}>${r.cost.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
