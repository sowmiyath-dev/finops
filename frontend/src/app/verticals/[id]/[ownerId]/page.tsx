"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import {
  Layers, Box, DollarSign, ChevronRight, Plus, Trash2, X, ChevronLeft, Server,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const GRANULARITY_OPTIONS = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

const COLORS = ["#0f2d5e", "#1d8348", "#ec7211", "#8e44ad", "#1a6fa8", "#c0392b", "#16a085", "#e67e22"];

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

  // Add App modal
  const [showAddApp, setShowAddApp] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newAppDesc, setNewAppDesc] = useState("");
  const [newAppColor, setNewAppColor] = useState("#0f2d5e");
  const [saving, setSaving] = useState(false);

  // Add Resource modal
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
        axios.get(`${API}/api/verticals/`, { headers }),
        axios.get(`${API}/api/verticals/${verticalId}/owners`, { headers }),
        axios.get(`${API}/api/verticals/${verticalId}/owners/${ownerId}/cost`, {
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

  useEffect(() => { load(); }, [verticalId, ownerId]);

  const handleGranularity = (g: string) => { setGranularity(g); load(g); };

  const addApp = async () => {
    if (!newAppName.trim()) return;
    setSaving(true);
    try {
      await axios.post(
        `${API}/api/verticals/${verticalId}/owners/${ownerId}/apps`,
        { name: newAppName.trim(), description: newAppDesc.trim() || null, color: newAppColor },
        { headers }
      );
      setNewAppName(""); setNewAppDesc(""); setNewAppColor("#0f2d5e"); setShowAddApp(false);
      await load();
    } finally { setSaving(false); }
  };

  const deleteApp = async (appId: string) => {
    if (!confirm("Delete this application and all its resources?")) return;
    await axios.delete(`${API}/api/verticals/apps/${appId}`, { headers });
    await load();
  };

  const openResources = async (appId: string, appName: string) => {
    setActiveAppId(appId);
    setActiveAppName(appName);
    const res = await axios.get(`${API}/api/verticals/apps/${appId}/resources`, { headers });
    setResources(res.data);
  };

  const addResources = async () => {
    if (!activeAppId || !newResourceIds.trim()) return;
    setAddingResource(true);
    try {
      const ids = newResourceIds.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      await axios.post(`${API}/api/verticals/apps/${activeAppId}/resources`, {
        resource_ids: ids,
        cloud_provider: newCloud,
        aws_account_id: newAccountId.trim() || null,
        service: newService.trim() || null,
      }, { headers });
      setNewResourceIds(""); setNewAccountId(""); setNewService("");
      const res = await axios.get(`${API}/api/verticals/apps/${activeAppId}/resources`, { headers });
      setResources(res.data);
      await load();
    } finally { setAddingResource(false); }
  };

  const removeResource = async (appId: string, resourceId: string) => {
    await axios.delete(`${API}/api/verticals/apps/${appId}/resources/${encodeURIComponent(resourceId)}`, { headers });
    const res = await axios.get(`${API}/api/verticals/apps/${appId}/resources`, { headers });
    setResources(res.data);
    await load();
  };

  const totalCost = appCosts.reduce((s, a) => s + a.total_cost, 0);

  // Build chart data
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
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-black mb-4">
        <button onClick={() => router.push("/verticals")} className="hover:text-blue-900">Verticals</button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <button onClick={() => router.push(`/verticals/${verticalId}`)} className="hover:text-blue-900">{vertical?.name}</button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <span className="font-bold text-black">{owner?.name}</span>
      </div>

      {/* Header */}
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

      {/* KPI */}
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

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 mb-6">
          <h2 className="text-sm font-bold text-black mb-4">
            Cost by Application — {granularity.charAt(0).toUpperCase() + granularity.slice(1)}
          </h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#000" }} />
              <YAxis tick={{ fontSize: 11, fill: "#000" }} tickFormatter={(v) => `$${v.toLocaleString()}`} />
              <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, ""]} />
              <Legend />
              {appCosts.map((a, i) => (
                <Bar key={a.app_id} dataKey={a.app_name} stackId="a" fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Applications table */}
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

      {/* Add Application Modal */}
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

      {/* Resources Modal */}
      {activeAppId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">Resources — {activeAppName}</h3>
              <button onClick={() => setActiveAppId(null)}><X className="w-4 h-4 text-black" /></button>
            </div>

            {/* Add resources */}
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
                  placeholder="i-0abc123&#10;i-0def456" />
              </div>
              <button onClick={addResources} disabled={addingResource || !newResourceIds.trim()}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {addingResource ? "Adding..." : "Add Resources"}
              </button>
            </div>

            {/* Resource list */}
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
