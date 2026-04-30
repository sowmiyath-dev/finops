"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import DateRangePicker, { DateRange, getLast30 } from "@/components/DateRangePicker";
import Link from "next/link";
import {
  ChevronRight, Users, DollarSign, TrendingUp,
  ChevronDown, ChevronUp, BarChart2,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9"];

export default function CTDetailPage() {
  const { ctId } = useParams<{ ctId: string }>();
  const { token } = useAuthStore();
  const router = useRouter();
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

  useEffect(() => { if (!token) router.push("/auth"); }, [token]);

  const { data: boundary } = useQuery({
    queryKey: ["boundary"],
    queryFn: () => api.get("/reports/data-boundary").then((r) => r.data),
    enabled: !!token,
  });

  useEffect(() => {
    if (boundary && !dateRange) setDateRange(getLast30(boundary.accurate_until));
  }, [boundary]);

  const { data: towers = [] } = useQuery({
    queryKey: ["towers"],
    queryFn: () => api.get("/towers/").then((r) => r.data),
    enabled: !!token,
  });

  const ct = towers.find((t: any) => t.id === ctId);

  const { data: summary, isLoading } = useQuery({
    queryKey: ["ct-summary", ctId, dateRange?.start, dateRange?.end],
    queryFn: () => api.post("/reports/summary", {
      control_tower_ids: [ctId],
      start_date: dateRange!.start,
      end_date: dateRange!.end,
      granularity: "daily",
      metric: "unblended_cost",
      group_by: "account",
    }).then((r) => r.data),
    enabled: !!token && !!ctId && !!dateRange,
  });

  const toggleAccount = (id: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-screen" style={{ background: "#f1f4f9" }}>
      <Navbar />
      <div className="flex">

        {/* ── Left Navigation (AWS-style) ── */}
        <aside className="w-64 min-h-screen bg-white border-r border-gray-300 flex-shrink-0">
          {/* CT header */}
          <div className="px-4 py-4 border-b border-gray-200 bg-blue-900">
            <div className="text-xs font-bold text-white/70 uppercase tracking-wide mb-1">Control Tower</div>
            <div className="text-sm font-bold text-white truncate">{ct?.name || "..."}</div>
            <div className="text-xs text-white/60 font-mono mt-0.5">{ct?.management_account_id}</div>
          </div>

          {/* Nav items */}
          <nav className="py-2">
            {/* Overview */}
            <Link href={`/dashboard/${ctId}`}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-black bg-blue-50 border-r-2 border-blue-900">
              <BarChart2 className="w-4 h-4 text-blue-900" />
              Overview
            </Link>

            {/* Sub-accounts */}
            <div className="mt-2">
              <div className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-black bg-gray-50 border-y border-gray-200">
                Sub-accounts ({ct?.sub_accounts?.length || 0})
              </div>
              {(ct?.sub_accounts || []).map((acc: any) => (
                <div key={acc.id}>
                  <button
                    onClick={() => toggleAccount(acc.id)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-black hover:bg-blue-50 transition">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-5 h-5 rounded bg-blue-900 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {acc.account_name[0].toUpperCase()}
                      </div>
                      <span className="truncate text-xs font-semibold">{acc.account_name}</span>
                    </div>
                    {expandedAccounts.has(acc.id)
                      ? <ChevronUp className="w-3 h-3 flex-shrink-0 text-black" />
                      : <ChevronDown className="w-3 h-3 flex-shrink-0 text-black" />}
                  </button>

                  {/* Sub-nav under account */}
                  {expandedAccounts.has(acc.id) && (
                    <div className="bg-gray-50 border-y border-gray-100">
                      {[
                        { label: "Account Overview", href: `/dashboard/${ctId}/account/${acc.id}` },
                        { label: "Service-wise Cost", href: `/dashboard/${ctId}/account/${acc.id}?tab=service` },
                        { label: "Resource-wise Cost", href: `/dashboard/${ctId}/account/${acc.id}?tab=resource` },
                        { label: "Tag-wise Cost", href: `/dashboard/${ctId}/account/${acc.id}?tab=tag` },
                      ].map((item) => (
                        <Link key={item.label} href={item.href}
                          className="flex items-center gap-2 pl-10 pr-4 py-2 text-xs font-semibold text-black hover:bg-blue-100 hover:text-blue-900 transition">
                          <ChevronRight className="w-3 h-3" />
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </nav>
        </aside>

        {/* ── Main Content ── */}
        <main className="flex-1 px-6 py-6 overflow-auto">

          {/* Breadcrumb + date picker */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2 text-sm">
              <Link href="/dashboard" className="text-black hover:text-blue-900 font-medium transition">
                Control Towers
              </Link>
              <ChevronRight className="w-3.5 h-3.5 text-black" />
              <span className="font-bold text-black">{ct?.name || "..."}</span>
            </div>
            {boundary && dateRange && (
              <DateRangePicker boundary={boundary.accurate_until} value={dateRange} onChange={setDateRange} />
            )}
          </div>

          {/* Page title */}
          <div className="mb-5">
            <h1 className="text-xl font-bold text-black">{ct?.name} — Cost Overview</h1>
            <p className="text-sm text-black mt-0.5">
              Management: <span className="font-mono">{ct?.management_account_id}</span>
              {" · "}{ct?.management_account_name}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin border-blue-900" />
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-4 mb-5">
                <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
                  <div className="text-xs font-bold uppercase tracking-wide text-black mb-1">Total Cost</div>
                  <div className="text-2xl font-bold text-blue-900">
                    ${(summary?.total_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs font-semibold text-black mt-1">{dateRange?.start} → {dateRange?.end}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
                  <div className="text-xs font-bold uppercase tracking-wide text-black mb-1">Top Service</div>
                  <div className="text-base font-bold text-orange-600 truncate">
                    {summary?.top_services?.[0]?.service || "—"}
                  </div>
                  <div className="text-xs font-semibold text-black mt-1">
                    ${(summary?.top_services?.[0]?.cost || 0).toFixed(2)}
                  </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
                  <div className="text-xs font-bold uppercase tracking-wide text-black mb-1">Sub-accounts</div>
                  <div className="text-2xl font-bold text-green-800">{ct?.sub_accounts?.length || 0}</div>
                  <div className="text-xs font-semibold text-black mt-1">tracked accounts</div>
                </div>
              </div>

              {/* Daily trend chart */}
              {summary?.daily_trend?.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 mb-5">
                  <h3 className="text-sm font-bold text-black mb-4">Daily Cost Trend</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={summary.daily_trend} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <XAxis dataKey="date" tick={{ fill: "#000000", fontSize: 10, fontWeight: 600 }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fill: "#000000", fontSize: 10, fontWeight: 600 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        cursor={{ fill: "rgba(15,45,94,0.08)" }}
                        contentStyle={{ background: "white", border: "2px solid #0f2d5e", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}
                        labelStyle={{ color: "#000000", fontWeight: 700, fontSize: 12 }}
                        formatter={(v: any) => [`$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "Cost"]}
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

              {/* Account cost breakdown */}
              <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
                <div className="px-5 py-3 bg-gray-100 border-b-2 border-gray-300 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-900" />
                    <span className="text-sm font-bold text-black">Account Cost Breakdown</span>
                  </div>
                  <span className="text-xs font-bold text-black">{summary?.per_account?.length || 0} accounts</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      {["Account", "Account ID", "Cost (USD)", "% of Total", ""].map((h) => (
                        <th key={h} className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(summary?.per_account || []).map((acc: any) => {
                      const pct = summary.total_cost > 0 ? (acc.cost / summary.total_cost) * 100 : 0;
                      const subAcc = ct?.sub_accounts?.find((s: any) => s.aws_account_id === acc.aws_account_id);
                      return (
                        <tr key={acc.aws_account_id}
                          className="border-b border-gray-200 hover:bg-blue-50 transition">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-blue-900 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                                {(acc.account_name || "?")[0].toUpperCase()}
                              </div>
                              <span className="text-sm font-bold text-black">{acc.account_name || "Unknown"}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-xs font-mono font-semibold text-black">{acc.aws_account_id}</td>
                          <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">
                            ${acc.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-blue-900" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs font-bold text-black">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {subAcc && (
                              <Link href={`/dashboard/${ctId}/account/${subAcc.id}`}
                                className="flex items-center gap-1 text-xs font-bold text-blue-900 hover:text-orange-600 transition">
                                View Details <ChevronRight className="w-3 h-3" />
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
        </main>
      </div>
    </div>
  );
}
