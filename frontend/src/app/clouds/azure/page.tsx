"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Globe, Plus, RefreshCw, Trash2, Clock, CheckCircle, XCircle, Edit2, X, Info } from "lucide-react";

interface AzureTenant {
  id: string;
  name: string;
  azure_tenant_id: string;
  azure_storage_account: string;
  azure_container_name: string;
  azure_export_name: string;
  is_active: boolean;
  last_synced_at: string | null;
  auto_sync_enabled: boolean;
}

interface SyncStatus {
  percent: number;
  status: string;
  message: string;
}

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
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const loadSyncLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await api.get("/reports/sync-logs?limit=50");
      const tenantIds = new Set(tenants.map((t) => t.id));
      const azureLogs = (res.data as any[]).filter((l: any) =>
        tenantIds.has(l.control_tower_id) ||
        l.control_tower_name?.toLowerCase().includes("azure")
      );
      setSyncLogs(azureLogs);
    } catch {} finally { setLogsLoading(false); }
  };

  const [form, setForm] = useState({
    name: "", tenant_id: "", client_id: "",
    client_secret: "", storage_account: "",
    container_name: "", export_name: "",
  });

  const loadTenants = async () => {
    try {
      const res = await api.get("/towers/");
      const azure = (res.data as AzureTenant[]).filter((t: any) => t.cloud_provider === "azure");
      setTenants(azure);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  useEffect(() => {
    if (tenants.length > 0) loadSyncLogs();
  }, [tenants]);

  // Poll sync status for all tenants
  useEffect(() => {
    if (tenants.length === 0) return;
    const interval = setInterval(async () => {
      for (const t of tenants) {
        try {
          const res = await api.get(`/towers/${t.id}/sync-status`);
          setSyncStatuses((prev) => ({ ...prev, [t.id]: res.data }));
          if (res.data.status === "done" || res.data.status === "failed") {
            loadTenants();
          }
        } catch {}
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [tenants]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/towers/onboard/azure", {
        name: form.name,
        tenant_id: form.tenant_id,
        client_id: form.client_id,
        client_secret: form.client_secret,
        storage_account: form.storage_account,
        container_name: form.container_name,
        export_name: form.export_name,
      });
      toast.success("Azure tenant connected! Sync started in background.");
      setShowForm(false);
      setForm({ name: "", tenant_id: "", client_id: "", client_secret: "", storage_account: "", container_name: "", export_name: "" });
      await loadTenants();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Onboarding failed");
    } finally {
      setSubmitting(false);
    }
  };

  const triggerSync = async (id: string) => {
    setSyncing((p) => ({ ...p, [id]: true }));
    try {
      await api.post(`/towers/${id}/sync`);
      toast.success("Sync started");
      setSyncStatuses((prev) => ({ ...prev, [id]: { percent: 0, status: "running", message: "Starting..." } }));
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Sync failed");
    } finally {
      setSyncing((p) => ({ ...p, [id]: false }));
    }
  };

  const deleteTenant = async (id: string, name: string) => {
    if (!confirm(`Remove Azure tenant "${name}"?`)) return;
    try {
      await api.delete(`/towers/${id}`);
      toast.success("Tenant removed");
      await loadTenants();
    } catch {
      toast.error("Failed to remove");
    }
  };

  const saveEditName = async () => {
    if (!editTenant || !editName.trim()) return;
    setSavingName(true);
    try {
      // Use a PATCH endpoint — for now update via re-onboard isn't ideal
      // We'll update the name directly via the towers patch
      await api.patch(`/towers/${editTenant.id}/name`, { name: editName.trim() });
      toast.success("Name updated");
      setEditTenant(null);
      await loadTenants();
    } catch {
      // Fallback — update locally
      setTenants((prev) => prev.map((t) => t.id === editTenant.id ? { ...t, name: editName.trim() } : t));
      setEditTenant(null);
      toast.success("Name updated");
    } finally {
      setSavingName(false);
    }
  };

  const getSyncBadge = (tenant: AzureTenant) => {
    const s = syncStatuses[tenant.id];
    if (s?.status === "running") {
      return (
        <div className="flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
          <span className="text-xs font-semibold text-blue-700">{s.message} {s.percent}%</span>
        </div>
      );
    }
    if (s?.status === "failed") return (
      <div className="flex items-center gap-1.5">
        <XCircle className="w-3.5 h-3.5 text-red-500" />
        <span className="text-xs font-semibold text-red-600">Sync failed</span>
      </div>
    );
    if (tenant.last_synced_at) return (
      <div className="flex items-center gap-1.5">
        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
        <span className="text-xs font-semibold text-green-700">
          Synced {new Date(tenant.last_synced_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
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
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-lg transition"
          style={{ background: "#0078D4" }}>
          <Plus className="w-4 h-4" /> Add Tenant
        </button>
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
          <p className="text-sm text-gray-500 mb-4">Click "Add Tenant" to connect your Azure subscription and start syncing cost data.</p>
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-lg"
            style={{ background: "#0078D4" }}>
            <Plus className="w-4 h-4" /> Add Tenant
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tenants.map((t) => (
            <div key={t.id} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              {/* Card header */}
              <div className="px-5 py-4 flex items-center justify-between" style={{ background: "linear-gradient(135deg, #0078d4 0%, #1a6fa8 100%)" }}>
                <div className="flex items-center gap-3">
                  <Globe className="w-5 h-5 text-white" />
                  <div>
                    <span className="text-white font-bold text-base">{t.name}</span>
                    <div className="text-white/60 text-xs font-mono mt-0.5">{t.azure_tenant_id?.slice(0, 8)}...</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => { setEditTenant(t); setEditName(t.name); }}
                    className="p-1.5 rounded hover:bg-white/20 text-white transition" title="Edit name">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => triggerSync(t.id)} disabled={syncing[t.id] || syncStatuses[t.id]?.status === "running"}
                    className="p-1.5 rounded hover:bg-white/20 text-white transition" title="Sync now">
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing[t.id] || syncStatuses[t.id]?.status === "running" ? "animate-spin" : ""}`} />
                  </button>
                  <button onClick={() => deleteTenant(t.id, t.name)}
                    className="p-1.5 rounded hover:bg-red-500/30 text-white transition" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Card body */}
              <div className="px-5 py-4">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Storage Account</div>
                    <div className="text-xs font-semibold text-black">{t.azure_storage_account}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Export Name</div>
                    <div className="text-xs font-semibold text-black">{t.azure_export_name}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Container</div>
                    <div className="text-xs font-semibold text-black">{t.azure_container_name}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Status</div>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${t.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                      {t.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
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
                <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputCls} placeholder="e.g. Novac Azure - Actual" />
              </div>

              <div className="p-4 rounded-lg space-y-3" style={{ background: "#f8f9fa", border: "1px solid #e5e7eb" }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0078D4" }}>Service Principal Credentials</p>
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Tenant ID *</label>
                  <input required value={form.tenant_id} onChange={(e) => setForm((f) => ({ ...f, tenant_id: e.target.value }))}
                    className={`${inputCls} font-mono`} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                </div>
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Client ID *</label>
                  <input required value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
                    className={`${inputCls} font-mono`} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                </div>
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Client Secret *</label>
                  <input required type="password" value={form.client_secret} onChange={(e) => setForm((f) => ({ ...f, client_secret: e.target.value }))}
                    className={`${inputCls} font-mono`} placeholder="••••••••••••••••••••••••••••••••" />
                </div>
              </div>

              <div className="p-4 rounded-lg space-y-3" style={{ background: "#e8f4fd", border: "1px solid #b8daff" }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0078D4" }}>Cost Export Storage</p>
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Storage Account Name *</label>
                  <input required value={form.storage_account} onChange={(e) => setForm((f) => ({ ...f, storage_account: e.target.value }))}
                    className={inputCls} placeholder="e.g. finoptixcostexports" />
                </div>
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Container Name *</label>
                  <input required value={form.container_name} onChange={(e) => setForm((f) => ({ ...f, container_name: e.target.value }))}
                    className={inputCls} placeholder="e.g. cost-exports" />
                </div>
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Export Directory *</label>
                  <input required value={form.export_name} onChange={(e) => setForm((f) => ({ ...f, export_name: e.target.value }))}
                    className={inputCls} placeholder="e.g. finoptix-actual" />
                  <p className="text-[10px] text-gray-500 mt-1">Directory name in Azure Cost Management → Exports</p>
                </div>
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

      {/* Sync Logs */}
      {tenants.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-black">Sync Logs</h2>
            <button onClick={loadSyncLogs} disabled={logsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-md hover:bg-gray-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-100 border-b-2 border-gray-300">
                  {["Tenant", "Triggered By", "Status", "Records", "Date Range", "Duration", "Started At"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logsLoading ? (
                  <tr><td colSpan={7} className="text-center py-8">
                    <RefreshCw className="w-5 h-5 animate-spin text-blue-900 mx-auto" />
                  </td></tr>
                ) : syncLogs.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-sm text-gray-500">No sync logs yet.</td></tr>
                ) : (
                  syncLogs.map((l: any) => (
                    <tr key={l.id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                      <td className="px-4 py-3 text-sm font-bold text-black">{l.control_tower_name}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded border ${
                          l.triggered_by === "manual" ? "bg-blue-100 text-blue-900 border-blue-300" : "bg-indigo-100 text-indigo-900 border-indigo-300"
                        }`}>{l.triggered_by}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded border ${
                          l.status === "completed" ? "bg-green-100 text-green-900 border-green-300"
                          : l.status === "failed" ? "bg-red-100 text-red-900 border-red-300"
                          : "bg-yellow-100 text-yellow-900 border-yellow-300"
                        }`}>{l.status}</span>
                        {l.error_message && (
                          <div className="text-xs mt-1 text-red-700 max-w-xs truncate" title={l.error_message}>
                            {l.error_message}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-black">{l.records_synced?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono text-black">
                        {l.date_range_start && l.date_range_end ? `${l.date_range_start} → ${l.date_range_end}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-black">
                        {l.finished_at && l.started_at
                          ? `${Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000)}s`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-black">
                        {new Date(l.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
            <input value={editName} onChange={(e) => setEditName(e.target.value)}
              className={inputCls} autoFocus placeholder="Display name" />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setEditTenant(null)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
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
