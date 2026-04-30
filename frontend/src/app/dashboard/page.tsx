"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import toast from "react-hot-toast";
import Link from "next/link";
import {
  Plus, RefreshCw, Trash2, ChevronRight, Clock, Building2,
  Users, DollarSign, AlertCircle, CheckCircle, XCircle,
} from "lucide-react";

function SyncProgressBar({ ctId }: { ctId: string }) {
  const [progress, setProgress] = useState<{ percent: number; status: string; message: string } | null>(null);

  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const res = await api.get(`/towers/${ctId}/sync-status`);
        setProgress(res.data);
        if (res.data.status === "done" || res.data.status === "idle") clearInterval(iv);
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [ctId]);

  if (!progress || progress.status === "idle" || progress.status === "done") return null;

  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
        <span>{progress.message}</span>
        <span className="font-semibold" style={{ color: "var(--primary)" }}>{progress.percent}%</span>
      </div>
      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "#e2e8f0" }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progress.percent}%`, background: "var(--primary)" }} />
      </div>
    </div>
  );
}

function ControlTowerCard({ ct, user, onSync, onDelete, onToggleAutoSync }: any) {
  const router = useRouter();

  return (
    <div className="card animate-slide-up">
      {/* Header */}
      <div className="p-5 cursor-pointer" onClick={() => router.push(`/dashboard/${ct.id}`)}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
              style={{ background: "var(--primary)" }}>
              {ct.name[0].toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{ct.name}</span>
                {ct.is_active ? (
                  <span className="badge-success">Active</span>
                ) : (
                  <span className="badge-danger">Inactive</span>
                )}
                {ct.auto_sync_enabled && (
                  <span className="badge-info">Auto-sync ON</span>
                )}
              </div>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Management: <span className="font-mono">{ct.management_account_id}</span>
                {" · "}{ct.management_account_name}
              </div>
              {ct.last_synced_at && (
                <div className="flex items-center gap-1 mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  <Clock className="w-3 h-3" />
                  Last synced: {new Date(ct.last_synced_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {(user?.role === "owner" || user?.role === "editor") && (
              <>
                <button onClick={() => onSync(ct.id)} title="Sync now"
                  className="p-2 rounded-md transition text-gray-400 hover:text-blue-600 hover:bg-blue-50">
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button onClick={() => onToggleAutoSync(ct.id, !ct.auto_sync_enabled)}
                  title={ct.auto_sync_enabled ? "Disable auto-sync" : "Enable auto-sync"}
                  className={`p-2 rounded-md transition ${ct.auto_sync_enabled ? "text-green-600 hover:bg-green-50" : "text-gray-400 hover:text-green-600 hover:bg-green-50"}`}>
                  <Clock className="w-4 h-4" />
                </button>
                <button onClick={() => { if (confirm("Remove this Control Tower?")) onDelete(ct.id); }}
                  title="Remove"
                  className="p-2 rounded-md transition text-gray-400 hover:text-red-600 hover:bg-red-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
            <ChevronRight className="w-4 h-4 ml-1" style={{ color: "var(--text-muted)" }} />
          </div>
        </div>

        <SyncProgressBar ctId={ct.id} />
      </div>

      {/* Sub-accounts */}
      {ct.sub_accounts?.length > 0 && (
        <div className="px-5 pb-5 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-1.5 mt-4 mb-3">
            <Users className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Sub-accounts ({ct.sub_accounts.length})
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ct.sub_accounts.map((acc: any) => (
              <Link key={acc.id} href={`/dashboard/${ct.id}/account/${acc.id}`}
                className="flex items-center gap-2 px-3 py-2 rounded-md border transition group"
                style={{ borderColor: "var(--border)", background: "var(--bg-sidebar)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--primary)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-sidebar)"; }}>
                <div className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ background: "var(--primary-light)" }}>
                  {acc.account_name[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {acc.account_name}
                  </div>
                  <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{acc.aws_account_id}</div>
                </div>
                <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: "var(--text-muted)" }} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { token, fetchMe, user } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) { router.push("/auth"); return; }
    fetchMe();
  }, [token]);

  const { data: towers = [], isLoading } = useQuery({
    queryKey: ["towers"],
    queryFn: () => api.get("/towers/").then((r) => r.data),
    enabled: !!token,
    refetchInterval: 30000,
  });

  const { data: boundary } = useQuery({
    queryKey: ["boundary"],
    queryFn: () => api.get("/reports/data-boundary").then((r) => r.data),
    enabled: !!token,
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/towers/${id}/sync`),
    onSuccess: () => { toast.success("Sync started"); qc.invalidateQueries({ queryKey: ["towers"] }); },
    onError: () => toast.error("Sync failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/towers/${id}`),
    onSuccess: () => { toast.success("Control Tower removed"); qc.invalidateQueries({ queryKey: ["towers"] }); },
  });

  const autoSyncMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/towers/${id}/auto-sync?enabled=${enabled}`),
    onSuccess: () => { toast.success("Auto-sync updated"); qc.invalidateQueries({ queryKey: ["towers"] }); },
  });

  const totalAccounts = towers.reduce((s: number, ct: any) => s + (ct.sub_accounts?.length || 0), 0);

  if (isLoading) return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6 animate-slide-up">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>Control Towers</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {towers.length} control tower{towers.length !== 1 ? "s" : ""} · {totalAccounts} sub-accounts
            </p>
          </div>
          {(user?.role === "owner" || user?.role === "editor") && (
            <Link href="/onboard"
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-md transition"
              style={{ background: "var(--primary)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--primary-light)")}
              onMouseLeave={e => (e.currentTarget.style.background = "var(--primary)")}>
              <Plus className="w-4 h-4" /> Add Control Tower
            </Link>
          )}
        </div>

        {/* Data boundary notice */}
        {boundary && (
          <div className="alert-info flex items-center gap-2 mb-6 animate-slide-up">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Cost data is accurate up to <strong>{boundary.accurate_until}</strong>.
            Daily sync runs at <strong>10:30 AM UTC</strong>.
          </div>
        )}

        {/* Summary cards */}
        {towers.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 animate-slide-up">
            {[
              { label: "Control Towers", value: towers.length, icon: Building2, color: "var(--primary)" },
              { label: "Sub-accounts", value: totalAccounts, icon: Users, color: "var(--info)" },
              { label: "Active", value: towers.filter((t: any) => t.is_active).length, icon: CheckCircle, color: "var(--success)" },
              { label: "View Reports", value: "→", icon: DollarSign, color: "var(--accent)", href: "/reports" },
            ].map((card: any) => (
              card.href ? (
                <Link key={card.label} href={card.href} className="stat-card hover:shadow-md transition cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: `${card.color}15` }}>
                      <card.icon className="w-5 h-5" style={{ color: card.color }} />
                    </div>
                    <div>
                      <div className="stat-card-label">{card.label}</div>
                      <div className="stat-card-value text-xl" style={{ color: card.color }}>{card.value}</div>
                    </div>
                  </div>
                </Link>
              ) : (
                <div key={card.label} className="stat-card">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: `${card.color}15` }}>
                      <card.icon className="w-5 h-5" style={{ color: card.color }} />
                    </div>
                    <div>
                      <div className="stat-card-label">{card.label}</div>
                      <div className="stat-card-value text-xl" style={{ color: card.color }}>{card.value}</div>
                    </div>
                  </div>
                </div>
              )
            ))}
          </div>
        )}

        {/* Control Tower cards */}
        {towers.length === 0 ? (
          <div className="card p-16 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: "#e8f0fe" }}>
              <Building2 className="w-8 h-8" style={{ color: "var(--primary)" }} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-primary)" }}>No Control Towers yet</h3>
            <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
              Add your first AWS Control Tower management account to start tracking costs.
            </p>
            {(user?.role === "owner" || user?.role === "editor") && (
              <Link href="/onboard"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-md transition"
                style={{ background: "var(--primary)" }}>
                <Plus className="w-4 h-4" /> Add Control Tower
              </Link>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {towers.map((ct: any, i: number) => (
              <div key={ct.id} style={{ animationDelay: `${i * 60}ms` }}>
                <ControlTowerCard
                  ct={ct}
                  user={user}
                  onSync={(id: string) => syncMutation.mutate(id)}
                  onDelete={(id: string) => deleteMutation.mutate(id)}
                  onToggleAutoSync={(id: string, enabled: boolean) => autoSyncMutation.mutate({ id, enabled })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
