"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import {
  Layers, Box, DollarSign, ChevronRight, Plus, Trash2, X, ChevronLeft, Server,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");

const GRANULARITY_OPTIONS = [
  { label: "Daily",   value: "daily" },
  { label: "Weekly",  value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9","#27ae60","#e67e22","#16a085"];

type ChartType = "stacked-bar" | "grouped-bar" | "line" | "area";
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "stacked-bar", label: "Stacked Bar" },
  { value: "grouped-bar", label: "Grouped Bar" },
  { value: "line",        label: "Line" },
  { value: "area",        label: "Area" },
];

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0);
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[160px]">
      <p className="text-xs font-bold text-black mb-2 border-b border-gray-100 pb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: p.color }} />
            <span className="text-xs text-black truncate max-w-[100px]">{p.dataKey}</span>
          </div>
          <span className="text-xs font-bold font-mono text-blue-900">{fmt(p.value || 0)}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="flex items-center justify-between gap-4 pt-1.5 mt-1 border-t border-gray-100">
          <span className="text-xs font-bold text-black">Total</span>
          <span className="text-xs font-bold font-mono text-blue-900">{fmt(total)}</span>
        </div>
      )}
    </div>
  );
};

interface AppCost {
  app_id: string; app_name: string; app_color: string;
  resource_count: number; total_cost: number;
  trend: { period: string; cost: number }[];
}

interface AppResource {
  id: string; resource_id: string; resource_name?: string;
  cloud_provider: string; aws_account_id?: string; service?: string;
}

