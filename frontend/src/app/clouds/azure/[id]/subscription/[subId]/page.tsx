"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import api from "@/lib/api";
import { ArrowLeft, RefreshCw } from "lucide-react";

function fmtINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SubscriptionDrillDown() {
  const { id, subId } = useParams<{ id: string; subId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subName = searchParams.get("name") || decodeURIComponent(subId);
  const startDate = searchParams.get("start") || "";
  const endDate = searchParams.get("end") || "";

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/azure-costs/resource-groups", {
        params: { subscription_id: decodeURIComponent(subId), start_date: startDate, end_date: endDate },
      });
      const data = res.data as any[];
      setRows(data);
      setTotal(data.reduce((s, r) => s + r.actual_cost, 0));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-5">
        <button onClick={() => router.back()} className="text-black hover:text-blue-900 font-medium flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <span className="text-gray-400">/</span>
        <span className="font-bold text-black">{subName}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black">{subName}</h1>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">{decodeURIComponent(subId)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{startDate} → {endDate} · Resource Group breakdown</p>
        </div>
        <button onClick={load} className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition">
          <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">Total Actual Cost</div>
          <div className="text-2xl font-bold font-mono text-orange-700">{fmtINR(total)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">Total Savings</div>
          <div className="text-2xl font-bold font-mono text-green-700">{fmtINR(rows.reduce((s, r) => s + r.savings, 0))}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">True Cost</div>
          <div className="text-2xl font-bold font-mono text-blue-900">{fmtINR(rows.reduce((s, r) => s + r.true_cost, 0))}</div>
        </div>
      </div>

      {/* Resource Groups Table */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-bold text-black">Resource Groups</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-300">
              {["#", "Resource Group", "Actual Cost", "SP Savings", "True Cost", "% of Total"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {[...Array(6)].map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-200 rounded animate-pulse" style={{ width: j === 1 ? "160px" : "90px" }} /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-sm text-gray-400">No resource groups found</td></tr>
            ) : (
              rows.map((r, i) => {
                const pct = total > 0 ? (r.actual_cost / total) * 100 : 0;
                return (
                  <tr key={i} className="border-b border-gray-100 hover:bg-blue-50 transition">
                    <td className="px-4 py-3 text-xs font-bold text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-black">{r.resource_group}</td>
                    <td className="px-4 py-3 text-sm font-mono text-orange-700">{fmtINR(r.actual_cost)}</td>
                    <td className="px-4 py-3 text-sm font-mono text-green-700">
                      {r.savings > 0 ? fmtINR(r.savings) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold font-mono text-blue-900">{fmtINR(r.true_cost)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-blue-900" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-black">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
            {!loading && rows.length > 0 && (
              <tr className="border-t-2 border-gray-300 bg-gray-50">
                <td className="px-4 py-3 text-sm font-bold text-black" colSpan={2}>Total</td>
                <td className="px-4 py-3 text-sm font-bold font-mono text-orange-700">{fmtINR(total)}</td>
                <td className="px-4 py-3 text-sm font-bold font-mono text-green-700">{fmtINR(rows.reduce((s, r) => s + r.savings, 0))}</td>
                <td className="px-4 py-3 text-sm font-bold font-mono text-blue-900">{fmtINR(rows.reduce((s, r) => s + r.true_cost, 0))}</td>
                <td className="px-4 py-3 text-xs font-bold text-black">100%</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
