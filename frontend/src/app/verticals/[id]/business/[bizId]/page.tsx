"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { ChevronRight, DollarSign, RefreshCw, X, Users, Tag, CheckSquare, Square } from "lucide-react";

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
  const [costData, setCostData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Owner modal
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [saving, setSaving] = useState(false);

  // Billing tag modal
  const [tagModal, setTagModal] = useState<{ accountId: string; accountName: string } | null>(null);
  const [billingValue, setBillingValue] = useState("");
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
  const [loadingRes, setLoadingRes] = useState(false);
  const [serviceFilter, setServiceFilter] = useState("");
  const [tagging, setTagging] = useState(false);

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
      const v = (vertsRes.data as any[]).find((x: any) => x.id === verticalId);
      setVertical(v || null);
      setBusiness(bizRes.data);
      setCostData(costRes.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [bizId]); // eslint-disable-line

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
      await axios.patch(`${BASE}/api/verticals/businesses/${bizId}`,
        { name: business?.name, owner_name: ownerName.trim() },
        { headers }
      );
      setShowAddOwner(false);
      setOwnerName("");
      await load();
    } finally { setSaving(false); }
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
              <button onClick={() => { setOwnerName(business?.owner_name || ""); setShowAddOwner(true); }}
                className="text-xs font-bold text-blue-900 hover:underline flex items-center gap-1">
                <Users className="w-3 h-3" />{business?.owner_name ? "Edit" : "Add Owner"}
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

      {/* Add/Edit Owner Modal */}
      {showAddOwner && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">{business?.owner_name ? "Edit Owner" : "Add Owner"} — {business?.name}</h3>
              <button onClick={() => setShowAddOwner(false)}><X className="w-4 h-4 text-black" /></button>
            </div>
            <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Owner Name *</label>
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
              className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none mb-4"
              placeholder="e.g. John Doe" autoFocus />
            <div className="flex justify-end gap-3">
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
