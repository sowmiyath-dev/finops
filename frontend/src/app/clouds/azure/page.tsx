"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Globe, Plus, RefreshCw, Trash2, Clock, CheckCircle, XCircle, Edit2, X, Info } from "lucide-react";

interface AzureTenant {
  id: string; name: string; azure_tenant_id: string;
  azure_storage_account: string; azure_container_name: string;
  azure_export_name: string; is_active: boolean;
  last_synced_at: string | null; auto_sync_enabled: boolean;
}
interface SyncStatus { percent: number; status: string; message: string; }

export default function AzurePage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<AzureTenant[]>([]);
  const [syncStatuses, setSyncStatuses] = useState<Record<string, SyncStatus>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editTenant, setEditTenant] = useState<AzureTenant | null>(null);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ name: "", tenant_id: "", client_id: "", client_secret: "", storage_account: "", container_name: "", export_name: "" });

  const loadTenants = async () => {
    try {
      const res = await api.get("/towers/");
      setTenants((res.data as any[]).filter((t) => t.cloud_provider === "azure"));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { loadTenants(); }, []);

  useEffect(() => {
    if (tenants.length === 0) return;
    const interval = setInterval(async () => {
      for (const t of tenants) {
        try {
          const res = await api.get(`/towers/${t.id}/sync-status`);
          setSyncStatuses((prev) => ({ ...prev, [t.id]: res.data }));
          if (res.data.status === "done" || res.data.status === "failed") loadTenants();
        } catch {}
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [tenants]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/towers/onboard/azure", form);
      toast.success("Azure tenant connected! Sync started.");
      setShowForm(false);
      setForm({ name: "", tenant_id: "", client_id: "", client_secret: "", storage_account: "", container_name: "", export_name: "" });
      await loadTenants();
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
    try { await api.delete(`/towers/${id}`); toast.success("Tenant removed"); await loadTenants(); }
    catch { toast.error("Failed to remove"); }
  };

  const saveEditName = async () => {
    if (!editTenant || !editName.trim()) return;
    setSavingName(true);
    try {
      await api.patch(`/towers/${editTenant.id}/name`, { name: editName.trim() });
      toast.success("Name updated"); setEditTenant(null); await loadTenants();
    } catch {
      setTenants((prev) => prev.map((t) => t.id === editTenant.id ? { ...t, name: editName.trim() } : t));
      setEditTenant(null); toast.success("Name updated");
    } finally { setSavingName(false); }
  };

  const getSyncBadge = (t: AzureTenant) => {
    const s = syncStatuses[t.id];
    if (s?.status === "running") return (
      <div className="flex items-center gap-1.5">
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
        <span className="text-xs font-semibold text-blue-700">{s.message} {s.percent}%</span>
      </div>
    );
    if (s?.status === "failed") return (
      <div className="flex items-center gap-1.5">
        <XCircle className="w-3.5 h-3.5 text-red-500" />
        <span className="text-xs font-semibold text-red-600">Sync failed</span>
      </div>
    );
    if (t.last_synced_at) return (
      <div className="flex items-center gap-1.5">
        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
        <span className="text-xs font-semibold text-green-700">
          Synced {new Date(t.last_synced_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
        </span>
      </div>
    );
    return (
      <div className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs font-semibold text-gray-500">Not synced yet</span>
      </div>
    );
  };

  const inputCls = "w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm text-black focus:outline-none focus:border-blue-600 transition bg-white";

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#e8f4fd" }}>
            <Globe className="w-5 h-5" style={{ color: "#0078d4" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black">Microsoft Azure</h1>
            <p className="text-sm text-gray-500 mt-0.5">{tenants.length} tenant{tenants.length !== 1 ? "s" : ""} connected</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/sync-logs/azure"
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-black border border-gray-300 rounded-md hover:border-blue-900 hover:text-blue-900 transition">
            <Clock className="w-4 h-4" /> Sync Logs
          </Link>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-lg transition"
            style={{ background: "#0078D4" }}>
            <Plus className="w-4 h-4" /> Add Tenant
          </button>
        </div>
      </div>

      {/* Tenants list */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-32 mb-3" />
              <div className="h-3 bg-gray-200 rounded w-48" />
            </div>
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "#e8f4fd" }}>
            <Globe className="w-7 h-7" style={{ color: "#0078d4" }} />
          </div>
          <h2 className="text-base font-bold text-gray-800 mb-1">No Azure Tenants Connected</h2>
          <p className="text-sm text-gray-500 mb-4">Click "Add Tenant" to connect your Azure subscription.</p>
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-lg"
            style={{ background: "#0078D4" }}>
            <Plus className="w-4 h-4" /> Add Tenant
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tenants.map((t) => (
            <div key={t.id}
              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md hover:border-blue-400 transition"
              onClick={() => router.push(`/clouds/azure/${t.id}`)}>
              <div className="px-5 py-4 flex items-center justify-between" style={{ background: "linear-gradient(135deg, #0078d4 0%, #1a6fa8 100%)" }}>
                <div className="flex items-center gap-3">
                  <Globe className="w-5 h-5 text-white" />
                  <div>
                    <span className="text-white font-bold text-base">{t.name}</span>
                    <div className="text-white/60 text-xs font-mono mt-0.5">{t.azure_tenant_id?.slice(0, 8)}...</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <button onClick={(e) => { e.stopPropagation(); setEditTenant(t); setEditName(t.name); }}
                    className="p-1.5 rounded hover:bg-white/20 text-white transition" title="Edit name">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => triggerSync(e, t.id)} disabled={syncing[t.id] || syncStatuses[t.id]?.status === "running"}
                    className="p-1.5 rounded hover:bg-white/20 text-white transition" title="Sync now">
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing[t.id] || syncStatuses[t.id]?.status === "running" ? "animate-spin" : ""}`} />
                  </button>
                  <button onClick={(e) => deleteTenant(e, t.id, t.name)}
                    className="p-1.5 rounded hover:bg-red-500/30 text-white transition" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {[
                    { label: "Storage Account", value: t.azure_storage_account },
                    { label: "Export Name", value: t.azure_export_name },
                    { label: "Container", value: t.azure_container_name },
                    { label: "Status", value: t.is_active ? "Active" : "Inactive", badge: true, active: t.is_active },
                  ].map((f) => (
                    <div key={f.label}>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">{f.label}</div>
                      {f.badge ? (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${f.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>{f.value}</span>
                      ) : (
                        <div className="text-xs font-semibold text-black">{f.value}</div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="pt-3 border-t border-gray-100">
                  {getSyncBadge(t)}
                  {syncStatuses[t.id]?.status === "running" && (
                    <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${syncStatuses[t.id]?.percent || 0}%`, background: "#0078d4" }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Tenant Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-black">Add Azure Tenant</h3>
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
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
