"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { ChevronRight, DollarSign, RefreshCw, X, Users, Tag, CheckSquare, Square, Cloud, Plus, Trash2 } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie,
} from "recharts";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");
const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9","#27ae60","#e67e22","#16a085"];

type ChartType = "bar" | "line" | "area" | "pie";
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar",  label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie",  label: "Pie" },
];

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

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[160px]">
      <p className="text-xs font-bold text-black mb-2 border-b border-gray-100 pb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey || p.name} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: p.color || p.fill }} />
            <span className="text-xs text-black truncate max-w-[120px]">{p.dataKey || p.name}</span>
          </div>
          <span className="text-xs font-bold font-mono text-blue-900">{fmt(p.value || 0)}</span>
        </div>
      ))}
    </div>
  );
};

const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const PRESETS = [
  { label: "This Month", fn: () => { const n=new Date(); return { start: fmtDate(new Date(n.getFullYear(),n.getMonth(),1)), end: fmtDate(n) }; }},
  { label: "Last Month", fn: () => getLastMonth() },
  { label: "Last 7d", fn: () => { const n=new Date(); const s=new Date(n); s.setDate(s.getDate()-6); return { start: fmtDate(s), end: fmtDate(n) }; }},
  { label: "Last 30d", fn: () => { const n=new Date(); const s=new Date(n); s.setDate(s.getDate()-29); return { start: fmtDate(s), end: fmtDate(n) }; }},
];

interface Resource { resource_id: string; service: string; region: string; account_id?: string; }

