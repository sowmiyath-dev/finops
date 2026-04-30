"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import toast from "react-hot-toast";
import Link from "next/link";
import { Plus, RefreshCw, Trash2, ChevronRight, Clock, Building2, Users, AlertCircle } from "lucide-react";

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
    <div className="mt-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-black font-medium">{progress.message}</span>
        <span className="font-bold text-blue-900">{progress.percent}%</span>
      </div>
      <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-blue-900 transition-all duration-500" style={{ width: `${progress.percent}%` }} />
      </div>
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
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/towers/${id}`),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["towers"] }); },
  });

  const totalAccounts = towers.reduce((s: number, ct: any) => s + (ct.sub_accounts?.length || 0), 0);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin border-blue-900" />
    </div>
  );

  return (
    <div className="p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-black">AWS Control Towers</h1>
          <p className="text-sm text-black mt-0.5">
            {towers.length} control tower{towers.length !== 1 ? "s" : ""} · {totalAccounts} sub-accounts
          </p>
        </div>
        {(user?.role === "owner" || user?.role === "editor") && (
          <Link href="/onboard"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-md bg-blue-900 hover:bg-blue-800 transition">
            <Plus className="w-4 h-4" /> Add Control Tower
          </Link>
        )}
      </div>

      {/* Boundary notice */}
      {boundary && (
        <div className="flex items-center gap-2 mb-5 px-4 py-3 rounded-lg border border-blue-300 bg-blue-50 text-blue-900 text-sm font-semibold">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Cost data accurate up to <strong>{boundary.accurate_until}</strong> · Daily sync at <strong>10:30 AM UTC</strong>
        </div>
      )}

      {/* Summary cards */}
      {towers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: "Control Towers", value: towers.length, color: "#0f2d5e" },
            { label: "Sub-accounts", value: totalAccounts, color: "#1a6fa8" },
            { label: "Active", value: towers.filter((t: any) => t.is_active).length, color: "#1d8348" },
            { label: "Auto-sync ON", value: towers.filter((t: any) => t.auto_sync_enabled).length, color: "#ec7211" },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-lg border border-gray-300 shadow-sm p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-black mb-1">{c.label}</div>
              <div className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Control Tower list */}
      {towers.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
          <Building2 className="w-12 h-12 mx-auto mb-4 text-blue-900" />
          <h3 className="text-lg font-bold text-black mb-2">No Control Towers yet</h3>
          <p className="text-sm text-black mb-6">Add your first AWS Control Tower management account.</p>
          {(user?.role === "owner" || user?.role === "editor") && (
            <Link href="/onboard"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-md bg-blue-900 hover:bg-blue-800 transition">
              <Plus className="w-4 h-4" /> Add Control Tower
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
          <div className="grid grid-cols-12 px-5 py-3 bg-gray-100 border-b-2 border-gray-300">
            <div className="col-span-4 text-xs font-bold uppercase tracking-wider text-black">Control Tower</div>
            <div className="col-span-3 text-xs font-bold uppercase tracking-wider text-black">Management Account</div>
            <div className="col-span-2 text-xs font-bold uppercase tracking-wider text-black">Accounts</div>
            <div className="col-span-2 text-xs font-bold uppercase tracking-wider text-black">Last Synced</div>
            <div className="col-span-1 text-xs font-bold uppercase tracking-wider text-black">Actions</div>
          </div>

          {towers.map((ct: any) => (
            <div key={ct.id}
              className="grid grid-cols-12 px-5 py-4 border-b border-gray-200 hover:bg-blue-50 transition cursor-pointer items-center"
              onClick={() => router.push(`/dashboard/${ct.id}`)}>

              <div className="col-span-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-900 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {ct.name[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-bold text-black">{ct.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {ct.is_active
                      ? <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-900 border border-green-300">Active</span>
                      : <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-900 border border-red-300">Inactive</span>}
                    {ct.auto_sync_enabled && (
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-300">Auto-sync</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="col-span-3">
                <div className="text-sm font-semibold text-black">{ct.management_account_name}</div>
                <div className="text-xs font-mono text-black">{ct.management_account_id}</div>
              </div>

              <div className="col-span-2 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-900" />
                <span className="text-sm font-bold text-black">{ct.sub_accounts?.length || 0}</span>
              </div>

              <div className="col-span-2 flex items-center gap-1 text-xs font-semibold text-black">
                <Clock className="w-3 h-3" />
                {ct.last_synced_at
                  ? new Date(ct.last_synced_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
                  : "Never"}
              </div>

              <div className="col-span-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {(user?.role === "owner" || user?.role === "editor") && (
                  <>
                    <button onClick={() => syncMutation.mutate(ct.id)}
                      className="p-1.5 rounded hover:bg-blue-100 text-black hover:text-blue-900 transition" title="Sync">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { if (confirm("Remove?")) deleteMutation.mutate(ct.id); }}
                      className="p-1.5 rounded hover:bg-red-100 text-black hover:text-red-700 transition" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <ChevronRight className="w-4 h-4 text-black" />
              </div>

              <div className="col-span-12">
                <SyncProgressBar ctId={ct.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
