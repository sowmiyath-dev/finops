"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Download } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from "recharts";
import toast from "react-hot-toast";

const COLORS = ["#7c3aed","#06b6d4","#10b981","#f59e0b","#f43f5e","#a855f7","#22d3ee","#34d399"];

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

  const { data: serviceData = [], isLoading: svcLoading } = useQuery({
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
    } catch { toast.error("Export failed"); }
  };

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-10">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-slate-400 mb-6">
          <Link href="/dashboard" className="hover:text-white transition">Control Towers</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href={`/dashboard/${ctId}`} className="hover:text-white transition">{ct?.name || "..."}</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-white font-medium">{subAcc?.account_name || "..."}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{subAcc?.account_name}</h1>
            <p className="text-slate-400 text-sm mt-0.5 font-mono">{subAcc?.aws_account_id}</p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${days === d ? "bg-[#7c3aed]/20 text-[#c084fc] border-[#7c3aed]/40" : "text-slate-400 border-slate-700 hover:border-slate-500"}`}>
                {d}d
              </button>
            ))}
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/25 transition">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
        </div>

        {/* Total cost */}
        <div className="card p-5 mb-6 inline-block">
          <div className="text-xs text-slate-400 mb-1">Total Cost ({startDate} → {endDate})</div>
          <div className="text-3xl font-bold text-[#22d3ee]">
            ${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-900 p-1 rounded-xl w-fit">
          {(["service", "resource", "tag"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition capitalize ${tab === t ? "bg-[#7c3aed] text-white" : "text-slate-400 hover:text-white"}`}>
              {t === "service" ? "By Service" : t === "resource" ? "By Resource" : "By Tag"}
            </button>
          ))}
        </div>

        {/* Service tab */}
        {tab === "service" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-white mb-4">Service Cost Distribution</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={serviceData.slice(0, 8)} dataKey="cost" nameKey="service" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name?.slice(0, 12)} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {serviceData.slice(0, 8).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Cost"]} contentStyle={{ background: "#0d1424", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-800 text-xs font-medium text-slate-400 uppercase tracking-wider grid grid-cols-3">
                <span>Service</span><span className="text-right">Cost</span><span className="text-right">%</span>
              </div>
              <div className="overflow-y-auto max-h-72">
                {serviceData.map((r: any, i: number) => (
                  <div key={r.service} className="grid grid-cols-3 px-5 py-2.5 border-b border-slate-800/50 hover:bg-[#7c3aed]/5 transition text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-white truncate">{r.service}</span>
                    </div>
                    <span className="text-right text-[#22d3ee] font-mono">${r.cost.toFixed(2)}</span>
                    <span className="text-right text-slate-400">{totalCost > 0 ? ((r.cost / totalCost) * 100).toFixed(1) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Resource tab */}
        {tab === "resource" && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/30 grid grid-cols-4 text-xs font-medium text-slate-400 uppercase tracking-wider">
              <span>Resource ID</span><span>Service</span><span className="text-right">Cost (USD)</span><span className="text-right">Account</span>
            </div>
            <div className="overflow-y-auto max-h-[500px]">
              {resLoading ? (
                <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin" /></div>
              ) : resourceData.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm">No resource-level data available for this period.</div>
              ) : resourceData.map((r: any) => (
                <div key={r.resource_id} className="grid grid-cols-4 px-5 py-3 border-b border-slate-800/50 hover:bg-[#7c3aed]/5 transition text-sm">
                  <span className="font-mono text-xs text-slate-300 truncate">{r.resource_id}</span>
                  <span className="text-slate-400 truncate">{r.service}</span>
                  <span className="text-right text-[#22d3ee] font-mono">${r.cost.toFixed(4)}</span>
                  <span className="text-right font-mono text-xs text-slate-500">{r.aws_account_id}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tag tab */}
        {tab === "tag" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm text-slate-400">Tag Key:</label>
              <select value={selectedTagKey} onChange={(e) => setSelectedTagKey(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#7c3aed]">
                <option value="">Select a tag key</option>
                {tagKeys.map((k: string) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            {selectedTagKey && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/30 grid grid-cols-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  <span>Tag Value</span><span>Account</span><span className="text-right">Cost (USD)</span>
                </div>
                {tagData.map((r: any, i: number) => (
                  <div key={i} className="grid grid-cols-3 px-5 py-3 border-b border-slate-800/50 hover:bg-[#7c3aed]/5 transition text-sm">
                    <span className="text-white">{r.tag_value || "(untagged)"}</span>
                    <span className="font-mono text-xs text-slate-400">{r.aws_account_id}</span>
                    <span className="text-right text-[#22d3ee] font-mono">${r.cost.toFixed(2)}</span>
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