export default function BusinessDetailPage() {
  const { id: verticalId, bizId } = useParams<{ id: string; bizId: string }>();
  const router = useRouter();
  const { token } = useAuthStore();
  const headers = { Authorization: `Bearer ${token}` };

  const lm = getLastMonth();
  const [startDate, setStartDate] = useState(lm.start);
  const [endDate, setEndDate] = useState(lm.end);
  const [activePreset, setActivePreset] = useState("Last Month");

  const [vertical, setVertical] = useState<any>(null);
  const [business, setBusiness] = useState<any>(null);
  const [allVerticals, setAllVerticals] = useState<{id: string; name: string}[]>([]);
  const [costData, setCostData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Owner modal
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [editVerticalId, setEditVerticalId] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingCostType, setSavingCostType] = useState(false);

  // Billing tag modal
  const [tagModal, setTagModal] = useState<{ accountId: string; accountName: string } | null>(null);
  const [billingValue, setBillingValue] = useState("");
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
  const [loadingRes, setLoadingRes] = useState(false);
  const [serviceFilter, setServiceFilter] = useState("");
  const [tagging, setTagging] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [hiddenAccounts, setHiddenAccounts] = useState<Set<string>>(new Set());

  // ── Azure mapping state ───────────────────────────────────────────
  const [azureMappings, setAzureMappings] = useState<any[]>([]);
  const [showAzureModal, setShowAzureModal] = useState(false);
  const [azureSubscriptions, setAzureSubscriptions] = useState<any[]>([]);
  const [azureResourceGroups, setAzureResourceGroups] = useState<any[]>([]);
  const [azureTagKeys, setAzureTagKeys] = useState<string[]>([]);
  const [azureTowers, setAzureTowers] = useState<any[]>([]);
  const [mappingForm, setMappingForm] = useState({
    control_tower_id: "",
    mapping_type: "subscription",
    subscription_id: "",
    subscription_name: "",
    resource_group: "",
    tag_key: "",
    tag_value: "",
  });
  const [savingMapping, setSavingMapping] = useState(false);

  const loadAzureMappings = async () => {
    try {
      const res = await axios.get(`${BASE}/api/azure-costs/mappings/${bizId}`, { headers });
      setAzureMappings(res.data);
    } catch {}
  };

  const loadAzureMeta = async () => {
    try {
      const [towersRes, subsRes, tagKeysRes] = await Promise.all([
        axios.get(`${BASE}/api/towers/`, { headers }),
        axios.get(`${BASE}/api/azure-costs/meta/subscriptions`, { headers }),
        axios.get(`${BASE}/api/azure-costs/tag-keys`, { headers }),
      ]);
      const azTowers = (towersRes.data as any[]).filter((t) => t.cloud_provider === "azure");
      setAzureTowers(azTowers);
      setAzureSubscriptions(subsRes.data);
      setAzureTagKeys(tagKeysRes.data);
      if (azTowers.length > 0) setMappingForm((f) => ({ ...f, control_tower_id: azTowers[0].id }));
    } catch {}
  };

  const loadResourceGroups = async (subscriptionId: string) => {
    try {
      const res = await axios.get(`${BASE}/api/azure-costs/meta/resource-groups`, {
        headers, params: { subscription_id: subscriptionId },
      });
      setAzureResourceGroups(res.data);
    } catch {}
  };

  const saveAzureMapping = async () => {
    setSavingMapping(true);
    try {
      await axios.post(`${BASE}/api/azure-costs/mappings`, {
        business_id: bizId,
        control_tower_id: mappingForm.control_tower_id,
        mapping_type: mappingForm.mapping_type,
        subscription_id: mappingForm.subscription_id || null,
        subscription_name: mappingForm.subscription_name || null,
        resource_group: mappingForm.mapping_type === "resource_group" ? mappingForm.resource_group : null,
        tag_key: mappingForm.mapping_type === "tag" ? mappingForm.tag_key : null,
        tag_value: mappingForm.mapping_type === "tag" ? mappingForm.tag_value : null,
      }, { headers });
      setShowAzureModal(false);
      await loadAzureMappings();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Failed to save mapping");
    } finally { setSavingMapping(false); }
  };

  const deleteAzureMapping = async (mappingId: string) => {
    if (!confirm("Remove this Azure mapping?")) return;
    try {
      await axios.delete(`${BASE}/api/azure-costs/mappings/${mappingId}`, { headers });
      await loadAzureMappings();
    } catch {}
  };

  const toggleAccountViz = (id: string) => {
    setHiddenAccounts((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const load = async (start = startDate, end = endDate) => {
    setLoading(true);
    try {
      const [vertsRes, bizRes, costRes] = await Promise.all([
        axios.get(`${BASE}/api/verticals/`, { headers }),
        axios.get(`${BASE}/api/verticals/businesses/${bizId}`, { headers }),
        axios.get(`${BASE}/api/verticals/${verticalId}/businesses/${bizId}/cost`, {
          headers,
          params: { granularity: "monthly", start_date: start, end_date: end },
        }),
      ]);
      const allVerts = vertsRes.data as any[];
      setAllVerticals(allVerts.map((v: any) => ({ id: v.id, name: v.name })));
      const v = allVerts.find((x: any) => x.id === verticalId);
      setVertical(v || null);
      setBusiness(bizRes.data);
      setCostData(costRes.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); loadAzureMappings(); }, [bizId]); // eslint-disable-line

  const applyPreset = (preset: typeof PRESETS[0]) => {
    const r = preset.fn();
    setStartDate(r.start);
    setEndDate(r.end);
    setActivePreset(preset.label);
    load(r.start, r.end);
  };

  const saveOwner = async () => {
    if (!ownerName.trim()) return;
    setSaving(true);
    try {
      const patch: any = { owner_name: ownerName.trim() };
      if (editVerticalId && editVerticalId !== verticalId) patch.vertical_id = editVerticalId;
      await axios.patch(`${BASE}/api/verticals/businesses/${bizId}`, patch, { headers });
      setShowAddOwner(false);
      setOwnerName("");
      // If vertical changed, navigate to the new vertical's page
      if (editVerticalId && editVerticalId !== verticalId) {
        router.push(`/verticals/${editVerticalId}/business/${bizId}`);
      } else {
        await load();
      }
    } finally { setSaving(false); }
  };

  const toggleCostType = async () => {
    const newType = business?.cost_type === "account" ? "resource" : "account";
    setSavingCostType(true);
    try {
      await axios.patch(`${BASE}/api/verticals/businesses/${bizId}`, { cost_type: newType }, { headers });
      await load();
    } finally { setSavingCostType(false); }
  };

  // Open billing tag modal for an account
  const openTagModal = async (accountId: string, accountName: string) => {
    setTagModal({ accountId, accountName });
    setBillingValue("");
    setResources([]);
    setSelectedResources(new Set());
    setServiceFilter("");
    setLoadingRes(true);
    try {
      const res = await axios.get(`${BASE}/api/reports/meta/resources-by-account`, {
        headers, params: { account_id: accountId },
      });
      const list = (res.data as Resource[]).map((r) => ({ ...r, account_id: accountId }));
      setResources(list);
      setSelectedResources(new Set(list.map((r) => r.resource_id)));
    } finally { setLoadingRes(false); }
  };

  const filteredRes = resources.filter((r) =>
    !serviceFilter || r.service.toLowerCase().includes(serviceFilter.toLowerCase())
  );

  const applyBillingTag = async () => {
    if (!tagModal || !billingValue.trim() || selectedResources.size === 0) return;
    setTagging(true);
    try {
      const res = await axios.post(`${BASE}/api/verticals/bulk-tag-account`, {
        vertical_id: verticalId,
        business_id: bizId,
        billing_tag: billingValue.trim(),
        aws_account_id: tagModal.accountId,
        resource_ids: Array.from(selectedResources),
        cloud_provider: "aws",
      }, { headers });
      alert(`✓ Tagged ${res.data.tagged} resources with Billing=${billingValue.trim()}`);
      setTagModal(null);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Tagging failed");
    } finally { setTagging(false); }
  };

  const perAccount: any[] = costData?.per_account || [];
  const totalCost = costData?.total_cost || 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-black mb-5">
        <button onClick={() => router.push("/verticals")} className="hover:text-blue-900">Verticals</button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <button onClick={() => router.push(`/verticals/${verticalId}`)} className="hover:text-blue-900">{vertical?.name}</button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <span className="font-bold text-black">{business?.name}</span>
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold"
            style={{ background: business?.color || vertical?.color || "#0f2d5e" }}>
            {business?.name?.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-bold text-black">{business?.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {business?.owner_name
                ? <span className="text-xs text-black">Owner: <span className="font-semibold">{business.owner_name}</span></span>
                : <span className="text-xs text-gray-400">No owner</span>}
              <button onClick={() => { setOwnerName(business?.owner_name || ""); setEditVerticalId(verticalId); setShowAddOwner(true); }}
                className="text-xs font-bold text-blue-900 hover:underline flex items-center gap-1">
                <Users className="w-3 h-3" />{business?.owner_name ? "Edit" : "Add Owner"}
              </button>
              <button
                onClick={toggleCostType}
                disabled={savingCostType}
                title={business?.cost_type === "account" ? "Switch to resource-level cost" : "Switch to account-level cost"}
                className={`text-xs font-bold px-2 py-0.5 rounded border transition ${
                  business?.cost_type === "account"
                    ? "bg-green-100 text-green-800 border-green-300 hover:bg-green-200"
                    : "bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200"
                }`}>
                {savingCostType ? "..." : business?.cost_type === "account" ? "Account-level ⇄" : "Resource-level ⇄"}
              </button>
            </div>
          </div>
        </div>

        {/* Date filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p)}
                className={`px-3 py-2 text-xs font-bold transition border-l border-gray-300 first:border-l-0 ${
                  activePreset === p.label ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setActivePreset(""); }}
            className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          <span className="text-xs text-black">to</span>
          <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setActivePreset(""); }}
            className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          <button onClick={() => load(startDate, endDate)}
            className="px-3 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition">
            Apply
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-blue-900" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-black">Total Cost</span>
          </div>
          <div className="text-2xl font-bold text-blue-900 font-mono">{fmt(totalCost)}</div>
          <div className="text-xs text-black mt-0.5">{startDate} → {endDate}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-1">Accounts</div>
          <div className="text-2xl font-bold text-blue-900">{perAccount.length}</div>
          <div className="text-xs text-black mt-0.5">{costData?.resource_count || 0} tagged resources</div>
        </div>
      </div>

      {/* ── Chart Panel ─────────────────────────────────────────────── */}
      {!loading && perAccount.length > 0 && (() => {
        const visibleAccounts = perAccount.filter((a: any) => !hiddenAccounts.has(a.aws_account_id));
        const barData = visibleAccounts.map((a: any, i: number) => ({
          name: a.account_name || a.aws_account_id,
          cost: a.cost,
          fill: COLORS[perAccount.indexOf(a) % COLORS.length],
        }));
        const pieData = perAccount.map((a: any, i: number) => ({
          name: a.account_name || a.aws_account_id,
          value: a.cost,
          fill: COLORS[i % COLORS.length],
        }));
        return (
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm mb-5 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3"
              style={{ background: "linear-gradient(135deg, #f8fafc 0%, #f1f4f9 100%)" }}>
              <div>
                <h2 className="text-sm font-bold text-black">Cost by Account</h2>
                <p className="text-[10px] text-gray-500 mt-0.5">{startDate} → {endDate}</p>
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

            {/* Account toggles (not for pie) */}
            {chartType !== "pie" && (
              <div className="px-5 py-2.5 border-b border-gray-100 flex items-center gap-2 flex-wrap" style={{ background: "#fafbfc" }}>
                {perAccount.map((a: any, i: number) => {
                  const hidden = hiddenAccounts.has(a.aws_account_id);
                  return (
                    <button key={a.aws_account_id} onClick={() => toggleAccountViz(a.aws_account_id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                        hidden ? "bg-white border-gray-200 text-gray-400" : "border-transparent text-white"
                      }`}
                      style={hidden ? {} : { background: COLORS[i % COLORS.length] }}>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hidden ? "bg-gray-300" : "bg-white/60"}`} />
                      {a.account_name || a.aws_account_id}
                    </button>
                  );
                })}
                {hiddenAccounts.size > 0 && (
                  <button onClick={() => setHiddenAccounts(new Set())} className="text-[10px] font-bold text-blue-900 hover:underline ml-1">Show all</button>
                )}
              </div>
            )}

            {/* Chart */}
            <div className="p-5">
              <ResponsiveContainer width="100%" height={260}>
                {chartType === "bar" ? (
                  <BarChart data={barData} margin={{ top: 4, right: 8, left: 8, bottom: 40 }} barCategoryGap="35%">
                    <defs>
                      {barData.map((d, i) => (
                        <linearGradient key={d.name} id={`bg-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={d.fill} stopOpacity={1} />
                          <stop offset="100%" stopColor={d.fill} stopOpacity={0.7} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#374151" }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(15,45,94,0.04)" }} />
                    <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                      {barData.map((d, i) => <Cell key={d.name} fill={`url(#bg-${i})`} />)}
                    </Bar>
                  </BarChart>
                ) : chartType === "line" ? (
                  <LineChart data={barData} margin={{ top: 4, right: 8, left: 8, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#374151" }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="cost" stroke="#0f2d5e" strokeWidth={2.5}
                      dot={({ cx, cy, index }: any) => <circle key={index} cx={cx} cy={cy} r={4} fill={barData[index]?.fill || "#0f2d5e"} strokeWidth={0} />}
                      activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                ) : chartType === "area" ? (
                  <AreaChart data={barData} margin={{ top: 4, right: 8, left: 8, bottom: 40 }}>
                    <defs>
                      <linearGradient id="area-biz" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0f2d5e" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#0f2d5e" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#374151" }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="cost" stroke="#0f2d5e" strokeWidth={2.5}
                      fill="url(#area-biz)" dot={{ r: 3, strokeWidth: 0, fill: "#0f2d5e" }} activeDot={{ r: 5, strokeWidth: 0 }} />
                  </AreaChart>
                ) : (
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} innerRadius={40}
                      dataKey="value" labelLine={false} label={PieLabel}>
                      {pieData.map((d: any, i: number) => <Cell key={d.name} fill={d.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Pie legend / summary bar */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-4 flex-wrap justify-center" style={{ background: "#f8fafc" }}>
              {(chartType === "pie" ? pieData : barData).map((d: any) => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.fill }} />
                  <span className="text-xs font-semibold text-black">{d.name}</span>
                  <span className="text-xs font-bold font-mono text-blue-900">{fmt(d.cost ?? d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Subaccount cost table */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-900" />
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm">
          <div className="px-5 py-3 border-b border-gray-200">
            <h2 className="text-sm font-bold text-black">Subaccount Cost</h2>
          </div>
          {perAccount.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-bold text-black">No cost data for this period</p>
              <p className="text-xs text-gray-500 mt-1">Tag resources with <span className="font-bold">Business={business?.name}</span> to see costs</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {["Account", "Account ID", "Cost", "% of Total", ""].map((h) => (
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
                      <td className="px-5 py-3">
                        <button
                          onClick={() => openTagModal(acc.aws_account_id, acc.account_name)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-md hover:bg-orange-50 hover:border-orange-400 text-black transition">
                          <Tag className="w-3 h-3 text-orange-600" /> Add Billing Tag
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50 border-t-2 border-gray-300">
                  <td className="px-5 py-3 text-sm font-bold text-black" colSpan={2}>Total</td>
                  <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">{fmt(totalCost)}</td>
                  <td className="px-5 py-3 text-xs font-bold text-black">100%</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Azure Cost Mapping ───────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm mt-5">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between"
          style={{ background: "linear-gradient(135deg, #e8f4fd 0%, #f0f7ff 100%)" }}>
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4" style={{ color: "#0078d4" }} />
            <h2 className="text-sm font-bold text-black">Azure Cost Mapping</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
              {azureMappings.length} mapping{azureMappings.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={() => { loadAzureMeta(); setShowAzureModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded-md transition"
            style={{ background: "#0078D4" }}>
            <Plus className="w-3.5 h-3.5" /> Add Azure Source
          </button>
        </div>

        {azureMappings.length === 0 ? (
          <div className="p-8 text-center">
            <Cloud className="w-8 h-8 mx-auto mb-2" style={{ color: "#0078d4", opacity: 0.3 }} />
            <p className="text-sm font-bold text-black">No Azure cost source mapped</p>
            <p className="text-xs text-gray-500 mt-1">Map a subscription, resource group, or tag to pull Azure costs into this business</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {["Type", "Source", "Subscription", ""].map((h) => (
                  <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {azureMappings.map((m) => (
                <tr key={m.id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                  <td className="px-5 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      m.mapping_type === "subscription" ? "bg-blue-100 text-blue-800"
                      : m.mapping_type === "resource_group" ? "bg-purple-100 text-purple-800"
                      : m.mapping_type === "tag" ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                    }`}>
                      {m.mapping_type.replace("_", " ").toUpperCase()}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-black">
                    {m.mapping_type === "subscription" && m.subscription_name}
                    {m.mapping_type === "resource_group" && m.resource_group}
                    {m.mapping_type === "tag" && `${m.tag_key} = ${m.tag_value || "*"}`}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">{m.subscription_name || "—"}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => deleteAzureMapping(m.id)}
                      className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Owner Modal */}
      {showAddOwner && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">{business?.owner_name ? "Edit Owner" : "Add Owner"} — {business?.name}</h3>
              <button onClick={() => setShowAddOwner(false)}><X className="w-4 h-4 text-black" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Owner Name *</label>
                <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="e.g. John Doe" autoFocus />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Vertical</label>
                <select value={editVerticalId} onChange={(e) => setEditVerticalId(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none">
                  {allVerticals.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                {editVerticalId && editVerticalId !== verticalId && (
                  <p className="text-[10px] text-orange-700 font-semibold mt-1">
                    ⚠ This will move the business to <span className="font-bold">{allVerticals.find(v => v.id === editVerticalId)?.name}</span>
                  </p>
                )}
              </div>
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

      {/* Azure Mapping Modal */}
      {showAzureModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black flex items-center gap-2">
                <Cloud className="w-4 h-4" style={{ color: "#0078d4" }} /> Add Azure Cost Source
              </h3>
              <button onClick={() => setShowAzureModal(false)}><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Map By</label>
                <div className="flex gap-2">
                  {["subscription", "resource_group", "tag"].map((t) => (
                    <button key={t} onClick={() => setMappingForm((f) => ({ ...f, mapping_type: t }))}
                      className={`flex-1 py-2 text-xs font-bold rounded-md border transition ${
                        mappingForm.mapping_type === t ? "border-blue-700 bg-blue-50 text-blue-900" : "border-gray-300 text-black hover:border-blue-400"
                      }`}>
                      {t === "subscription" ? "Subscription" : t === "resource_group" ? "Resource Group" : "Tag"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Subscription</label>
                <select value={mappingForm.subscription_id}
                  onChange={(e) => {
                    const sub = azureSubscriptions.find((s) => s.subscription_id === e.target.value);
                    setMappingForm((f) => ({ ...f, subscription_id: e.target.value, subscription_name: sub?.subscription_name || "" }));
                    if (mappingForm.mapping_type === "resource_group") loadResourceGroups(e.target.value);
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-600">
                  <option value="">Select subscription...</option>
                  {azureSubscriptions.map((s) => (
                    <option key={s.subscription_id} value={s.subscription_id}>{s.subscription_name}</option>
                  ))}
                </select>
              </div>
              {mappingForm.mapping_type === "resource_group" && (
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Resource Group</label>
                  <select value={mappingForm.resource_group}
                    onChange={(e) => setMappingForm((f) => ({ ...f, resource_group: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-600">
                    <option value="">Select resource group...</option>
                    {azureResourceGroups.map((r) => (
                      <option key={r.resource_group} value={r.resource_group}>{r.resource_group}</option>
                    ))}
                  </select>
                </div>
              )}
              {mappingForm.mapping_type === "tag" && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Tag Key</label>
                    <select value={mappingForm.tag_key}
                      onChange={(e) => setMappingForm((f) => ({ ...f, tag_key: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-600">
                      <option value="">Select key...</option>
                      {azureTagKeys.map((k) => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Tag Value</label>
                    <input value={mappingForm.tag_value}
                      onChange={(e) => setMappingForm((f) => ({ ...f, tag_value: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black focus:outline-none focus:border-blue-600"
                      placeholder="e.g. prod, uat, sit" />
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAzureModal(false)}
                className="flex-1 py-2.5 border border-gray-300 rounded-lg text-xs font-bold text-black hover:bg-gray-50 transition">Cancel</button>
              <button onClick={saveAzureMapping}
                disabled={savingMapping || !mappingForm.control_tower_id || !mappingForm.subscription_id
                  || (mappingForm.mapping_type === "resource_group" && !mappingForm.resource_group)
                  || (mappingForm.mapping_type === "tag" && !mappingForm.tag_key)}
                className="flex-1 py-2.5 text-white text-xs font-bold rounded-lg transition disabled:opacity-50"
                style={{ background: "#0078D4" }}>
                {savingMapping ? "Saving..." : "Save Mapping"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Billing Tag Modal */}
      {tagModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-2xl p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div>
                <h3 className="text-sm font-bold text-black flex items-center gap-2">
                  <Tag className="w-4 h-4 text-orange-600" /> Add Billing Tag — {tagModal.accountName}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5 font-mono">{tagModal.accountId}</p>
              </div>
              <button onClick={() => setTagModal(null)}><X className="w-4 h-4 text-black" /></button>
            </div>

            {/* Billing value input */}
            <div className="mb-4 flex-shrink-0">
              <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">
                Billing Tag Value *
              </label>
              <input
                value={billingValue}
                onChange={(e) => setBillingValue(e.target.value)}
                className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                placeholder="e.g. INDOSTAR-PROD, EBS-Q1-2025"
                autoFocus
              />
              <p className="text-[10px] text-gray-500 mt-1">
                This will apply <span className="font-bold text-orange-700">Billing={billingValue || "..."}</span> tag to selected resources for future CSV reports
              </p>
            </div>

            {/* Resources list */}
            {loadingRes ? (
              <div className="flex items-center justify-center py-10">
                <RefreshCw className="w-5 h-5 animate-spin text-blue-900" />
                <span className="ml-2 text-sm text-black">Loading resources...</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <input
                      value={serviceFilter}
                      onChange={(e) => setServiceFilter(e.target.value)}
                      placeholder="Filter by service..."
                      className="border border-gray-400 rounded-md px-3 py-1.5 text-xs text-black focus:border-blue-900 outline-none w-44"
                    />
                    <span className="text-xs text-black font-semibold">
                      {filteredRes.length} resources · {selectedResources.size} selected
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedResources(new Set(filteredRes.map((r) => r.resource_id)))}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-md hover:bg-blue-50 text-black transition">
                      <CheckSquare className="w-3.5 h-3.5" /> All
                    </button>
                    <button onClick={() => setSelectedResources(new Set())}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-md hover:bg-gray-50 text-black transition">
                      <Square className="w-3.5 h-3.5" /> None
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg mb-4 min-h-0">
                  {filteredRes.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-500">No resources found for this account</div>
                  ) : (
                    <table className="w-full">
                      <thead className="sticky top-0">
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="w-10 px-3 py-2" />
                          {["Resource ID", "Service", "Region"].map((h) => (
                            <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-3 py-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRes.map((r) => {
                          const checked = selectedResources.has(r.resource_id);
                          return (
                            <tr key={r.resource_id}
                              className={`border-b border-gray-100 cursor-pointer transition ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}
                              onClick={() => setSelectedResources((prev) => { const n = new Set(prev); n.has(r.resource_id) ? n.delete(r.resource_id) : n.add(r.resource_id); return n; })}>
                              <td className="px-3 py-2">
                                {checked ? <CheckSquare className="w-4 h-4 text-blue-900" /> : <Square className="w-4 h-4 text-gray-400" />}
                              </td>
                              <td className="px-3 py-2 text-xs font-mono font-semibold text-black">{r.resource_id}</td>
                              <td className="px-3 py-2">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900">{r.service}</span>
                              </td>
                              <td className="px-3 py-2 text-xs text-black">{r.region || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end gap-3 flex-shrink-0 border-t border-gray-200 pt-4">
              <button onClick={() => setTagModal(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
              <button
                onClick={applyBillingTag}
                disabled={tagging || !billingValue.trim() || selectedResources.size === 0}
                className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {tagging ? "Tagging..." : `Apply Billing Tag to ${selectedResources.size} Resource${selectedResources.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
