"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { RefreshCw, Download, IndianRupee, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { generateAwsMonthlyReport, generateCtReport, CTData, ServiceCost } from "@/lib/awsMonthlyReport";
import { DEFAULT_APP_MAPPINGS, AppMapping, APP_VERTICAL_MAP } from "@/lib/awsMonthlyReportConfig";

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getLastMonth() {
  const n = new Date();
  return {
    start: fmtDate(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
    end:   fmtDate(new Date(n.getFullYear(), n.getMonth(), 0)),
    label: new Date(n.getFullYear(), n.getMonth() - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }),
  };
}

function getMonthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    opts.push({
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      start: fmtDate(new Date(d.getFullYear(), d.getMonth(), 1)),
      end:   fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    });
  }
  return opts;
}

// ── Fetch CT data from API ────────────────────────────────────────────────────
async function fetchCtData(towers: any[], start: string, end: string): Promise<CTData[]> {
  return Promise.all(
    towers.filter((t: any) => t.cloud_provider === "aws").map(async (ct: any) => {
      const res = await api.get("/reports/savings/ct-distribution", {
        params: { ct_id: ct.id, start_date: start, end_date: end },
      }).catch(() => ({ data: null }));

      const accounts: CTData["accounts"] = [];
      if (res.data?.sub_accounts) {
        for (const acc of res.data.sub_accounts) {
          accounts.push({
            accountId:   acc.aws_account_id,
            accountName: (acc.account_name || acc.aws_account_id).replace(" (Payer)", ""),
            usageCost:   acc.usage_cost || 0,
            trueCost:    acc.true_cost  || 0,
          });
        }
      } else {
        const sumRes = await api.post("/reports/summary", {
          control_tower_ids: [ct.id], start_date: start, end_date: end,
          granularity: "monthly", metric: "unblended_cost", group_by: "account",
          charge_types: ["Usage", "SavingsPlanCoveredUsage", "DiscountedUsage", "RIFee"],
        }).catch(() => ({ data: null }));
        for (const acc of sumRes.data?.per_account || []) {
          accounts.push({ accountId: acc.aws_account_id, accountName: acc.account_name || acc.aws_account_id, usageCost: acc.cost || 0, trueCost: acc.cost || 0 });
        }
      }
      return { ctName: ct.name, ctId: ct.id, accounts };
    })
  );
}

