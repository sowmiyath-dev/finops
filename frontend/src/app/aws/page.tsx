"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import toast from "react-hot-toast";
import Link from "next/link";
import { Plus, RefreshCw, Trash2, ChevronRight, Clock, Building2, Users, AlertCircle, FileText, X } from "lucide-react";

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
const SYNC_PRESETS = [
  { label: "Last Month", fn: () => { const n=new Date(); return { start: fmtDate(new Date(n.getFullYear(),n.getMonth()-1,1)), end: fmtDate(new Date(n.getFullYear(),n.getMonth(),0)) }; }},
  { label: "This Month", fn: () => { const n=new Date(); return { start: fmtDate(new Date(n.getFullYear(),n.getMonth(),1)), end: fmtDate(n) }; }},
  { label: "Last 7d",    fn: () => { const n=new Date(); const s=new Date(n); s.setDate(s.getDate()-6); return { start: fmtDate(s), end: fmtDate(n) }; }},
  { label: "Last 30d",   fn: () => { const n=new Date(); const s=new Date(n); s.setDate(s.getDate()-29); return { start: fmtDate(s), end: fmtDate(n) }; }},
];

function SyncModal({ ct, onClose, onSync }: { ct: any; onClose: () => void; onSync: (id: string, start: string, end: string) => void }) {
  const lm = SYNC_PRESETS[0].fn();
  const [start, setStart] = useState(lm.start);
  const [end, setEnd] = useState(lm.end);
  const [activePreset, setActivePreset] = useState("Last Month");
  const [syncing, setSyncing] = useState(false);
  const applyPreset = (p: typeof SYNC_PRESETS[0]) => { const r = p.fn(); setStart(r.start); setEnd(r.end); setActivePreset(p.label); };
  const handleSync = async () => { setSyncing(true); await onSync(ct.id, start, end); setSyncing(false); onClose(); };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-black">Manual Sync — {ct.name}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-black" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-3">Select the date range to sync cost data for</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {SYNC_PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className={`px-3 py-2 text-xs font-bold rounded-md border transition ${activePreset === p.label ? "bg-blue-900 text-white border-blue-900" : "bg-white text-black border-gray-300 hover:border-blue-900"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mb-4">
          <input type="date" value={start} onChange={(e) => { setStart(e.target.value); setActivePreset(""); }}
            className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-xs text-black focus:border-blue-900 outline-none" />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setActivePreset(""); }}
            className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-xs text-black focus:border-blue-900 outline-none" />
        </div>
        <div className="text-xs text-gray-500 mb-4">Will sync: <span className="font-bold text-black">{start} → {end}</span></div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">Cancel</button>
          <button onClick={handleSync} disabled={syncing || !start || !end}
            className="flex-1 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
            {syncing ? "Starting..." : "Start Sync"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SyncProgressBar({ ctId, onSyncComplete }: { ctId: string; onSyncComplete?: () => void }) {
  const [progress, setProgress] = useState<{ percent: number; status: string; message: string } | null>(null);
  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | null = null;
    const check = async () => {
      try {
        const res = await api.get(`/towers/${ctId}/sync-status`);
        const d = res.data;
        if (d.status === "running") {
          setProgress(d);
          iv = setInterval(async () => {
            try {
              const r2 = await api.get(`/towers/${ctId}/sync-status`);
              setProgress(r2.data);
              if (r2.data.status !== "running") { clearInterval(iv!); if (r2.data.status === "done") onSyncComplete?.(); }
            } catch { clearInterval(iv!); }
          }, 10000);
        }
      } catch {}
    };
    check();
    return () => { if (iv) clearInterval(iv); };
  }, [ctId]);
  if (!progress || progress.status !== "running") return null;
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

export default function AwsPage() {
  const { token, fetchMe, user } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => { if (!token) { router.push("/auth"); return; } fetchMe(); }, [token]);

  const { data: towers = [], isLoading } = useQuery({
    queryKey: ["towers"],
    queryFn: () => api.get("/towers/").then((r) => r.data.filter((t: any) => t.cloud_provider === "aws")),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: boundary } = useQuery({
    queryKey: ["boundary"],
    queryFn: () => api.get("/reports/data-boundary").then((r) => r.data),
    enabled: !!token,
    staleTime: 60 * 60 * 1000,
  });

  const [syncModalCt, setSyncModalCt] = useState<any>(null);
  const [syncStatuses, setSyncStatuses] = useState<Record<string, { status: string }>>({});

  useEffect(() => {
    const poll = async () => { const active = await api.get("/towers/sync-active").then((r) => r.data).catch(() => ({})); setSyncStatuses(active); };
    poll();
    const iv = setInterval(poll, 10000);
    return () => clearInterval(iv);
  }, []);

  const handleSync = async (id: string, start?: string, end?: string) => {
    const active = await api.get("/towers/sync-active").then((r) => r.data).catch(() => ({}));
    if (active[id]) { toast.error("Sync already in progress for this Control Tower"); return; }
    const params = start && end ? `?start_date=${start}&end_date=${end}` : "";
    await api.post(`/towers/${id}/sync${params}`);
    toast.success("Sync started");
    qc.invalidateQueries({ queryKey: ["towers"] });
  };

  const invalidateAfterSync = (ctId: string) => {
    qc.invalidateQueries({ queryKey: ["towers"] });
    qc.invalidateQueries({ queryKey: ["ct-primary", ctId] });
    qc.invalidateQueries({ queryKey: ["ct-tab", ctId] });
    qc.invalidateQueries({ queryKey: ["boundary"] });
    toast.success("Sync complete — data refreshed");
  };

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
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-black">Amazon Web Services</h1>
          <p className="text-sm text-black mt-0.5">{towers.length} control tower{towers.length !== 1 ? "s" : ""} · {totalAccounts} sub-accounts</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/reports" className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-black border border-gray-300 rounded-md hover:border-blue-900 hover:text-blue-900 transition">
            <FileText className="w-4 h-4" /> Cost Reports
          </Link>
          <Link href="/sync-logs" className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-black border border-gray-300 rounded-md hover:border-blue-900 hover:text-blue-900 transition">
            <Clock className="w-4 h-4" /> Sync Logs
          </Link>
          {(user?.role === "owner" || user?.role === "editor") && (
            <Link href="/onboard" className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-md bg-blue-900 hover:bg-blue-800 transition">
              <Plus className="w-4 h-4" /> Add Control Tower
            </Link>
          )}
        </div>
      </div>

      {boundary && (
        <div className="flex items-center gap-2 mb-5 px-4 py-3 rounded-lg border border-blue-300 bg-blue-50 text-blue-900 text-sm font-semibold">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Cost data accurate up to <strong>{boundary.accurate_until}</strong> · Daily sync at <strong>10:30 AM UTC</strong>
        </div>
      )}

      {towers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: "Control Towers", value: towers.length,                                          color: "#0f2d5e" },
            { label: "Sub-accounts",   value: totalAccounts,                                          color: "#1a6fa8" },
            { label: "Active",         value: towers.filter((t: any) => t.is_active).length,          color: "#1d8348" },
            { label: "Auto-sync ON",   value: towers.filter((t: any) => t.auto_sync_enabled).length,  color: "#ec7211" },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-lg border border-gray-300 shadow-sm p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-black mb-1">{c.label}</div>
              <div className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {towers.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
          <Building2 className="w-12 h-12 mx-auto mb-4 text-blue-900" />
          <h3 className="text-lg font-bold text-black mb-2">No Control Towers yet</h3>
          <p className="text-sm text-black mb-6">Add your first AWS Control Tower management account.</p>
          {(user?.role === "owner" || user?.role === "editor") && (
            <Link href="/onboard" className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-md bg-blue-900 hover:bg-blue-800 transition">
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
                    {ct.auto_sync_enabled && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-300">Auto-sync</span>}
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
                {ct.last_synced_at ? new Date(ct.last_synced_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "Never"}
              </div>
              <div className="col-span-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {(user?.role === "owner" || user?.role === "editor") && (
                  <>
                    <button onClick={() => setSyncModalCt(ct)} disabled={syncStatuses[ct.id]?.status === "running"}
                      className="p-1.5 rounded hover:bg-blue-100 text-black hover:text-blue-900 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      title={syncStatuses[ct.id]?.status === "running" ? "Sync in progress" : "Sync"}>
                      <RefreshCw className={`w-3.5 h-3.5 ${syncStatuses[ct.id]?.status === "running" ? "animate-spin text-blue-900" : ""}`} />
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
                <SyncProgressBar ctId={ct.id} onSyncComplete={() => invalidateAfterSync(ct.id)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {syncModalCt && <SyncModal ct={syncModalCt} onClose={() => setSyncModalCt(null)} onSync={handleSync} />}
    </div>
  );
}
