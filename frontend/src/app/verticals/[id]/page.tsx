"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import {
  Layers, Users, Box, DollarSign, ChevronRight, Plus, Trash2, X,
  ChevronLeft, Tag, Server, CheckSquare, Square, RefreshCw,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");

const GRANULARITY_OPTIONS = [
  { label: "Daily",   value: "daily" },
  { label: "Weekly",  value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

const COLORS = ["#0f2d5e", "#1d8348", "#ec7211", "#8e44ad", "#1a6fa8", "#c0392b"];

interface Owner { id: string; name: string; email?: string; }
interface OwnerCost {
  owner_id: string; owner_name: string; app_count: number;
  resource_count: number; total_cost: number;
  trend: { period: string; cost: number }[];
}
interface Tower { id: string; name: string; sub_accounts: { aws_account_id: string; account_name: string }[]; }
interface Account { aws_account_id: string; account_name: string; ct_name: string; ct_id: string; }
interface Resource { resource_id: string; service: string; region: string; account_id?: string; }

export default function VerticalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuthStore();
  const headers = { Authorization: `Bearer ${token}` };

  const [vertical, setVertical] = useState<{ id: string; name: string; color: string } | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [businesses, setBusinesses] = useState<{id:string;name:string;color:string;owner_name?:string;owner_email?:string}[]>([]);
  const [costData, setCostData] = useState<OwnerCost[]>([]);
  const [taggedCount, setTaggedCount] = useState(0);
  const [taggedAccounts, setTaggedAccounts] = useState<{aws_account_id: string; account_name: string; resource_count: number}[]>([]);
  const [granularity, setGranularity] = useState("monthly");
  const [dateMode, setDateMode] = useState<"preset" | "custom">("preset");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [loading, setLoading] = useState(true);

  // Add Business modal
  const [showAddBusiness, setShowAddBusiness] = useState(false);
  const [newBizName, setNewBizName] = useState("");
  const [newBizOwner, setNewBizOwner] = useState("");
  const [newBizEmail, setNewBizEmail] = useState("");
  const [savingBiz, setSavingBiz] = useState(false);

  // Add Owner modal
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // Bulk tag modal
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [selectedBusiness, setSelectedBusiness] = useState<string>("");
  const [accountResources, setAccountResources] = useState<Resource[]>([]);
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
  const [loadingResources, setLoadingResources] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [serviceFilter, setServiceFilter] = useState("");

  const load = async (gran = granularity, start?: string, end?: string) => {
    setLoading(true);
    try {
      const params: any = { granularity: gran };
      if (start) params.start_date = start;
      if (end) params.end_date = end;
      // Run cost + owners in parallel, tagged accounts separately (less critical)
      const [ownersRes, costRes, bizRes] = await Promise.all([
        axios.get(`${BASE}/api/verticals/${id}/owners`, { headers }),
        axios.get(`${BASE}/api/verticals/${id}/cost`, { headers, params }),
        axios.get(`${BASE}/api/verticals/${id}/businesses`, { headers }),
      ]);
      setOwners(ownersRes.data);
      setCostData(costRes.data.owners || []);
      setTaggedCount(costRes.data.tagged_resource_count || 0);
      setBusinesses(bizRes.data || []);
      // Load vertical name + tagged accounts in background
      axios.get(`${BASE}/api/verticals/`, { headers }).then((r) => {
        const v = (r.data as any[]).find((x: any) => x.id === id);
        setVertical(v || null);
      });
      axios.get(`${BASE}/api/verticals/${id}/tagged-accounts`, { headers }).then((r) => {
        setTaggedAccounts(r.data || []);
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGranularity = (g: string) => { setGranularity(g); load(g, customStart || undefined, customEnd || undefined); };

  const handleCustomDate = () => {
    if (customStart && customEnd) load(granularity, customStart, customEnd);
  };

  const addBusiness = async () => {
    if (!newBizName.trim()) return;
    setSavingBiz(true);
    try {
      await axios.post(`${BASE}/api/verticals/${id}/businesses`,
        { name: newBizName.trim(), owner_name: newBizOwner.trim() || null, owner_email: newBizEmail.trim() || null },
        { headers }
      );
      setNewBizName(""); setNewBizOwner(""); setNewBizEmail(""); setShowAddBusiness(false);
      await load();
    } finally { setSavingBiz(false); }
  };

  const addOwner = async () => {
    if (!newOwnerName.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${BASE}/api/verticals/${id}/owners`,
        { name: newOwnerName.trim(), email: newOwnerEmail.trim() || null },
        { headers }
      );
      setNewOwnerName(""); setNewOwnerEmail(""); setShowAddOwner(false);
      await load();
    } finally { setSaving(false); }
  };

  const deleteOwner = async (ownerId: string) => {
    if (!confirm("Delete this owner and all their applications?")) return;
    await axios.delete(`${BASE}/api/verticals/${id}/owners/${ownerId}`, { headers });
    await load();
  };

  // Bulk tag handlers
  const openBulkTag = async () => {
    setShowBulkTag(true);
    setSelectedAccounts(new Set());
    setSelectedBusiness("");
    setAccountResources([]);
    setSelectedResources(new Set());
    setServiceFilter("");
    // Load towers with sub-accounts for CT hierarchy
    const res = await axios.get(`${BASE}/api/towers/`, { headers });
    const towersData: Tower[] = res.data;
    setTowers(towersData);
    // Flatten accounts with CT info
    const flat: Account[] = towersData.flatMap((t) =>
      (t.sub_accounts || []).map((s) => ({
        aws_account_id: s.aws_account_id,
        account_name: s.account_name,
        ct_name: t.name,
        ct_id: t.id,
      }))
    );
    setAccounts(flat);
  };

  const loadAccountResources = async (accountIds: Set<string>) => {
    if (accountIds.size === 0) return;
    setLoadingResources(true);
    setSelectedResources(new Set());
    try {
      const results = await Promise.all(
        Array.from(accountIds).map((aid) =>
          axios.get(`${BASE}/api/reports/meta/resources-by-account`, {
            headers,
            params: { account_id: aid },
          }).then((r) => (r.data as Resource[]).map((res) => ({ ...res, account_id: aid })))
        )
      );
      // Merge and deduplicate by resource_id
      const merged = new Map<string, Resource>();
      results.flat().forEach((r) => merged.set(r.resource_id, r));
      setAccountResources(Array.from(merged.values()));
    } finally {
      setLoadingResources(false);
    }
  };

  const toggleAccount = (aid: string) => {
    setSelectedAccounts((prev) => {
      const next = new Set(prev);
      next.has(aid) ? next.delete(aid) : next.add(aid);
      return next;
    });
  };

  const toggleResource = (rid: string) => {
    setSelectedResources((prev) => {
      const next = new Set(prev);
      next.has(rid) ? next.delete(rid) : next.add(rid);
      return next;
    });
  };

  const filteredResources = accountResources.filter((r) =>
    !serviceFilter || r.service.toLowerCase().includes(serviceFilter.toLowerCase())
  );

  const selectAll = () => setSelectedResources(new Set(filteredResources.map((r) => r.resource_id)));
  const clearAll = () => setSelectedResources(new Set());

  const applyBulkTag = async () => {
    if (selectedAccounts.size === 0 || selectedResources.size === 0) return;
    setTagging(true);
    try {
      // Group selected resources by their account_id
      const byAccount = new Map<string, string[]>();
      accountResources
        .filter((r) => selectedResources.has(r.resource_id))
        .forEach((r) => {
          const aid = r.account_id || Array.from(selectedAccounts)[0];
          if (!byAccount.has(aid)) byAccount.set(aid, []);
          byAccount.get(aid)!.push(r.resource_id);
        });

      let totalTagged = 0;
      for (const [aid, rids] of byAccount.entries()) {
        const res = await axios.post(`${BASE}/api/verticals/bulk-tag-account`, {
          vertical_id: id,
          business_id: selectedBusiness || null,
          aws_account_id: aid,
          resource_ids: rids,
          cloud_provider: "aws",
        }, { headers });
        totalTagged += res.data.tagged;
      }
      alert(`✓ Tagged ${totalTagged} resources with Vertical=${vertical?.name}${selectedBusiness ? ` + Business tag` : ""}`);
      setShowBulkTag(false);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Tagging failed");
    } finally {
      setTagging(false);
    }
  };

  const totalCost = costData.reduce((s, o) => s + o.total_cost, 0);
  const unassigned = costData.find((c) => c.owner_id === "unassigned");
  const assignedOwners = costData.filter((c) => c.owner_id !== "unassigned");

  const trendMap: Record<string, Record<string, number>> = {};
  costData.forEach((o) => {
    o.trend.forEach((t) => {
      if (!trendMap[t.period]) trendMap[t.period] = {};
      trendMap[t.period][o.owner_name] = (trendMap[t.period][o.owner_name] || 0) + t.cost;
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
        <button onClick={() => router.push("/verticals")} className="hover:text-blue-900 flex items-center gap-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Verticals
        </button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <span className="font-bold text-black">{vertical?.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: vertical?.color || "#0f2d5e" }}>
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black">{vertical?.name}</h1>
            <p className="text-xs text-black">{owners.length} owners · {assignedOwners.reduce((s, o) => s + o.app_count, 0)} applications</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Granularity */}
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {GRANULARITY_OPTIONS.map((g) => (
              <button key={g.value} onClick={() => handleGranularity(g.value)}
                className={`px-4 py-2 text-xs font-bold transition ${granularity === g.value ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
                {g.label}
              </button>
            ))}
          </div>

          {/* Date mode toggle */}
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            <button onClick={() => { setDateMode("preset"); setCustomStart(""); setCustomEnd(""); load(granularity); }}
              className={`px-3 py-2 text-xs font-bold transition ${dateMode === "preset" ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
              Preset
            </button>
            <button onClick={() => setDateMode("custom")}
              className={`px-3 py-2 text-xs font-bold transition ${dateMode === "custom" ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
              Custom
            </button>
          </div>

          {/* Custom date inputs */}
          {dateMode === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
              <span className="text-xs text-black font-semibold">to</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
              <button onClick={handleCustomDate} disabled={!customStart || !customEnd}
                className="px-3 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                Apply
              </button>
            </div>
          )}

          <button onClick={openBulkTag}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-md transition">
            <Tag className="w-3.5 h-3.5" /> Tag Resources by Account
          </button>
          <button onClick={() => setShowAddBusiness(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-md transition">
            <Plus className="w-3.5 h-3.5" /> Add Business
          </button>
          <button onClick={() => setShowAddOwner(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition">
            <Plus className="w-3.5 h-3.5" /> Add Owner
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Cost",       value: `$${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign },
          { label: "Owners",           value: owners.length, icon: Users },
          { label: "Applications",     value: assignedOwners.reduce((s, o) => s + o.app_count, 0), icon: Box },
          { label: "Tagged Resources", value: taggedCount, icon: Tag },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <k.icon className="w-4 h-4 text-blue-900" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-black">{k.label}</span>
            </div>
            <div className="text-2xl font-bold text-blue-900 font-mono">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Tag info banner */}
      {taggedCount > 0 && (
        <div className="bg-orange-50 border border-orange-200 border-l-4 border-l-orange-500 rounded-lg px-4 py-3 mb-6 flex items-center gap-2">
          <Tag className="w-4 h-4 text-orange-600 flex-shrink-0" />
          <p className="text-xs font-semibold text-orange-800">
            {taggedCount} resource{taggedCount > 1 ? "s" : ""} tagged with <span className="font-bold">Vertical = {vertical?.name}</span> are included in this vertical's cost.
          </p>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 mb-6">
          <h2 className="text-sm font-bold text-black mb-4">Cost by Owner — {granularity.charAt(0).toUpperCase() + granularity.slice(1)}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#000" }} />
              <YAxis tick={{ fontSize: 11, fill: "#000" }} tickFormatter={(v) => `$${v.toLocaleString()}`} />
              <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, ""]} />
              {costData.map((o, i) => (
                <Bar key={o.owner_id} dataKey={o.owner_name} stackId="a" fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Businesses */}
      {businesses.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm mb-6">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-black">Businesses ({businesses.length})</h2>
            <p className="text-xs text-gray-500">Tag resources with <span className="font-bold">Business=name</span> to see cost here</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
            {businesses.map((b) => (
              <div key={b.id}
                className="rounded-lg border border-gray-200 p-3 hover:shadow-md hover:border-blue-900 transition cursor-pointer"
                style={{ borderLeft: `4px solid ${b.color || vertical?.color || "#0f2d5e"}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-black">{b.name}</span>
                </div>
                {b.owner_name && (
                  <div className="text-xs text-gray-500">Owner: {b.owner_name}</div>
                )}
                <div className="text-[10px] text-gray-400 mt-1 font-mono">Business={b.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Owners table */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-bold text-black">Owners</h2>
        </div>
        {owners.length === 0 && !unassigned ? (
          <div className="p-8 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-black">No owners yet</p>
            <p className="text-xs text-black mt-1">Add an owner or tag resources with Vertical={vertical?.name}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {["Owner", "Email", "Applications", "Resources", "Total Cost", ""].map((h) => (
                  <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {owners.map((owner) => {
                const cd = assignedOwners.find((c) => c.owner_id === owner.id);
                return (
                  <tr key={owner.id} className="border-b border-gray-200 hover:bg-blue-50 transition cursor-pointer"
                    onClick={() => router.push(`/verticals/${id}/${owner.id}`)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                          style={{ background: vertical?.color || "#0f2d5e" }}>
                          {owner.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-semibold text-black">{owner.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-black">{owner.email || "—"}</td>
                    <td className="px-5 py-3 text-sm font-semibold text-black">{cd?.app_count ?? 0}</td>
                    <td className="px-5 py-3 text-sm font-semibold text-black">{cd?.resource_count ?? 0}</td>
                    <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">
                      ${(cd?.total_cost ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <ChevronRight className="w-4 h-4 text-blue-900" />
                        <button onClick={(e) => { e.stopPropagation(); deleteOwner(owner.id); }}
                          className="p-1 rounded hover:bg-red-50 text-red-600 transition">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {unassigned && (
                <tr className="border-b border-gray-200 bg-orange-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center bg-orange-500 text-white">
                        <Tag className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-sm font-semibold text-black">Unassigned (via Tag)</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-300">
                        Vertical = {vertical?.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm text-black">—</td>
                  <td className="px-5 py-3 text-sm text-black">—</td>
                  <td className="px-5 py-3 text-sm font-semibold text-black">{unassigned.resource_count}</td>
                  <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">
                    ${unassigned.total_cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-3" />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Tagged Accounts */}
      {taggedAccounts.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm mt-6">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
            <Tag className="w-4 h-4 text-orange-600" />
            <h2 className="text-sm font-bold text-black">Tagged Accounts</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-300 ml-1">
              Vertical = {vertical?.name}
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {["Account ID", "Account Name", "Tagged Resources"].map((h) => (
                  <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {taggedAccounts.map((a) => (
                <tr key={a.aws_account_id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                  <td className="px-5 py-3 text-xs font-mono font-bold text-black">{a.aws_account_id}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-black">{a.account_name}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-bold px-2 py-1 rounded bg-orange-100 text-orange-800 border border-orange-200">
                      {a.resource_count} resources
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Business Modal */}
      {showAddBusiness && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">Add Business</h3>
              <button onClick={() => setShowAddBusiness(false)}><X className="w-4 h-4 text-black" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Business Name *</label>
                <input value={newBizName} onChange={(e) => setNewBizName(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="e.g. IDC, SFL, SGIC" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Owner Name</label>
                <input value={newBizOwner} onChange={(e) => setNewBizOwner(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="e.g. John Doe" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Owner Email</label>
                <input value={newBizEmail} onChange={(e) => setNewBizEmail(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="owner@company.com" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowAddBusiness(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={addBusiness} disabled={savingBiz || !newBizName.trim()}
                className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {savingBiz ? "Saving..." : "Add Business"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Owner Modal */}
      {showAddOwner && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">Add Owner</h3>
              <button onClick={() => setShowAddOwner(false)}><X className="w-4 h-4 text-black" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Owner Name *</label>
                <input value={newOwnerName} onChange={(e) => setNewOwnerName(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="e.g. Platform Team" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Email (optional)</label>
                <input value={newOwnerEmail} onChange={(e) => setNewOwnerEmail(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="team@company.com" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowAddOwner(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={addOwner} disabled={saving || !newOwnerName.trim()}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {saving ? "Saving..." : "Add Owner"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Tag by Account Modal */}
      {showBulkTag && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-3xl p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div>
                <h3 className="text-sm font-bold text-black">Tag Resources by Account</h3>
                <p className="text-xs text-black mt-0.5">
                  Select an account, choose resources, and tag them with <span className="font-bold">Vertical = {vertical?.name}</span>
                </p>
              </div>
              <button onClick={() => setShowBulkTag(false)}><X className="w-4 h-4 text-black" /></button>
            </div>

            {/* Business selector */}
            <div className="mb-4 flex-shrink-0">
              <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Select Business (optional)</label>
              <select
                value={selectedBusiness}
                onChange={(e) => setSelectedBusiness(e.target.value)}
                className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none">
                <option value="">— Tag Vertical only (no business) —</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              {selectedBusiness && (
                <p className="text-xs text-orange-700 mt-1 font-semibold">
                  Will tag: <span className="font-bold">Vertical={vertical?.name}</span> + <span className="font-bold">Business={businesses.find(b => b.id === selectedBusiness)?.name}</span>
                </p>
              )}
              {!selectedBusiness && (
                <p className="text-xs text-gray-500 mt-1">Will tag: <span className="font-bold">Vertical={vertical?.name}</span> only</p>
              )}
            </div>

            {/* Step 1: Select accounts */}
            <div className="mb-4 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-wide text-black">Select Accounts</label>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedAccounts(new Set(accounts.map((a) => a.aws_account_id)))}
                    className="text-xs font-bold text-blue-900 hover:underline">Select All</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => { setSelectedAccounts(new Set()); setAccountResources([]); setSelectedResources(new Set()); }}
                    className="text-xs font-bold text-black hover:underline">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50">
                {towers.map((ct) => (
                  <div key={ct.id}>
                    {/* CT header */}
                    <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{ct.name}</span>
                      <button
                        onClick={() => {
                          const ctAccIds = (ct.sub_accounts || []).map((s) => s.aws_account_id);
                          const allSelected = ctAccIds.every((a) => selectedAccounts.has(a));
                          setSelectedAccounts((prev) => {
                            const next = new Set(prev);
                            ctAccIds.forEach((a) => allSelected ? next.delete(a) : next.add(a));
                            return next;
                          });
                        }}
                        className="text-[10px] font-bold text-blue-900 hover:underline">
                        {(ct.sub_accounts || []).every((s) => selectedAccounts.has(s.aws_account_id)) ? "Deselect all" : "Select all"}
                      </button>
                    </div>
                    {/* Sub-accounts */}
                    <div className="grid grid-cols-2 gap-1 ml-2">
                      {(ct.sub_accounts || []).map((acc) => {
                        const checked = selectedAccounts.has(acc.aws_account_id);
                        return (
                          <label key={acc.aws_account_id}
                            className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition text-xs font-semibold ${
                              checked ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-blue-50 border border-gray-200"
                            }`}>
                            <input type="checkbox" className="hidden" checked={checked}
                              onChange={() => toggleAccount(acc.aws_account_id)} />
                            <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                              checked ? "bg-white border-white" : "border-gray-400"
                            }`}>
                              {checked && <div className="w-2 h-2 rounded-sm bg-blue-900" />}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate">{acc.account_name}</div>
                              <div className={`text-[10px] font-mono ${checked ? "text-white/70" : "text-gray-500"}`}>{acc.aws_account_id}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-2">
                <button
                  onClick={() => loadAccountResources(selectedAccounts)}
                  disabled={selectedAccounts.size === 0 || loadingResources}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingResources ? "animate-spin" : ""}`} />
                  Load Resources ({selectedAccounts.size} account{selectedAccounts.size !== 1 ? "s" : ""})
                </button>
              </div>
            </div>

            {/* Step 2: Filter + select resources */}
            {accountResources.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-2 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <input
                      value={serviceFilter}
                      onChange={(e) => setServiceFilter(e.target.value)}
                      placeholder="Filter by service..."
                      className="border border-gray-400 rounded-md px-3 py-1.5 text-xs text-black focus:border-blue-900 outline-none w-48"
                    />
                    <span className="text-xs text-black font-semibold">
                      {filteredResources.length} resources · {selectedResources.size} selected
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={selectAll}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-md hover:bg-blue-50 hover:border-blue-900 text-black transition">
                      <CheckSquare className="w-3.5 h-3.5" /> Select All
                    </button>
                    <button onClick={clearAll}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-md hover:bg-gray-50 text-black transition">
                      <Square className="w-3.5 h-3.5" /> Clear
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg mb-4">
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
                      {filteredResources.map((r) => {
                        const checked = selectedResources.has(r.resource_id);
                        return (
                          <tr key={r.resource_id}
                            className={`border-b border-gray-100 cursor-pointer transition ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}
                            onClick={() => toggleResource(r.resource_id)}>
                            <td className="px-3 py-2">
                              {checked
                                ? <CheckSquare className="w-4 h-4 text-blue-900" />
                                : <Square className="w-4 h-4 text-gray-400" />}
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
                </div>
              </>
            )}

            {loadingResources && (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-5 h-5 animate-spin text-blue-900" />
                <span className="ml-2 text-sm text-black">Loading resources...</span>
              </div>
            )}

            {selectedAccounts.size > 0 && !loadingResources && accountResources.length === 0 && (
              <div className="text-center py-8 text-sm text-black">
                No resources found for this account.
              </div>
            )}

            <div className="flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setShowBulkTag(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
              <button
                onClick={applyBulkTag}
                disabled={tagging || selectedResources.size === 0}
                className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-md transition disabled:opacity-50"
              >
                {tagging ? "Tagging..." : `Tag ${selectedResources.size} Resource${selectedResources.size !== 1 ? "s" : ""} → Vertical=${vertical?.name}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
