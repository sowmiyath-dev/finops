"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { ArrowLeft, ChevronRight, DollarSign, TrendingUp, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#7c3aed","#06b6d4","#10b981","#f59e0b","#f43f5e","#a855f7","#22d3ee"];

export default function CTDetailPage() {
  const { ctId } = useParams<{ ctId: string }>();
  const { token } = useAuthStore();
  const router = useRouter();

  useEffect(() => { if (!token) router.push("/auth"); }, [token]);

  // default: last 30 days up to accurate boundary
  const [days, setDays] = useState(30);

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

  const { data: summary, isLoading } = useQuery({
    queryKey: ["ct-summary", ctId, startDate, endDate],
    queryFn: () =>
      api.post("/reports/summary", {
        control_tower_ids: [ctId],
        start_date: startDate,
        end_date: endDate,
        granularity: "daily",
        metric: "unblended_cost",
        group_by: "account",
      }).then((r) => r.data),
    enabled: !!token && !!ctId && !!boundary,
  });

  if (!ct && !isLoading) return (
    <div className="min-h-screen bg-mesh"><Navbar />
      <div className="max-w-7xl mx-auto px-6 py-10">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-4"><ArrowLeft className="w-4 h-4" /> Back</button>
        <p className="text-slate-400">Control Tower not found.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-10">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-slate-400 mb-6">
          <Link href="/dashboard" className="hover:text-white transition">Control Towers</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-white font-medium">{ct?.name || "..."}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{ct?.name}</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Management: <span className="font-mono text-slate-300">{ct?.management_account_id}</span>
              {" · "}{ct?.sub_accounts?.length || 0} sub-accounts
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${days === d ? "bg-[#7c3aed]/20 text-[#c084fc] border-[#7c3aed]/40" : "text-slate-400 border-slate-700 hover:border-slate-500"}`}>
                {d}d
              </button>
            ))}
            <Link href={`/reports?ct=${ctId}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#7c3aed]/15 text-[#c084fc] border border-[#7c3aed]/30 rounded-lg hover:bg-[#7c3aed]/25 transition">
              <DollarSign className="w-3.5 h-3.5" /> Full Report
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
              <div className="card p-5">
                <div className="text-xs text-slate-400 mb-1">Total Cost</div>
                <div className="text-2xl font-bold text-[#22d3ee]">
                  ${(summary?.total_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-slate-500 mt-1">{startDate} → {endDate}</div>
              </div>
              <div className="card p-5">
                <div className="text-xs text-slate-400 mb-1">Top Service</div>
                <div className="text-lg font-bold text-[#c084fc] truncate">
                  {summary?.top_services?.[0]?.service || "—"}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  ${(summary?.top_services?.[0]?.cost || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="card p-5">
                <div className="text-xs text-slate-400 mb-1">Accounts</div>
                <div className="text-2xl font-bold text-emerald-400">{ct?.sub_accounts?.length || 0}</div>
                <div className="text-xs text-slate-500 mt-1">sub-accounts tracked</div>
              </div>
            </div>

            {/* Daily trend chart */}
            {summary?.daily_trend?.length > 0 && (
              <div className="card p-6 mb-8">
                <h3 className="text-sm font-semibold text-white mb-4">Daily Cost Trend</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={summary.daily_trend}>
                    <XAxis dataKey="date" tick={{ fill: "#4a5578", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fill: "#4a5578", fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: "#0d1424", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 8 }}
                      labelStyle={{ color: "#94a3c4" }}
                      formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Cost"]}
                    />
                    <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                      {summary.daily_trend.map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Per-account table */}
            <div className="card overflow-hidden">
              <div className="px-6 py-4 border-b border-[#7c3aed]/10 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#94a3c4]" />
                <h3 className="text-sm font-semibold text-white">Account Cost Breakdown</h3>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-800/30">
                    {["Account", "Account ID", "Cost (USD)", "% of Total", ""].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(summary?.per_account || []).map((acc: any, i: number) => {
                    const pct = summary.total_cost > 0 ? (acc.cost / summary.total_cost) * 100 : 0;
                    const subAcc = ct?.sub_accounts?.find((s: any) => s.aws_account_id === acc.aws_account_id);
                    return (
                      <tr key={acc.aws_account_id} className="border-b border-slate-800/50 hover:bg-[#7c3aed]/5 transition">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-[#7c3aed]/15 flex items-center justify-center text-xs font-bold text-[#c084fc]">
                              {(acc.account_name || "?")[0].toUpperCase()}
                            </div>
                            <span className="text-sm text-white font-medium">{acc.account_name || "Unknown"}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs font-mono text-slate-400">{acc.aws_account_id}</td>
                        <td className="px-5 py-3 text-sm font-semibold text-[#22d3ee]">
                          ${acc.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-[#7c3aed] to-[#06b6d4]" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-slate-400">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {subAcc && (
                            <Link href={`/dashboard/${ctId}/account/${subAcc.id}`}
                              className="text-xs text-[#c084fc] hover:text-[#a855f7] transition flex items-center gap-1">
                              Details <ChevronRight className="w-3 h-3" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