export default function OwnerDetailPage() {
  const { id: verticalId, ownerId } = useParams<{ id: string; ownerId: string }>();
  const router = useRouter();
  const { token } = useAuthStore();
  const headers = { Authorization: `Bearer ${token}` };

  const [vertical, setVertical] = useState<{ id: string; name: string; color: string } | null>(null);
  const [owner, setOwner] = useState<{ id: string; name: string; email?: string } | null>(null);
  const [appCosts, setAppCosts] = useState<AppCost[]>([]);
  const [granularity, setGranularity] = useState("monthly");
  const [loading, setLoading] = useState(true);

  const [chartType, setChartType] = useState<ChartType>("stacked-bar");
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const toggleSeries = (name: string) => {
    setHiddenSeries((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  };

  const [showAddApp, setShowAddApp] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newAppDesc, setNewAppDesc] = useState("");
  const [newAppColor, setNewAppColor] = useState("#0f2d5e");
  const [saving, setSaving] = useState(false);

  const [activeAppId, setActiveAppId] = useState<string | null>(null);
  const [activeAppName, setActiveAppName] = useState("");
  const [resources, setResources] = useState<AppResource[]>([]);
  const [newResourceIds, setNewResourceIds] = useState("");
  const [newCloud, setNewCloud] = useState("aws");
  const [newAccountId, setNewAccountId] = useState("");
  const [newService, setNewService] = useState("");
  const [addingResource, setAddingResource] = useState(false);

  const load = async (gran = granularity) => {
    setLoading(true);
    try {
      const [vertsRes, ownersRes, costRes] = await Promise.all([
        axios.get(`${BASE}/api/verticals/`, { headers }),
        axios.get(`${BASE}/api/verticals/${verticalId}/owners`, { headers }),
        axios.get(`${BASE}/api/verticals/${verticalId}/owners/${ownerId}/cost`, {
          headers, params: { granularity: gran },
        }),
      ]);
      const v = (vertsRes.data as any[]).find((x: any) => x.id === verticalId);
      const o = (ownersRes.data as any[]).find((x: any) => x.id === ownerId);
      setVertical(v || null);
      setOwner(o || null);
      setAppCosts(costRes.data.apps || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [verticalId, ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGranularity = (g: string) => { setGranularity(g); load(g); };

  const addApp = async () => {
    if (!newAppName.trim()) return;
    setSaving(true);
    try {
      await axios.post(
        `${BASE}/api/verticals/${verticalId}/owners/${ownerId}/apps`,
        { name: newAppName.trim(), description: newAppDesc.trim() || null, color: newAppColor },
        { headers }
      );
      setNewAppName(""); setNewAppDesc(""); setNewAppColor("#0f2d5e"); setShowAddApp(false);
      await load();
    } finally { setSaving(false); }
  };

  const deleteApp = async (appId: string) => {
    if (!confirm("Delete this application and all its resources?")) return;
    await axios.delete(`${BASE}/api/verticals/apps/${appId}`, { headers });
    await load();
  };

  const openResources = async (appId: string, appName: string) => {
    setActiveAppId(appId);
    setActiveAppName(appName);
    const res = await axios.get(`${BASE}/api/verticals/apps/${appId}/resources`, { headers });
    setResources(res.data);
  };

  const addResources = async () => {
    if (!activeAppId || !newResourceIds.trim()) return;
    setAddingResource(true);
    try {
      const ids = newResourceIds.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      await axios.post(`${BASE}/api/verticals/apps/${activeAppId}/resources`, {
        resource_ids: ids,
        cloud_provider: newCloud,
        aws_account_id: newAccountId.trim() || null,
        service: newService.trim() || null,
      }, { headers });
      setNewResourceIds(""); setNewAccountId(""); setNewService("");
      const res = await axios.get(`${BASE}/api/verticals/apps/${activeAppId}/resources`, { headers });
      setResources(res.data);
      await load();
    } finally { setAddingResource(false); }
  };

  const removeResource = async (appId: string, resourceId: string) => {
    await axios.delete(`${BASE}/api/verticals/apps/${appId}/resources/${encodeURIComponent(resourceId)}`, { headers });
    const res = await axios.get(`${BASE}/api/verticals/apps/${appId}/resources`, { headers });
    setResources(res.data);
    await load();
  };

  const totalCost = appCosts.reduce((s, a) => s + a.total_cost, 0);

  const trendMap: Record<string, Record<string, number>> = {};
  appCosts.forEach((a) => {
    a.trend.forEach((t) => {
      if (!trendMap[t.period]) trendMap[t.period] = {};
      trendMap[t.period][a.app_name] = (trendMap[t.period][a.app_name] || 0) + t.cost;
    });
  });
  const chartData = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, vals]) => ({ period, ...vals }));

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-sm font-semibold text-black">Loading...</div>
  );

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 text-xs text-black mb-4">
        <button onClick={() => router.push("/verticals")} className="hover:text-blue-900">Verticals</button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <button onClick={() => router.push(`/verticals/${verticalId}`)} className="hover:text-blue-900">{vertical?.name}</button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <span className="font-bold text-black">{owner?.name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-base"
            style={{ background: vertical?.color || "#0f2d5e" }}>
            {owner?.name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black">{owner?.name}</h1>
            <p className="text-xs text-black">{owner?.email || ""} · {appCosts.length} applications</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {GRANULARITY_OPTIONS.map((g) => (
              <button key={g.value} onClick={() => handleGranularity(g.value)}
                className={`px-4 py-2 text-xs font-bold transition ${granularity === g.value ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
                {g.label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAddApp(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition">
            <Plus className="w-3.5 h-3.5" /> Add Application
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-blue-900" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-black">Total Cost</span>
          </div>
          <div className="text-2xl font-bold text-blue-900 font-mono">
            ${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <Box className="w-4 h-4 text-blue-900" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-black">Applications</span>
          </div>
          <div className="text-2xl font-bold text-blue-900 font-mono">{appCosts.length}</div>
        </div>
      </div>

      {chartData.length > 0 && (() => {
        const allSeries = appCosts.map((a) => a.app_name);
        const visibleSeries = allSeries.filter((s) => !hiddenSeries.has(s));
        return (
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm mb-6 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3"
              style={{ background: "linear-gradient(135deg, #f8fafc 0%, #f1f4f9 100%)" }}>
              <div>
                <h2 className="text-sm font-bold text-black">Cost by Application — {granularity.charAt(0).toUpperCase() + granularity.slice(1)}</h2>
                <p className="text-[10px] text-gray-500 mt-0.5">{visibleSeries.length} of {allSeries.length} applications visible</p>
              </div>
              <div className="flex border border-gray-300 rounded-md overflow-hidden">
                {CHART_TYPES.map((ct) => (
                  <button key={ct.value} onClick={() => setChartType(ct.value)}
                    className={`px-3 py-1.5 text-xs font-bold transition ${
                      chartType === ct.value ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                    }`}>
                    {ct.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Series toggles */}
            <div className="px-5 py-2.5 border-b border-gray-100 flex items-center gap-2 flex-wrap" style={{ background: "#fafbfc" }}>
              {allSeries.map((name, i) => {
                const hidden = hiddenSeries.has(name);
                return (
                  <button key={name} onClick={() => toggleSeries(name)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                      hidden ? "bg-white border-gray-200 text-gray-400" : "border-transparent text-white"
                    }`}
                    style={hidden ? {} : { background: COLORS[i % COLORS.length] }}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hidden ? "bg-gray-300" : "bg-white/60"}`} />
                    {name}
                  </button>
                );
              })}
              {hiddenSeries.size > 0 && (
                <button onClick={() => setHiddenSeries(new Set())} className="text-[10px] font-bold text-blue-900 hover:underline ml-1">Show all</button>
              )}
            </div>

            {/* Chart */}
            <div className="p-5">
              <ResponsiveContainer width="100%" height={260}>
                {chartType === "stacked-bar" ? (
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barCategoryGap="30%">
                    <defs>
                      {visibleSeries.map((name, i) => (
                        <linearGradient key={name} id={`og-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS[allSeries.indexOf(name) % COLORS.length]} stopOpacity={1} />
                          <stop offset="100%" stopColor={COLORS[allSeries.indexOf(name) % COLORS.length]} stopOpacity={0.75} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(15,45,94,0.04)" }} />
                    {visibleSeries.map((name, i) => (
                      <Bar key={name} dataKey={name} stackId="a" fill={`url(#og-${i})`}
                        radius={i === visibleSeries.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                ) : chartType === "grouped-bar" ? (
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barCategoryGap="25%" barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(15,45,94,0.04)" }} />
                    {visibleSeries.map((name) => (
                      <Bar key={name} dataKey={name} fill={COLORS[allSeries.indexOf(name) % COLORS.length]} radius={[3, 3, 0, 0]} />
                    ))}
                  </BarChart>
                ) : chartType === "line" ? (
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} />
                    {visibleSeries.map((name) => (
                      <Line key={name} type="monotone" dataKey={name}
                        stroke={COLORS[allSeries.indexOf(name) % COLORS.length]}
                        strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                    ))}
                  </LineChart>
                ) : (
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      {visibleSeries.map((name) => {
                        const color = COLORS[allSeries.indexOf(name) % COLORS.length];
                        return (
                          <linearGradient key={name} id={`oa-${allSeries.indexOf(name)}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} />
                    {visibleSeries.map((name) => {
                      const color = COLORS[allSeries.indexOf(name) % COLORS.length];
                      return (
                        <Area key={name} type="monotone" dataKey={name}
                          stroke={color} strokeWidth={2.5}
                          fill={`url(#oa-${allSeries.indexOf(name)})`}
                          dot={{ r: 3, strokeWidth: 0, fill: color }} activeDot={{ r: 5, strokeWidth: 0 }} />
                      );
                    })}
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Summary bar */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-6 flex-wrap" style={{ background: "#f8fafc" }}>
              {visibleSeries.map((name) => {
                const color = COLORS[allSeries.indexOf(name) % COLORS.length];
                const seriesTotal = chartData.reduce((s, d) => s + ((d as any)[name] || 0), 0);
                const pct = totalCost > 0 ? (seriesTotal / totalCost) * 100 : 0;
                return (
                  <div key={name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
                    <span className="text-xs font-semibold text-black">{name}</span>
                    <span className="text-xs font-bold font-mono text-blue-900">{fmt(seriesTotal)}</span>
                    <span className="text-[10px] text-gray-500">({pct.toFixed(1)}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="bg-white rounded-lg border border-gray-300 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-bold text-black">Applications</h2>
        </div>
        {appCosts.length === 0 ? (
          <div className="p-8 text-center">
            <Box className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-black">No applications yet</p>
            <p className="text-xs text-black mt-1">Add an application to start tracking costs</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {["Application", "Resources", "Total Cost", "Actions"].map((h) => (
                  <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {appCosts.map((app, i) => (
                <tr key={app.app_id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-sm font-semibold text-black">{app.app_name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-black">{app.resource_count}</td>
                  <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">
                    ${app.total_cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openResources(app.app_id, app.app_name)}
                        className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded text-xs font-bold text-black hover:border-blue-900 hover:text-blue-900 transition">
                        <Server className="w-3 h-3" /> Resources
                      </button>
                      <button onClick={() => deleteApp(app.app_id)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-600 transition">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddApp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">Add Application</h3>
              <button onClick={() => setShowAddApp(false)}><X className="w-4 h-4 text-black" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Application Name *</label>
                <input value={newAppName} onChange={(e) => setNewAppName(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="e.g. E-Commerce Website" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Description</label>
                <input value={newAppDesc} onChange={(e) => setNewAppDesc(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="Optional description" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Color</label>
                <input type="color" value={newAppColor} onChange={(e) => setNewAppColor(e.target.value)}
                  className="h-9 w-20 border border-gray-400 rounded-md cursor-pointer" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowAddApp(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={addApp} disabled={saving || !newAppName.trim()}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {saving ? "Saving..." : "Add Application"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeAppId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">Resources — {activeAppName}</h3>
              <button onClick={() => setActiveAppId(null)}><X className="w-4 h-4 text-black" /></button>
            </div>
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 mb-4">
              <p className="text-xs font-bold uppercase tracking-wide text-black mb-3">Add Resources</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Cloud</label>
                  <select value={newCloud} onChange={(e) => setNewCloud(e.target.value)}
                    className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none">
                    <option value="aws">AWS</option>
                    <option value="azure">Azure</option>
                    <option value="gcp">GCP</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Account ID</label>
                  <input value={newAccountId} onChange={(e) => setNewAccountId(e.target.value)}
                    className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                    placeholder="123456789012" />
                </div>
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Service</label>
                  <input value={newService} onChange={(e) => setNewService(e.target.value)}
                    className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                    placeholder="e.g. EC2" />
                </div>
              </div>
              <div className="mb-3">
                <label className="text-xs font-bold text-black block mb-1">Resource IDs (one per line or comma-separated)</label>
                <textarea value={newResourceIds} onChange={(e) => setNewResourceIds(e.target.value)} rows={3}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm font-mono text-black focus:border-blue-900 outline-none"
                  placeholder={"i-0abc123\ni-0def456"} />
              </div>
              <button onClick={addResources} disabled={addingResource || !newResourceIds.trim()}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {addingResource ? "Adding..." : "Add Resources"}
              </button>
            </div>
            {resources.length === 0 ? (
              <p className="text-xs text-black text-center py-4">No resources assigned yet</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {["Resource ID", "Cloud", "Account", "Service", ""].map((h) => (
                      <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resources.map((r) => (
                    <tr key={r.id} className="border-b border-gray-200 hover:bg-blue-50">
                      <td className="px-3 py-2 text-xs font-mono font-semibold text-black">{r.resource_id}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          r.cloud_provider === "aws" ? "bg-orange-100 text-orange-800" :
                          r.cloud_provider === "azure" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"
                        }`}>{r.cloud_provider.toUpperCase()}</span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-black">{r.aws_account_id || "—"}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-black">{r.service || "—"}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeResource(activeAppId, r.resource_id)}
                          className="p-1 rounded hover:bg-red-50 text-red-600 transition">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
