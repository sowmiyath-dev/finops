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
  Users, DollarSign, TrendingUp, AlertCircle,
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
    <div className="mt-3 px-1">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{progress.message}</span>
        <span className="text-[#22d3ee] font-mono font-bold">{progress.percent}%</span>
      </div>
      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#7c3aed] to-[#06b6d4] transition-all duration-500"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

function ControlTowerCard({ ct, user, onSync, onDelete, onToggleAutoSync }: any) {
  const router = useRouter();

  return (
    <div className="card p-6 animate-slide-up">
      {/* Header */}
      <div
        className="flex items-start justify-between cursor-pointer"
        onClick={() => router.push(`/dashboard/${ct.id}`)}
      >
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7c3aed]/20 to-[#06b6d4]/15 flex items-center justify-center text-lg font-bold text-[#c084fc]">
              {ct.name[0].toUpperCase()}
            </div>
            {ct.is_active && (
              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-400 rounded-full border-2 border-[#080d1a] animate-pulse" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold text-white text-lg">{ct.name}</span>
              {ct.auto_sync_enabled && (
                <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">
                  Auto-sync ON
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              Management: <span className="font-mono text-slate-300">{ct.management_account_id}</span>
              {" · "}{ct.management_account_name}
            </div>
            {ct.last_synced_at && (
              <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
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
              <button
                onClick={() => onSync(ct.id)}
                title="Sync now"
                className="p-2 hover:text-[#22d3ee] text-[#94a3c4] transition hover:bg-[#7c3aed]/10 rounded-lg"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => onToggleAutoSync(ct.id, !ct.auto_sync_enabled)}
                title={ct.auto_sync_enabled ? "Disable auto-sync" : "Enable auto-sync"}
                className={`p-2 transition rounded-lg ${ct.auto_sync_enabled ? "text-emerald-400 hover:bg-[#7c3aed]/10" : "text-[#94a3c4] hover:text-emerald-400 hover:bg-[#7c3aed]/10"}`}
              >
                <Clock className="w-4 h-4" />
              </button>
              <button
                onClick={() => { if (confirm("Remove this Control Tower?")) onDelete(ct.id); }}
                title="Remove"
                className="p-2 hover:text-[#fb7185] text-[#94a3c4] transition hover:bg-[#f43f5e]/10 rounded-lg"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          <ChevronRight className="w-5 h-5 text-[#4a5578]" />
        </div>
      </div>

      {/* Sync progress */}
      <SyncProgressBar ctId={ct.id} />

      {/* Sub-accounts list */}
      {ct.sub_accounts?.length > 0 && (
        <div className="mt-4 border-t border-[#7c3aed]/10 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-3.5 h-3.5 text-[#94a3c4]" />
            <span className="text-xs font-medium text-[#94a3c4] uppercase tracking-wide">
              Sub-accounts ({ct.sub_accounts.length})
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ct.sub_accounts.map((acc: any) => (
              <Link
                key={acc.id}
                href={`/dashboard/${ct.id}/account/${acc.id}`}
                className="flex items-center gap-2 px-3 py-2 bg-[#0d1424]/60 border border-[#7c3aed]/10 hover:border-[#7c3aed]/30 rounded-lg transition group"
              >
                <div className="w-6 h-6 rounded-lg bg-[#7c3aed]/15 flex items-center justify-center text-xs font-bold text-[#c084fc] flex-shrink-0">
                  {acc.account_name[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate group-hover:text-[#22d3ee] transition">
                    {acc.account_name}
                  </div>
                  <div className="text-[10px] font-mono text-[#4a5578]">{acc.aws_account_id}</div>
                </div>
                <ChevronRight className="w-3 h-3 text-[#4a5578] ml-auto flex-shrink-0" />
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
        <div className="w-8 h-8 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-slide-up">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-1">Control Towers</h1>
            <p className="text-[#94a3c4]">
              {towers.length} control tower{towers.length !== 1 ? "s" : ""} · {totalAccounts} sub-accounts
            </p>
          </div>
          {(user?.role === "owner" || user?.role === "editor") && (
            <Link
              href="/onboard"
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#7c3aed] to-[#a855f7] hover:from-[#6d28d9] hover:to-[#9333ea] text-white rounded-xl text-sm font-semibold transition-all shadow-lg hover:scale-105"
            >
              <Plus className="w-4 h-4" /> Add Control Tower
            </Link>
          )}
        </div>

        {/* Data boundary notice */}
        {boundary && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-6 text-sm text-amber-300 animate-slide-up">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Cost data is accurate up to <strong className="text-amber-200">{boundary.accurate_until}</strong>.
            Daily sync runs at <strong className="text-amber-200">10:30 AM UTC</strong>.
          </div>
        )}

        {/* Summary cards */}
        {towers.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 animate-slide-up">
            {[
              { label: "Control Towers", value: towers.length, icon: Building2, color: "text-[#c084fc]", bg: "bg-[#7c3aed]/10" },
              { label: "Sub-accounts", value: totalAccounts, icon: Users, color: "text-[#22d3ee]", bg: "bg-[#06b6d4]/10" },
              { label: "Active Syncs", value: towers.filter((t: any) => t.is_active).length, icon: RefreshCw, color: "text-emerald-400", bg: "bg-emerald-400/10" },
              { label: "View Reports", value: "→", icon: DollarSign, color: "text-amber-400", bg: "bg-amber-400/10", href: "/reports" },
            ].map((card: any) => (
              card.href ? (
                <Link key={card.label} href={card.href}
                  className="p-4 bg-slate-800/50 border border-[#7c3aed]/15 hover:border-[#7c3aed]/35 rounded-xl transition hover:scale-[1.02]">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${card.bg}`}><card.icon className={`w-5 h-5 ${card.color}`} /></div>
                    <div>
                      <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                      <div className="text-xs text-slate-400">{card.label}</div>
                    </div>
                  </div>
                </Link>
              ) : (
                <div key={card.label} className="p-4 bg-slate-800/50 border border-[#7c3aed]/15 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${card.bg}`}><card.icon className={`w-5 h-5 ${card.color}`} /></div>
                    <div>
                      <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                      <div className="text-xs text-slate-400">{card.label}</div>
                    </div>
                  </div>
                </div>
              )
            ))}
          </div>
        )}

        {/* Control Tower cards */}
        {towers.length === 0 ? (
          <div className="text-center py-24 border border-dashed border-[#7c3aed]/20 rounded-2xl bg-[#7c3aed]/5">
            <div className="w-16 h-16 bg-[#7c3aed]/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-[#c084fc]" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No Control Towers yet</h3>
            <p className="text-[#94a3c4] mb-6">Add your first AWS Control Tower management account to start tracking costs.</p>
            {(user?.role === "owner" || user?.role === "editor") && (
              <Link href="/onboard"
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#7c3aed] to-[#06b6d4] text-white rounded-xl font-semibold transition hover:scale-105">
                <Plus className="w-4 h-4" /> Add Control Tower
              </Link>
            )}
          </div>
        ) : (
          <div className="grid gap-6">
            {towers.map((ct: any, i: number) => (
              <div key={ct.id} style={{ animationDelay: `${i * 80}ms` }}>
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
