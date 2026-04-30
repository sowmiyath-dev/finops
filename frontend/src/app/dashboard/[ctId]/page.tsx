"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { ChevronRight, DollarSign, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9"];

export default function CTDetailPage() {
  const { ctId } = useParams<{ ctId: string }>();
  const { token } = useAuthStore();
  const router = useRouter();
  const [days, setDays] = useState(30);

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

  const { data: summary, isLoading } = useQuery({
    queryKey: ["ct-summary", ctId, startDate, endDate],
    queryFn: () => api.post("/reports/summary", {
      control_tower_ids: [ctId],
      start_date: startDate,
      end_date: endDate,
      granularity: "daily",
      metric: "unblended_cost",
      group_by: "account",
    }).then((r) => r.data),
    enabled: !!token && !!ctId && !!boundary,
  });

  const btnStyle = (active: boolean) => ({
    borderColor: active ? "var(--primary)" : "var(--border)",
    background: active ? "#e8f0fe" : "white",
    color: active ? "var(--primary)" : "var(--text-secondary)",
  });

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <Link href="/dashboard" className="transition" style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}>
            Control Towers
          </Link>
          <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{ct?.name || "..."}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{ct?.name}</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              Management: <span className="font-mono">{ct?.management_account_id}</span>
              {" · "}{ct?.sub_accounts?.length || 0} sub-accounts
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className="px-3 py-1.5 text-xs font-semibold rounded-md border transition"
                style={btnStyle(days === d)}>
                {d}d
              </button>
            ))}
            <Link href={`/reports?ct=${ctId}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition text-white"
              style={{ background: "var(--primary)", borderColor: "var(--primary)" }}>
              <DollarSign className="w-3.5 h-3.5" /> Full Report
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <div className="stat-card">
                <div className="stat-card-label">Total Cost</div>
                <div className="stat-card-value">
                  ${(summary?.total_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{startDate} → {endDate}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Top Service</div>
                <div className="text-base font-bold truncate" style={{ color: "var(--accent)" }}>
                  {summary?.top_services?.[0]?.service || "—"}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  ${(summary?.top_services?.[0]?.cost || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Sub-accounts</div>
                <div className="stat-card-value" style={{ color: "var(--success)" }}>
                  {ct?.sub_accounts?.length || 0}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>tracked accounts</div>
              </div>
            </div>

            {/* Daily trend chart */}
            {summary?.daily_trend?.length > 0 && (
              <div className="card p-5 mb-6">
                <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>Daily Cost Trend</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={summary.daily_trend}>
                    <XAxis dataKey="date" tick={{ fill: "#8a9ab0", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fill: "#8a9ab0", fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: "white", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "var(--shadow-md)" }}
                      labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
                      formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Cost"]}
                    />
                    <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                      {summary.daily_trend.map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Per-account table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)", background: "#f8fafc" }}>
                <Users className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
                <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Account Cost Breakdown</h3>
              </div>
              <table className="w-full">
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "2px solid var(--border)" }}>
                    {["Account", "Account ID", "Cost (USD)", "% of Total", ""].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider"
                        style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(summary?.per_account || []).map((acc: any) => {
                    const pct = summary.total_cost > 0 ? (acc.cost / summary.total_cost) * 100 : 0;
                    const subAcc = ct?.sub_accounts?.find((s: any) => s.aws_account_id === acc.aws_account_id);
                    return (
                      <tr key={acc.aws_account_id} className="transition"
                        style={{ borderBottom: "1px solid #f0f4f8" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                              style={{ background: "var(--primary)" }}>
                              {(acc.account_name || "?")[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                              {acc.account_name || "Unknown"}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                          {acc.aws_account_id}
                        </td>
                        <td className="px-5 py-3 text-sm font-bold font-mono" style={{ color: "var(--primary)" }}>
                          ${acc.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "#e2e8f0" }}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--primary)" }} />
                            </div>
                            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {subAcc && (
                            <Link href={`/dashboard/${ctId}/account/${subAcc.id}`}
                              className="flex items-center gap-1 text-xs font-medium transition"
                              style={{ color: "var(--primary)" }}
                              onMouseEnter={e => (e.currentTarget.style.color = "var(--accent)")}
                              onMouseLeave={e => (e.currentTarget.style.color = "var(--primary)")}>
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
