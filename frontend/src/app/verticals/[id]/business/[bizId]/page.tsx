"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { ChevronRight, DollarSign, RefreshCw, X, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");
const COLORS = ["#0f2d5e","#ec7211","#1d8348","#8e44ad","#1a6fa8","#c0392b","#16a085","#e67e22"];

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function getLastMonth() {
  const now = new Date();
  return {
    start: fmtDate(new Date(now.getFullYear(), now.getMonth()-1, 1)),
    end: fmtDate(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}
function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BusinessDetailPage() {
  const { id: verticalId, bizId } = useParams<{ id: string; bizId: string }>();
  const router = useRouter();
  const { token } = useAuthStore();
  const headers = { Authorization: `Bearer ${token}` };

  const lm = getLastMonth();
  const [startDate, setStartDate] = useState(lm.start);
  const [endDate, setEndDate] = useState(lm.end);
  const [granularity, setGranularity] = useState("monthly");

  const [vertical, setVertical] = useState<any>(null);
  const [business, setBusiness] = useState<any>(null);
  const [costData, setCostData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [showAddOwner, setShowAddOwner] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async (gran = granularity, start = startDate, end = endDate) => {
    setLoading(true);
    try {
      const [vertsRes, bizRes, costRes] = await Promise.all([
        axios.get(`${BASE}/api/verticals/`, { headers }),
        axios.get(`${BASE}/api/verticals/businesses/${bizId}`, { headers }),
        axios.get(`${BASE}/api/verticals/${verticalId}/businesses/${bizId}/cost`, {
          headers,
          params: { granularity: gran, start_date: start, end_date: end },
        }),
      ]);
      const v = (vertsRes.data as any[]).find((x: any) => x.id === verticalId);
      setVertical(v || null);
      setBusiness(bizRes.data);
      setCostData(costRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [bizId]); // eslint-disable-line

  const saveOwner = async () => {
    if (!ownerName.trim()) return;
    setSaving(true);
    try {
      await axios.patch(`${BASE}/api/verticals/businesses/${bizId}`,
        { name: business?.name, owner_name: ownerName.trim() },
        { headers }
      );
      setShowAddOwner(false);
      setOwnerName("");
      await load();
    } finally { setSaving(false); }
  };

  const trend = costData?.trend || [];
  const perAccount: any[] = costData?.per_account || [];
  const totalCost = costData?.total_cost || 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-black mb-4">
        <button onClick={() => router.push("/verticals")} className="hover:text-blue-900">Verticals</button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <button onClick={() => router.push(`/verticals/${verticalId}`)} className="hover:text-blue-900">{vertical?.name}</button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <span className="font-bold text-black">{business?.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-base"
            style={{ background: business?.color || vertical?.color || "#0f2d5e" }}>
            {business?.name?.charAt(0)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black">{business?.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {business?.owner_name ? (
                <span className="text-xs text-black">Owner: <span className="font-semibold">{business.owner_name}</span></span>
              ) : (
                <span className="text-xs text-gray-400">No owner</span>
              )}
              <button onClick={() => { setOwnerName(business?.owner_name || ""); setShowAddOwner(true); }}
                className="text-xs font-bold text-blue-900 hover:underline flex items-center gap-1">
                <Users className="w-3 h-3" />
                {business?.owner_name ? "Edit" : "Add Owner"}
              </button>
            </div>
          </div>
        </div>

        {/* Date controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {["daily","monthly"].map((g) => (
              <button key={g} onClick={() => { setGranularity(g); load(g, startDate, endDate); }}
                className={`px-3 py-2 text-xs font-bold transition capitalize ${granularity === g ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
                {g}
              </button>
            ))}
          </div>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          <span className="text-xs text-black">to</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {[
              { label: "This Month", fn: () => { const n=new Date(); const s=fmtDate(new Date(n.getFullYear(),n.getMonth(),1)); const e=fmtDate(n); setStartDate(s); setEndDate(e); load(granularity,s,e); }},
              { label: "Last Month", fn: () => { const r=getLastMonth(); setStartDate(r.start); setEndDate(r.end); load(granularity,r.start,r.end); }},
            ].map((p) => (
              <button key={p.label} onClick={p.fn}
                className="px-3 py-2 text-xs font-bold bg-white text-black hover:bg-gray-50 border-l border-gray-300 first:border-l-0 transition">
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={() => load(granularity, startDate, endDate)}
            className="px-3 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition">
            Apply
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-900" />
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-blue-900" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-black">Total Cost</span>
              </div>
              <div className="text-2xl font-bold text-blue-900 font-mono">{fmt(totalCost)}</div>
              <div className="text-xs text-black mt-1">{startDate} → {endDate}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">Tagged Resources</div>
              <div className="text-2xl font-bold text-blue-900">{costData?.resource_count || 0}</div>
              <div className="text-xs text-black mt-1">across {perAccount.length} accounts</div>
            </div>
          </div>

          {/* Cost trend chart */}
          {trend.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 mb-6">
              <h2 className="text-sm font-bold text-black mb-4">Cost Trend — {granularity.charAt(0).toUpperCase() + granularity.slice(1)}</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#000" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#000" }} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                  <Tooltip formatter={(v: number) => [fmt(v), "Cost"]} />
                  <Bar dataKey="cost" radius={[4,4,0,0]}>
                    {trend.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Subaccount cost table */}
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-bold text-black">Subaccount Cost Breakdown</h2>
            </div>
            {perAccount.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-bold text-black">No cost data</p>
                <p className="text-xs text-gray-500 mt-1">Tag resources with Business={business?.name} to see subaccount costs</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {["Account", "Account ID", "Cost", "% of Total"].map((h) => (
                      <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perAccount.map((acc: any, i: number) => {
                    const pct = totalCost > 0 ? (acc.cost / totalCost) * 100 : 0;
                    return (
                      <tr key={acc.aws_account_id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                              style={{ background: COLORS[i % COLORS.length] }}>
                              {(acc.account_name || "?")[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-semibold text-black">{acc.account_name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs font-mono font-semibold text-black">{acc.aws_account_id}</td>
                        <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">{fmt(acc.cost)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-blue-900" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-bold text-black">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Total row */}
                  <tr className="bg-gray-50 border-t-2 border-gray-300">
                    <td className="px-5 py-3 text-sm font-bold text-black" colSpan={2}>Total</td>
                    <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">{fmt(totalCost)}</td>
                    <td className="px-5 py-3 text-xs font-bold text-black">100%</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Add/Edit Owner Modal */}
      {showAddOwner && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">{business?.owner_name ? "Edit Owner" : "Add Owner"}</h3>
              <button onClick={() => setShowAddOwner(false)}><X className="w-4 h-4 text-black" /></button>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Owner Name *</label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
                className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                placeholder="e.g. John Doe" autoFocus />
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowAddOwner(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={saveOwner} disabled={saving || !ownerName.trim()}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
