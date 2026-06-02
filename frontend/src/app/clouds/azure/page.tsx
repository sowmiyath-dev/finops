"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Info, Globe, Plus } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";

export default function AzureOnboardPage() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [azureForm, setAzureForm] = useState({
    name: "", tenant_id: "", client_id: "",
    client_secret: "", storage_account: "",
    container_name: "", export_name: "",
  });

  const setAzure = (k: string, v: string) => setAzureForm((f) => ({ ...f, [k]: v }));

  const handleAzureSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/towers/onboard/azure", {
        name: azureForm.name,
        tenant_id: azureForm.tenant_id,
        client_id: azureForm.client_id,
        client_secret: azureForm.client_secret,
        storage_account: azureForm.storage_account,
        container_name: azureForm.container_name,
        export_name: azureForm.export_name,
      });
      toast.success("Azure tenant onboarded! Cost sync started.");
      setShowForm(false);
      setAzureForm({ name: "", tenant_id: "", client_id: "", client_secret: "", storage_account: "", container_name: "", export_name: "" });
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Azure onboarding failed");
    } finally { setLoading(false); }
  };

  const inputCls = "w-full border rounded-md px-3 py-2.5 text-sm focus:outline-none transition bg-white border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  const labelCls = "block text-sm font-medium mb-1.5";

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Globe className="w-6 h-6" style={{ color: "#0078d4" }} />
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>Microsoft Azure</h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Manage your Azure tenant connections</p>
          </div>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition hover:opacity-90"
          style={{ background: "#0078D4" }}>
          <Plus className="w-4 h-4" /> Add Tenant
        </button>
      </div>

      {/* Form - top left aligned */}
      {showForm && (
        <div className="max-w-lg">
          <div className="card p-6">
            <div className="p-3 rounded-lg flex gap-2 text-sm mb-4" style={{ background: "#e8f4fd", border: "1px solid #b8daff", color: "#0078D4" }}>
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Create a <strong>Service Principal</strong> with <strong>Storage Blob Data Reader</strong> + <strong>Cost Management Reader</strong> roles. Set up a daily Cost Export in Azure Cost Management.</span>
            </div>

            <form onSubmit={handleAzureSubmit} className="space-y-4">
              <div>
                <label className={labelCls} style={{ color: "var(--text-primary)" }}>Display Name</label>
                <input required value={azureForm.name} onChange={(e) => setAzure("name", e.target.value)}
                  className={inputCls} placeholder="e.g. Novac Azure"
                  style={{ color: "var(--text-primary)" }} />
              </div>

              <div className="p-4 rounded-lg space-y-3" style={{ background: "#f8f9fa", border: "1px solid var(--border)" }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0078D4" }}>Service Principal Credentials</p>
                <div>
                  <label className={labelCls} style={{ color: "var(--text-primary)" }}>Tenant ID</label>
                  <input required value={azureForm.tenant_id} onChange={(e) => setAzure("tenant_id", e.target.value)}
                    className={`${inputCls} font-mono`} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    style={{ color: "var(--text-primary)" }} />
                </div>
                <div>
                  <label className={labelCls} style={{ color: "var(--text-primary)" }}>Client ID (Application ID)</label>
                  <input required value={azureForm.client_id} onChange={(e) => setAzure("client_id", e.target.value)}
                    className={`${inputCls} font-mono`} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    style={{ color: "var(--text-primary)" }} />
                </div>
                <div>
                  <label className={labelCls} style={{ color: "var(--text-primary)" }}>Client Secret</label>
                  <input required type="password" value={azureForm.client_secret} onChange={(e) => setAzure("client_secret", e.target.value)}
                    className={`${inputCls} font-mono`} placeholder="••••••••••••••••••••••••••••••••"
                    style={{ color: "var(--text-primary)" }} />
                </div>
              </div>

              <div className="p-4 rounded-lg space-y-3" style={{ background: "#e8f4fd", border: "1px solid #b8daff" }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0078D4" }}>Cost Export Storage</p>
                <div>
                  <label className={labelCls} style={{ color: "var(--text-primary)" }}>Storage Account Name</label>
                  <input required value={azureForm.storage_account} onChange={(e) => setAzure("storage_account", e.target.value)}
                    className={inputCls} placeholder="e.g. finoptixcostexports"
                    style={{ color: "var(--text-primary)" }} />
                </div>
                <div>
                  <label className={labelCls} style={{ color: "var(--text-primary)" }}>Container Name</label>
                  <input required value={azureForm.container_name} onChange={(e) => setAzure("container_name", e.target.value)}
                    className={inputCls} placeholder="e.g. cost-exports"
                    style={{ color: "var(--text-primary)" }} />
                </div>
                <div>
                  <label className={labelCls} style={{ color: "var(--text-primary)" }}>Export Name (Directory)</label>
                  <input required value={azureForm.export_name} onChange={(e) => setAzure("export_name", e.target.value)}
                    className={inputCls} placeholder="e.g. finoptix"
                    style={{ color: "var(--text-primary)" }} />
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    The directory name set in Azure Cost Management → Exports
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 text-sm font-semibold text-white rounded-md transition disabled:opacity-50"
                  style={{ background: loading ? "#6b7280" : "#0078D4" }}>
                  {loading ? "Connecting & syncing..." : "Connect Azure Tenant"}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 text-sm font-semibold rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Empty state when no form shown */}
      {!showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "#e8f4fd" }}>
            <Globe className="w-7 h-7" style={{ color: "#0078d4" }} />
          </div>
          <h2 className="text-base font-bold text-gray-800 mb-1">No Azure Tenants Connected</h2>
          <p className="text-sm text-gray-500 mb-4">Click &quot;Add Tenant&quot; to connect your Azure subscription.</p>
        </div>
      )}
    </div>
  );
}