// ── Editable mapping row ──────────────────────────────────────────────────────
function MappingRow({
  row, index, onUpdate, onDelete, allAccounts, usdCost, inrCost, rate,
}: {
  row: AppMapping; index: number;
  onUpdate: (i: number, updated: AppMapping) => void;
  onDelete: (i: number) => void;
  allAccounts: { accountId: string; accountName: string }[];
  usdCost: number | null;
  inrCost: number | null;
  rate: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AppMapping>(row);

  const save = () => { onUpdate(index, draft); setEditing(false); };
  const cancel = () => { setDraft(row); setEditing(false); };

  const vertical = APP_VERTICAL_MAP[row.appName] || "—";
  const fmtUSD = (v: number | null) => v != null ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
  const fmtINR = (v: number | null) => v != null ? `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

  if (!editing) {
    return (
      <tr className="border-b border-slate-100 hover:bg-slate-50 transition">
        <td className="px-4 py-2 text-xs font-semibold text-slate-800 truncate">{row.appName}</td>
        <td className="px-3 py-2">
          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
            vertical === "SFL" ? "bg-blue-100 text-blue-700" : vertical === "Non - SFL" ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-500"
          }`}>{vertical}</span>
        </td>
        <td className="px-4 py-2 text-right text-xs font-bold font-mono text-blue-700">{fmtUSD(usdCost)}</td>
        <td className="px-4 py-2 text-right text-xs font-bold font-mono text-emerald-700">
          {rate > 0 ? fmtINR(inrCost) : <span className="text-[10px] text-slate-300">enter rate</span>}
        </td>
        <td className="px-3 py-2">
          <div className="flex gap-1 justify-end">
            <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-blue-100 text-blue-600"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => onDelete(index)} className="p-1 rounded hover:bg-red-100 text-red-500"><Trash2 className="w-3 h-3" /></button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-blue-100 bg-blue-50">
      <td className="px-4 py-2">
        <input value={draft.appName} onChange={(e) => setDraft({ ...draft, appName: e.target.value })}
          className="w-full border border-slate-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-600 mb-1" />
        <div className="space-y-1">
          {draft.accounts.map((a, ai) => (
            <div key={ai} className="flex gap-1 items-center">
              <input value={a.accountId} onChange={(e) => { const accs = [...draft.accounts]; accs[ai] = { ...accs[ai], accountId: e.target.value }; setDraft({ ...draft, accounts: accs }); }}
                placeholder="Account ID" className="w-32 border border-slate-300 rounded px-2 py-0.5 text-[11px] outline-none focus:border-blue-600" />
              <input value={a.fraction != null ? String(a.fraction * 100) : "100"} onChange={(e) => { const accs = [...draft.accounts]; accs[ai] = { ...accs[ai], fraction: parseFloat(e.target.value) / 100 }; setDraft({ ...draft, accounts: accs }); }}
                placeholder="%" className="w-10 border border-slate-300 rounded px-2 py-0.5 text-[11px] outline-none focus:border-blue-600" />
              <span className="text-[10px] text-slate-400">%</span>
              <button onClick={() => { const accs = draft.accounts.filter((_, i) => i !== ai); setDraft({ ...draft, accounts: accs }); }} className="text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
            </div>
          ))}
          <button onClick={() => setDraft({ ...draft, accounts: [...draft.accounts, { accountId: "", fraction: 1 }] })}
            className="text-[11px] text-blue-600 hover:underline flex items-center gap-0.5"><Plus className="w-3 h-3" />Add</button>
        </div>
      </td>
      <td className="px-3 py-2">
        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
          vertical === "SFL" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"
        }`}>{vertical}</span>
      </td>
      <td className="px-4 py-2 text-right text-[11px] font-mono text-blue-700">{fmtUSD(usdCost)}</td>
      <td className="px-4 py-2 text-right text-[11px] font-mono text-emerald-700">{rate > 0 ? fmtINR(inrCost) : "—"}</td>
      <td className="px-3 py-2">
        <div className="flex gap-1 justify-end">
          <button onClick={save} className="p-1 rounded hover:bg-green-100 text-green-700"><Check className="w-3 h-3" /></button>
          <button onClick={cancel} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="w-3 h-3" /></button>
        </div>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { token, fetchMe } = useAuthStore();
  const router = useRouter();

  useEffect(() => { if (!token) { router.push("/auth"); return; } fetchMe(); }, [token]);

  const { data: towers = [] } = useQuery({
    queryKey: ["towers"],
    queryFn: () => api.get("/towers/").then((r) => r.data),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  const monthOptions = getMonthOptions();
  const lastMonth    = getLastMonth();

  // ── Monthly report state ──────────────────────────────────────────────────
  const [reportMonth, setReportMonth]   = useState(monthOptions[0]);
  const [reportStart, setReportStart]   = useState(monthOptions[0].start);
  const [reportEnd, setReportEnd]       = useState(monthOptions[0].end);
  const [reportCustom, setReportCustom] = useState(false); // false = month picker, true = custom range
  const [inrRate, setInrRate]           = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [mappings, setMappings]         = useState<AppMapping[]>(DEFAULT_APP_MAPPINGS);
  const [ctDataCache, setCtDataCache]   = useState<CTData[]>([]);
  const [costLoading, setCostLoading]   = useState(false);
  const [sflFilter, setSflFilter]       = useState<"all" | "SFL" | "Non - SFL">("all");

  // ── Individual CT download state ──────────────────────────────────────────
  const [ctStart, setCtStart]           = useState(lastMonth.start);
  const [ctEnd, setCtEnd]               = useState(lastMonth.end);
  const [ctInrRate, setCtInrRate]       = useState("");
  const [selectedCtId, setSelectedCtId] = useState<string>("");
  const [ctLoading, setCtLoading]       = useState(false);

  // Auto-sync CT rate from monthly report rate when CT rate not yet set
  useEffect(() => { if (inrRate && !ctInrRate) setCtInrRate(inrRate); }, [inrRate]); // eslint-disable-line

  const awsTowers = towers.filter((t: any) => t.cloud_provider === "aws");

  // ── Compute USD cost directly from trueCost (no rate needed) ──────────────
  function computeMappingCostUSD(m: AppMapping, ctData: CTData[]): number {
    const accMap = new Map<string, number>();
    for (const ct of ctData) for (const acc of ct.accounts) accMap.set(acc.accountId, (accMap.get(acc.accountId) || 0) + acc.trueCost);

    const novacCT = ctData.find((c) => c.ctName.toLowerCase().includes("novac") && !c.ctName.toLowerCase().includes("wonder") && !c.ctName.toLowerCase().includes("credit"));
    const novacSharedMap = new Map<string, number>();
    if (novacCT) {
      const SFL_IDS = new Set(["833660969797", "683092765314", "400487655910"]);
      const sharedAcc = novacCT.accounts.find((a) => a.accountId === "240329355338");
      const regularAccs = novacCT.accounts.filter((a) => a.accountId !== "240329355338" && a.accountId !== "010241470425" && !SFL_IDS.has(a.accountId));
      const sharedUsd = sharedAcc?.trueCost || 0;
      const totalRegularUsd = regularAccs.reduce((s, a) => s + a.trueCost, 0);
      for (const acc of regularAccs) {
        const pct = totalRegularUsd > 0 ? acc.trueCost / totalRegularUsd : 0;
        novacSharedMap.set(acc.accountId, acc.trueCost + sharedUsd * pct);
      }
      const payerAcc = novacCT.accounts.find((a) => a.accountId === "010241470425");
      if (payerAcc) novacSharedMap.set(payerAcc.accountId, payerAcc.trueCost);
    }

    let costUsd = 0;
    for (const { accountId, fraction = 1 } of m.accounts) {
      if (accountId === "__CT_AUTOMALL__") { const ct = ctData.find((c) => c.ctName.toLowerCase().includes("automall")); costUsd += (ct ? ct.accounts.reduce((s, a) => s + a.trueCost, 0) : 0) * fraction; }
      else if (accountId === "__CT_INDOSTAR__") { const ct = ctData.find((c) => c.ctName.toLowerCase().includes("indostar")); costUsd += (ct ? ct.accounts.reduce((s, a) => s + a.trueCost, 0) : 0) * fraction; }
      else if (novacSharedMap.has(accountId)) costUsd += (novacSharedMap.get(accountId) || 0) * fraction;
      else costUsd += (accMap.get(accountId) || 0) * fraction;
    }
    return costUsd;
  }

  // ── Compute live cost for a mapping row (mirrors buildMasterSheet logic) ──
  function computeMappingCost(m: AppMapping, ctData: CTData[], rate: number): number {
    // Build raw trueCost map
    const accMap = new Map<string, number>();
    for (const ct of ctData) for (const acc of ct.accounts) accMap.set(acc.accountId, (accMap.get(acc.accountId) || 0) + acc.trueCost);

    // Build Novac shared-cost totalCostMap (mirrors buildNovacSheet)
    const novacTotalCostMap = new Map<string, number>();
    const novacCT = ctData.find((c) => c.ctName.toLowerCase().includes("novac") && !c.ctName.toLowerCase().includes("wonder") && !c.ctName.toLowerCase().includes("credit"));
    if (novacCT && rate > 0) {
      const SFL_IDS = new Set(["833660969797", "683092765314", "400487655910"]);
      const sharedAcc = novacCT.accounts.find((a) => a.accountId === "240329355338");
      const regularAccs = novacCT.accounts.filter((a) => a.accountId !== "240329355338" && a.accountId !== "010241470425" && !SFL_IDS.has(a.accountId));
      const sharedUsd = sharedAcc?.trueCost || 0;
      const totalRegularInr = regularAccs.reduce((s, a) => s + a.trueCost * rate, 0);
      for (const acc of regularAccs) {
        const costInr = acc.trueCost * rate;
        const pct = totalRegularInr > 0 ? costInr / totalRegularInr : 0;
        novacTotalCostMap.set(acc.accountId, costInr + sharedUsd * rate * pct);
      }
      // Payer (Redington): trueCost × rate
      const payerAcc = novacCT.accounts.find((a) => a.accountId === "010241470425");
      if (payerAcc) novacTotalCostMap.set(payerAcc.accountId, payerAcc.trueCost * rate);
    }

    let costInr = 0;
    for (const { accountId, fraction = 1 } of m.accounts) {
      if (accountId === "__CT_AUTOMALL__") { const ct = ctData.find((c) => c.ctName.toLowerCase().includes("automall")); costInr += (ct ? ct.accounts.reduce((s,a)=>s+a.trueCost,0) : 0) * rate * fraction; }
      else if (accountId === "__CT_INDOSTAR__") { const ct = ctData.find((c) => c.ctName.toLowerCase().includes("indostar")); costInr += (ct ? ct.accounts.reduce((s,a)=>s+a.trueCost,0) : 0) * rate * fraction; }
      else if (novacTotalCostMap.has(accountId)) costInr += (novacTotalCostMap.get(accountId) || 0) * fraction;
      else costInr += (accMap.get(accountId) || 0) * rate * fraction;
    }
    return costInr;
  }

  // Load CT data whenever month changes and rate is set
  const reportEffectiveStart = reportCustom ? reportStart : reportMonth.start;
  const reportEffectiveEnd   = reportCustom ? reportEnd   : reportMonth.end;
  const reportEffectiveLabel = reportCustom ? `${reportStart}_${reportEnd}` : reportMonth.label.replace(" ", "");

  // Load CT data whenever date range changes — no rate needed for USD
  const loadCostPreview = async (start: string, end: string) => {
    if (awsTowers.length === 0) return;
    setCostLoading(true);
    try { const data = await fetchCtData(awsTowers, start, end); setCtDataCache(data); }
    catch (e) { console.error(e); }
    finally { setCostLoading(false); }
  };

  // Auto-load when towers ready or date range changes
  useEffect(() => {
    if (awsTowers.length > 0) loadCostPreview(reportEffectiveStart, reportEffectiveEnd);
  }, [awsTowers.length, reportEffectiveStart, reportEffectiveEnd]); // eslint-disable-line

  const rate = parseFloat(inrRate) || 0;

  // ── Download full monthly report ──────────────────────────────────────────
  const handleDownload = async () => {
    const rate = parseFloat(inrRate);
    if (!rate || rate <= 0) { toast.error("Enter a valid INR rate"); return; }
    setReportLoading(true);
    try {
      const ctDataList = await fetchCtData(awsTowers, reportEffectiveStart, reportEffectiveEnd);
      generateAwsMonthlyReport(ctDataList, rate, reportEffectiveLabel, mappings);
      toast.success("Report downloaded");
    } catch (e) { console.error(e); toast.error("Failed to generate report"); }
    finally { setReportLoading(false); }
  };

  // ── Download individual CT report ─────────────────────────────────────────
  const handleCtDownload = async () => {
    const rate = parseFloat(ctInrRate);
    if (!rate || rate <= 0) { toast.error("Enter a valid INR rate"); return; }
    if (!selectedCtId) { toast.error("Select a control tower"); return; }
    setCtLoading(true);
    try {
      const ct = awsTowers.find((t: any) => t.id === selectedCtId);
      if (!ct) throw new Error("CT not found");

      const [ctDataList, svcRes] = await Promise.all([
        fetchCtData([ct], ctStart, ctEnd),
        api.post("/reports/service-wise", {
          control_tower_ids: [selectedCtId],
          start_date: ctStart, end_date: ctEnd,
          granularity: "monthly", metric: "unblended_cost",
          group_by: "service",
          charge_types: ["Usage", "SavingsPlanCoveredUsage", "DiscountedUsage", "RIFee"],
        }).catch(() => ({ data: [] })),
      ]);

      const ctData = ctDataList[0];

      // Build service map per account from service-wise API
      // We need per-account service breakdown — call account-filtered service-wise for each account
      const servicesByCt = new Map<string, ServiceCost[]>();
      await Promise.all(
        ctData.accounts.map(async (acc) => {
          const res = await api.post("/reports/service-wise", {
            control_tower_ids: [selectedCtId],
            account_ids: [acc.accountId],
            start_date: ctStart, end_date: ctEnd,
            granularity: "monthly", metric: "unblended_cost",
            group_by: "service",
          }).catch(() => ({ data: [] }));
          servicesByCt.set(acc.accountId, (res.data || []).map((r: any) => ({
            service:   r.service || "-",
            usageCost: r.usage_cost || 0,
            trueCost:  r.actual_cost || 0,
          })));
        })
      );

      const monthLabel = new Date(ctStart).toLocaleString("en-US", { month: "long", year: "numeric" }).replace(" ", "");
      generateCtReport(ctData, rate, monthLabel, servicesByCt);
      toast.success(`${ct.name} report downloaded`);
    } catch (e) { console.error(e); toast.error("Failed to generate CT report"); }
    finally { setCtLoading(false); }
  };

  const updateMapping = (i: number, updated: AppMapping) => {
    setMappings((prev) => prev.map((m, idx) => idx === i ? updated : m));
  };
  const deleteMapping = (i: number) => setMappings((prev) => prev.filter((_, idx) => idx !== i));
  const addMapping    = () => setMappings((prev) => [...prev, { appName: "New App", note: "", accounts: [{ accountId: "", fraction: 1 }] }]);
  const resetMappings = () => { setMappings(DEFAULT_APP_MAPPINGS); toast.success("Reset to defaults"); };

  const filteredMappings = sflFilter === "all" ? mappings : mappings.filter((m) => (APP_VERTICAL_MAP[m.appName] || "Non - SFL") === sflFilter);

  const filteredGrandUSD = ctDataCache.length > 0
    ? filteredMappings.reduce((s, m) => s + computeMappingCostUSD(m, ctDataCache), 0)
    : 0;
  const filteredGrandINR = rate > 0 && ctDataCache.length > 0
    ? filteredMappings.reduce((s, m) => s + computeMappingCost(m, ctDataCache, rate), 0)
    : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-5 space-y-4 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="rounded-xl px-5 py-3.5 flex items-center justify-between" style={{ background: "linear-gradient(135deg,#0f2d5e 0%,#1a6fa8 100%)" }}>
          <div>
            <h1 className="text-base font-extrabold text-white tracking-tight">AWS Monthly Cost Report</h1>
            <p className="text-blue-200 text-[11px] mt-0.5">Multi-sheet Excel · Master sheet with shared cost split</p>
          </div>
          <div className="text-right">
            <div className="text-blue-300 text-[10px] font-semibold uppercase tracking-wider">Control Towers</div>
            <div className="text-white text-xl font-extrabold leading-none mt-0.5">{awsTowers.length}</div>
          </div>
        </div>

        {/* Two cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Full Monthly Report */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1 h-4 rounded-full bg-blue-600" />
              <span className="text-sm font-bold text-slate-800">Full Monthly Report</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-3 ml-3">All CTs · shared cost split · Master + per-CT sheets</p>

            {/* By Month / Custom toggle */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 w-fit mb-3">
              {([false, true] as const).map((c) => (
                <button key={String(c)} onClick={() => setReportCustom(c)}
                  className={`px-3 py-1 text-[11px] font-bold rounded-md transition ${
                    reportCustom === c ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}>{c ? "Custom Range" : "By Month"}</button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              {!reportCustom ? (
                <div className="col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 block">Month</label>
                  <select value={reportMonth.start}
                    onChange={(e) => { const m = monthOptions.find((m) => m.start === e.target.value) || monthOptions[0]; setReportMonth(m); setReportStart(m.start); setReportEnd(m.end); }}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-600 outline-none bg-white">
                    {monthOptions.map((m) => <option key={m.start} value={m.start}>{m.label}</option>)}
                  </select>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 block">From</label>
                    <input type="date" value={reportStart} onChange={(e) => setReportStart(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-600 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 block">To</label>
                    <input type="date" value={reportEnd} onChange={(e) => setReportEnd(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-600 outline-none" />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 block">1 USD = INR</label>
                <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:border-blue-600">
                  <div className="px-2 py-1.5 bg-slate-50 border-r border-slate-200"><IndianRupee className="w-3 h-3 text-slate-400" /></div>
                  <input type="number" value={inrRate} onChange={(e) => setInrRate(e.target.value)}
                    placeholder="84.50" className="flex-1 px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none" />
                </div>
              </div>
              <button onClick={handleDownload} disabled={reportLoading || awsTowers.length === 0 || !inrRate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-lg transition disabled:opacity-50 whitespace-nowrap">
                {reportLoading ? <><RefreshCw className="w-3 h-3 animate-spin" />Generating...</> : <><Download className="w-3 h-3" />Download Excel</>}
              </button>
            </div>
          </div>

          {/* Individual CT Report */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1 h-4 rounded-full bg-orange-500" />
              <span className="text-sm font-bold text-slate-800">Individual CT Report</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-3 ml-3">Account-wise + service-wise per sub-account</p>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 block">Control Tower</label>
                <select value={selectedCtId} onChange={(e) => setSelectedCtId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-600 outline-none bg-white">
                  <option value="">Select CT</option>
                  {awsTowers.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 block">From</label>
                <input type="date" value={ctStart} onChange={(e) => setCtStart(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-600 outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 block">To</label>
                <input type="date" value={ctEnd} onChange={(e) => setCtEnd(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-600 outline-none" />
              </div>
            </div>

            {/* Quick period buttons */}
            <div className="flex gap-1 mb-2">
              {[
                { label: "Last Month", s: lastMonth.start, e: lastMonth.end },
                { label: "This Month", s: fmtDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), e: fmtDate(new Date()) },
              ].map((p) => (
                <button key={p.label} onClick={() => { setCtStart(p.s); setCtEnd(p.e); }}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-md border transition ${
                    ctStart === p.s && ctEnd === p.e ? "bg-blue-700 text-white border-blue-700" : "bg-white text-slate-600 border-slate-300 hover:border-blue-500"
                  }`}>{p.label}</button>
              ))}
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 block">1 USD = INR</label>
                <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:border-blue-600">
                  <div className="px-2 py-1.5 bg-slate-50 border-r border-slate-200"><IndianRupee className="w-3 h-3 text-slate-400" /></div>
                  <input type="number" value={ctInrRate} onChange={(e) => setCtInrRate(e.target.value)}
                    placeholder="84.50" className="flex-1 px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none" />
                </div>
              </div>
              <button onClick={handleCtDownload} disabled={ctLoading || !selectedCtId || !ctInrRate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg transition disabled:opacity-50 whitespace-nowrap">
                {ctLoading ? <><RefreshCw className="w-3 h-3 animate-spin" />Generating...</> : <><Download className="w-3 h-3" />Download CT Excel</>}
              </button>
            </div>
          </div>
        </div>

        {/* Master Sheet Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

          {/* Table toolbar */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <span className="text-sm font-bold text-slate-800">Master Sheet — Application Cost</span>
              <span className="ml-2 text-[11px] text-slate-400">Note hidden in UI · visible in Excel</span>
            </div>
            <div className="flex items-center gap-2">
              {/* SFL filter */}
              <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
                {(["all", "SFL", "Non - SFL"] as const).map((f) => (
                  <button key={f} onClick={() => setSflFilter(f)}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition ${
                      sflFilter === f ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    }`}>{f === "all" ? "All" : f}</button>
                ))}
              </div>
              <button onClick={resetMappings} className="px-2.5 py-1 text-[11px] font-bold border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition">Reset</button>
              <button onClick={addMapping} className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition">
                <Plus className="w-3 h-3" />Add Row
              </button>
            </div>
          </div>

          {/* Table */}
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead>
              <tr style={{ background: "linear-gradient(90deg,#0f2d5e 0%,#1a6fa8 100%)" }}>
                <th className="text-left text-[11px] font-bold uppercase tracking-wide text-white px-4 py-2.5">Application</th>
                <th className="text-left text-[11px] font-bold uppercase tracking-wide text-white px-3 py-2.5">Vertical</th>
                <th className="text-right text-[11px] font-bold uppercase tracking-wide text-white px-4 py-2.5">Cost (USD)</th>
                <th className="text-right text-[11px] font-bold uppercase tracking-wide text-white px-4 py-2.5">
                  Cost (INR){costLoading && <span className="ml-1 text-[9px] text-blue-200 font-normal animate-pulse">loading...</span>}
                </th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filteredMappings.map((row, i) => {
                const globalIndex = mappings.indexOf(row);
                const usdCost = ctDataCache.length > 0 ? computeMappingCostUSD(row, ctDataCache) : null;
                const inrCost = rate > 0 && ctDataCache.length > 0 ? computeMappingCost(row, ctDataCache, rate) : null;
                return (
                  <MappingRow key={globalIndex} row={row} index={globalIndex} onUpdate={updateMapping} onDelete={deleteMapping} allAccounts={[]}
                    usdCost={usdCost} inrCost={inrCost} rate={rate} />
                );
              })}
              {ctDataCache.length > 0 && (
                <tr className="border-t-2 border-blue-200" style={{ background: "#eef2ff" }}>
                  <td className="px-4 py-2.5 text-xs font-extrabold text-slate-800" colSpan={2}>
                    Total {sflFilter !== "all" && <span className="ml-1 text-[10px] font-semibold text-blue-600">({sflFilter})</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-extrabold font-mono text-blue-800">
                    ${filteredGrandUSD.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-extrabold font-mono text-emerald-700">
                    {rate > 0 ? `₹${filteredGrandINR.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : <span className="text-[10px] text-slate-300">enter rate</span>}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
