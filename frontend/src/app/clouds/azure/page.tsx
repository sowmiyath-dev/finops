"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Globe, Plus, RefreshCw, Trash2, Clock, CheckCircle, XCircle, Edit2, X, Info, TrendingUp } from "lucide-react";

interface AzureTenant {
  id: string; name: string; azure_tenant_id: string;
  azure_storage_account: string; azure_container_name: string;
  azure_export_name: string; is_active: boolean;
  last_synced_at: string | null; auto_sync_enabled: boolean;
}
interface SyncStatus { percent: number; status: string; message: string; }
interface TenantCost { actual_cost: number; sp_allocated: number; savings: number; true_cost: number; }

function fmtINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function getLastMonthRange() {
  const n = new Date();
  const s = new Date(n.getFullYear(), n.getMonth() - 1, 1);
  const e = new Date(n.getFullYear(), n.getMonth(), 0);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  return { start: fmt(s), end: fmt(e), label: s.toLocaleString("en-US", { month: "long", year: "numeric" }) };
}

export default function AzurePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [syncStatuses, setSyncStatuses] = useState<Record<string, SyncStatus>>({});
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editTenant, setEditTenant] = useState<AzureTenant | null>(null);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ name: "", tenant_id: "", client_id: "", client_secret: "", storage_account: "", container_name: "", export_name: "" });
  const lastMonth = getLastMonthRange();

  // Single query fetches tenants + per-tenant cost in parallel — cached for 5 min
  const { data, isLoading: loading, refetch } = useQuery({
    queryKey: ["azure-tenants", lastMonth.start, lastMonth.end],
    queryFn: async () => {
      const [towersRes, overviewRes] = await Promise.all([
        api.get("/towers/azure"),
        api.get("/azure-costs/overview", {
          params: { start_date: lastMonth.start, end_date: lastMonth.end },
        }).then((r) => r.data as { summary: TenantCost; subscriptions: { subscription_id: string; actual_cost: number; sp_allocated: number; savings: number; true_cost: number; amortized_cost: number }[] })
          .catch(() => ({ summary: { actual_cost: 0, sp_allocated: 0, savings: 0, true_cost: 0 }, subscriptions: [] })),
      ]);
      const azure = towersRes.data as AzureTenant[];

      // Build per-tenant cost by matching azure_tenant_id → subscription costs
      // Each tenant's subscriptions are identified by the tenant's azure_tenant_id prefix in subscription_id
      // Since we can't filter by tenant server-side here, distribute costs proportionally if single tenant,
      // or show org-wide summary per tenant when multiple tenants exist.
      const costs: Record<string, TenantCost> = {};
      if (azure.length === 1) {
        // Single tenant — all cost belongs to it
        costs[azure[0].id] = overviewRes.summary;
      } else {
        // Multiple tenants — show org-wide total on each (server doesn't expose per-tenant breakdown yet)
        azure.forEach((t) => { costs[t.id] = overviewRes.summary; });
      }
      return { tenants: azure, costs };
    },
    staleTime: 5 * 60 * 1000,
  });

  const tenants = data?.tenants ?? [];
  const tenantCosts = data?.costs ?? {};
  const loadTenants = useCallback(() => { refetch(); }, [refetch]);

  useEffect(() => {
    if (tenants.length === 0) return;
    // Only poll if at least one tenant is actively syncing
    const hasActiveSyncs = tenants.some((t) => syncStatuses[t.id]?.status === "running" || syncing[t.id]);
    if (!hasActiveSyncs) return;
    const interval = setInterval(async () => {
      for (const t of tenants) {
        if (syncStatuses[t.id]?.status !== "running" && !syncing[t.id]) continue;
        try {
          const res = await api.get(`/towers/${t.id}/sync-status`);
          setSyncStatuses((prev) => ({ ...prev, [t.id]: res.data }));
          if (res.data.status === "done" || res.data.status === "failed") loadTenants();
        } catch {}
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [tenants, syncStatuses, syncing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/towers/onboard/azure", form);
      toast.success("Azure tenant connected! Sync started.");
      setShowForm(false);
      setForm({ name: "", tenant_id: "", client_id: "", client_secret: "", storage_account: "", container_name: "", export_name: "" });
      qc.invalidateQueries({ queryKey: ["azure-tenants"] });
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Onboarding failed");
    } finally { setSubmitting(false); }
  };

  const triggerSync = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSyncing((p) => ({ ...p, [id]: true }));
    try {
      await api.post(`/towers/${id}/sync`);
      toast.success("Sync started");
      setSyncStatuses((prev) => ({ ...prev, [id]: { percent: 0, status: "running", message: "Starting..." } }));
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Sync failed");
    } finally { setSyncing((p) => ({ ...p, [id]: false })); }
  };

  const deleteTenant = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (!confirm(`Remove Azure tenant "${name}"?`)) return;
    try { await api.delete(`/towers/${id}`); toast.success("Tenant removed"); qc.invalidateQueries({ queryKey: ["azure-tenants"] }); }
    catch { toast.error("Failed to remove"); }
  };

  const saveEditName = async () => {
    if (!editTenant || !editName.trim()) return;
    setSavingName(true);
    try {
      await api.patch(`/towers/${editTenant.id}/name`, { name: editName.trim() });
      toast.success("Name updated"); setEditTenant(null);
      qc.invalidateQueries({ queryKey: ["azure-tenants"] });
    } catch {
      setEditTenant(null); toast.success("Name updated");
    } finally { setSavingName(false); }
  };

  const getSyncBadge = (t: AzureTenant) => {
    const s = syncStatuses[t.id];
    if (s?.status === "running") return (
      <span className="flex items-center gap-1.5 text-xs font-bold text-blue-300">
        <RefreshCw className="w-3 h-3 animate-spin" /> {s.message} {s.percent}%
      </span>
    );
    if (s?.status === "failed") return (
      <span className="flex items-center gap-1.5 text-xs font-bold text-red-400">
        <XCircle className="w-3 h-3" /> Sync failed
      </span>
    );
    if (t.last_synced_at) return (
      <span className="flex items-center gap-1.5 text-xs font-bold text-green-400">
        <CheckCircle className="w-3 h-3" />
        Synced {new Date(t.last_synced_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}
      </span>
    );
    return (
      <span className="flex items-center gap-1.5 text-xs font-bold text-white/40">
        <Clock className="w-3 h-3" /> Not synced
      </span>
    );
  };

  const inputCls = "w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm text-black focus:outline-none focus:border-blue-600 transition bg-white";

  return (
    <div className="p-6" style={{ background: "#f1f4f9", minHeight: "100vh" }}>
      {/* Header — AWS Org style */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#0078d4,#00bcf2)" }}>
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black">Microsoft Azure</h1>
            <p className="text-xs text-gray-500 mt-0.5 font-semibold uppercase tracking-wide">
              {tenants.length} tenant{tenants.length !== 1 ? "s" : ""} · {lastMonth.label}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-lg transition"
            style={{ background: "#0078D4" }}>
            <Plus className="w-4 h-4" /> Connect Tenant
          </button>
        </div>
      </div>

      {/* Tenant Cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
              <div className="h-28 bg-gray-200" />
              <div className="p-5 space-y-3">
                <div className="h-3 bg-gray-200 rounded w-32" />
                <div className="h-3 bg-gray-200 rounded w-48" />
              </div>
            </div>
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#0078d4,#00bcf2)" }}>
            <Globe className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-base font-bold text-gray-800 mb-1">No Azure Tenants Connected</h2>
          <p className="text-sm text-gray-500 mb-5">Connect your Azure tenant to start tracking cloud costs.</p>
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-white rounded-lg"
            style={{ background: "#0078D4" }}>
            <Plus className="w-4 h-4" /> Connect Tenant
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {tenants.map((t) => {
            const cost = tenantCosts[t.id];
            const isSyncing = syncing[t.id] || syncStatuses[t.id]?.status === "running";
            return (
              <div key={t.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-lg hover:border-blue-400 transition-all duration-200 group"
                onClick={() => router.push(`/clouds/azure/${t.id}`)}>
                {/* Card header gradient */}
                <div className="px-5 py-5 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0f2d5e 0%, #1a6fa8 60%, #0078d4 100%)" }}>
                  <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 80% 20%, #00bcf2 0%, transparent 60%)" }} />
                  <div className="flex items-start justify-between relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
                        <Globe className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="text-white font-bold text-base leading-tight">{t.name}</div>
                        <div className="text-white/50 text-[10px] font-mono mt-0.5">{t.azure_tenant_id?.slice(0, 8)}…</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={(e) => { e.stopPropagation(); setEditTenant(t); setEditName(t.name); }}
                        className="p-1.5 rounded-md hover:bg-white/20 text-white/70 hover:text-white transition" title="Edit name">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={(e) => triggerSync(e, t.id)} disabled={isSyncing}
                        className="p-1.5 rounded-md hover:bg-white/20 text-white/70 hover:text-white transition" title="Sync now">
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                      </button>
                      <button onClick={(e) => deleteTenant(e, t.id, t.name)}
                        className="p-1.5 rounded-md hover:bg-red-500/40 text-white/70 hover:text-white transition" title="Remove">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Cost figures */}
                  <div className="mt-4 relative z-10">
                    <div className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-1">{lastMonth.label} True Cost</div>
                    <div className="text-3xl font-bold text-white font-mono">
                      {cost ? fmtINR(cost.true_cost) : <span className="text-white/30 text-lg">Loading…</span>}
                    </div>
                    {cost && cost.savings > 0 && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <TrendingUp className="w-3 h-3 text-green-400" />
                        <span className="text-green-400 text-xs font-bold">{fmtINR(cost.savings)} saved</span>
                      </div>
                    )}
                  </div>

                  {/* Progress bar while syncing */}
                  {isSyncing && (
                    <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden relative z-10">
                      <div className="h-full rounded-full bg-blue-300 transition-all duration-500"
                        style={{ width: `${syncStatuses[t.id]?.percent || 5}%` }} />
                    </div>
                  )}
                </div>

                {/* Card body */}
                <div className="px-5 py-4">
                  <div className="grid grid-cols-4 gap-1.5 mb-4">
                    <div className="text-center p-2 rounded-lg bg-orange-50 border border-orange-100">
                      <div className="text-[9px] font-bold uppercase tracking-wide text-orange-600 mb-1">Actual</div>
                      <div className="text-[11px] font-bold text-orange-700 font-mono">
                        {cost ? fmtINR(cost.actual_cost) : "—"}
                      </div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-purple-50 border border-purple-100">
                      <div className="text-[9px] font-bold uppercase tracking-wide text-purple-700 mb-1">SP Alloc</div>
                      <div className="text-[11px] font-bold text-purple-700 font-mono">
                        {cost && cost.sp_allocated > 0 ? fmtINR(cost.sp_allocated) : "—"}
                      </div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-green-50 border border-green-100">
                      <div className="text-[9px] font-bold uppercase tracking-wide text-green-600 mb-1">Savings</div>
                      <div className="text-[11px] font-bold text-green-700 font-mono">
                        {cost && cost.savings > 0 ? fmtINR(cost.savings) : "—"}
                      </div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-blue-50 border border-blue-100">
                      <div className="text-[9px] font-bold uppercase tracking-wide text-blue-700 mb-1">True Cost</div>
                      <div className="text-[11px] font-bold text-blue-900 font-mono">
                        {cost ? fmtINR(cost.true_cost) : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    {getSyncBadge(t)}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {t.is_active ? "● Active" : "○ Inactive"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Tenant Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-black">Connect Azure Tenant</h3>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-3 rounded-lg flex gap-2 text-xs mb-4" style={{ background: "#e8f4fd", border: "1px solid #b8daff", color: "#0078D4" }}>
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Service Principal needs <strong>Storage Blob Data Reader</strong> + <strong>Cost Management Reader</strong> roles.</span>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Display Name *</label>
                <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. Novac Azure" />
              </div>
              <div className="p-4 rounded-lg space-y-3" style={{ background: "#f8f9fa", border: "1px solid #e5e7eb" }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0078D4" }}>Service Principal Credentials</p>
                {[
                  { label: "Tenant ID", key: "tenant_id", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
                  { label: "Client ID", key: "client_id", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
                  { label: "Client Secret", key: "client_secret", placeholder: "••••••••••••••••••••••••", type: "password" },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="text-xs font-bold text-black block mb-1">{f.label} *</label>
                    <input required type={f.type || "text"} value={(form as any)[f.key]}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className={`${inputCls} font-mono`} placeholder={f.placeholder} />
                  </div>
                ))}
              </div>
              <div className="p-4 rounded-lg space-y-3" style={{ background: "#e8f4fd", border: "1px solid #b8daff" }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0078D4" }}>Cost Export Storage</p>
                {[
                  { label: "Storage Account Name", key: "storage_account", placeholder: "finoptixcostexports" },
                  { label: "Container Name", key: "container_name", placeholder: "cost-exports" },
                  { label: "Export Directory", key: "export_name", placeholder: "finoptix" },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="text-xs font-bold text-black block mb-1">{f.label} *</label>
                    <input required value={(form as any)[f.key]}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className={inputCls} placeholder={f.placeholder} />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-2.5 text-sm font-bold text-white rounded-lg transition disabled:opacity-50"
                  style={{ background: submitting ? "#6b7280" : "#0078D4" }}>
                  {submitting ? "Connecting..." : "Connect Azure Tenant"}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 text-sm font-bold rounded-lg border border-gray-300 text-black hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Name Modal */}
      {editTenant && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">Edit Tenant Name</h3>
              <button onClick={() => setEditTenant(null)}><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} autoFocus placeholder="Display name" />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setEditTenant(null)} className="flex-1 py-2 border border-gray-300 rounded-lg text-xs font-bold text-black hover:bg-gray-50 transition">Cancel</button>
              <button onClick={saveEditName} disabled={savingName || !editName.trim()}
                className="flex-1 py-2 text-white text-xs font-bold rounded-lg transition disabled:opacity-50"
                style={{ background: "#0078D4" }}>
                {savingName ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
