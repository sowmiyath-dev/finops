"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { RefreshCw, Download, IndianRupee, Plus, Trash2, Pencil, Check, X, ChevronDown } from "lucide-react";
import { generateAwsMonthlyReport, generateCtReport, CTData, ServiceCost } from "@/lib/awsMonthlyReport";
import { DEFAULT_APP_MAPPINGS, AppMapping } from "@/lib/awsMonthlyReportConfig";

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
  row, index, onUpdate, onDelete, allAccounts,
}: {
  row: AppMapping; index: number;
  onUpdate: (i: number, updated: AppMapping) => void;
  onDelete: (i: number) => void;
  allAccounts: { accountId: string; accountName: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AppMapping>(row);

  const save = () => { onUpdate(index, draft); setEditing(false); };
  const cancel = () => { setDraft(row); setEditing(false); };

  if (!editing) {
    return (
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="px-3 py-2 text-xs font-semibold text-black">{row.appName}</td>
        <td className="px-3 py-2 text-xs text-gray-500">{row.accounts.map((a) => `${a.accountId}${a.fraction && a.fraction !== 1 ? ` (${(a.fraction * 100).toFixed(0)}%)` : ""}`).join(", ")}</td>
        <td className="px-3 py-2 text-xs text-gray-400">{row.note}</td>
        <td className="px-3 py-2">
          <div className="flex gap-1">
            <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-blue-100 text-blue-900"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => onDelete(index)} className="p-1 rounded hover:bg-red-100 text-red-600"><Trash2 className="w-3 h-3" /></button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-blue-100 bg-blue-50">
      <td className="px-3 py-2">
        <input value={draft.appName} onChange={(e) => setDraft({ ...draft, appName: e.target.value })}
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-900" />
      </td>
      <td className="px-3 py-2">
        <div className="space-y-1">
          {draft.accounts.map((a, ai) => (
            <div key={ai} className="flex gap-1 items-center">
              <input value={a.accountId} onChange={(e) => {
                const accs = [...draft.accounts]; accs[ai] = { ...accs[ai], accountId: e.target.value };
                setDraft({ ...draft, accounts: accs });
              }} placeholder="Account ID" className="w-32 border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-900" />
              <input value={a.fraction != null ? String(a.fraction * 100) : "100"} onChange={(e) => {
                const accs = [...draft.accounts]; accs[ai] = { ...accs[ai], fraction: parseFloat(e.target.value) / 100 };
                setDraft({ ...draft, accounts: accs });
              }} placeholder="%" className="w-14 border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-900" />
              <span className="text-xs text-gray-400">%</span>
              <button onClick={() => { const accs = draft.accounts.filter((_, i) => i !== ai); setDraft({ ...draft, accounts: accs }); }}
                className="text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
            </div>
          ))}
          <button onClick={() => setDraft({ ...draft, accounts: [...draft.accounts, { accountId: "", fraction: 1 }] })}
            className="text-xs text-blue-900 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add account</button>
        </div>
      </td>
      <td className="px-3 py-2">
        <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-900" />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <button onClick={save} className="p-1 rounded hover:bg-green-100 text-green-700"><Check className="w-3 h-3" /></button>
          <button onClick={cancel} className="p-1 rounded hover:bg-gray-100 text-gray-500"><X className="w-3 h-3" /></button>
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
  const [inrRate, setInrRate]           = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [mappings, setMappings]         = useState<AppMapping[]>(DEFAULT_APP_MAPPINGS);

  // ── Individual CT download state ──────────────────────────────────────────
  const [ctStart, setCtStart]           = useState(lastMonth.start);
  const [ctEnd, setCtEnd]               = useState(lastMonth.end);
  const [ctInrRate, setCtInrRate]       = useState("");
  const [selectedCtId, setSelectedCtId] = useState<string>("");
  const [ctLoading, setCtLoading]       = useState(false);

  const awsTowers = towers.filter((t: any) => t.cloud_provider === "aws");

  // ── Download full monthly report ──────────────────────────────────────────
  const handleDownload = async () => {
    const rate = parseFloat(inrRate);
    if (!rate || rate <= 0) { toast.error("Enter a valid INR rate"); return; }
    setReportLoading(true);
    try {
      const ctDataList = await fetchCtData(awsTowers, reportMonth.start, reportMonth.end);
      generateAwsMonthlyReport(ctDataList, rate, reportMonth.label.replace(" ", ""), mappings);
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

  return (
    <div className="p-6 space-y-6">

      {/* ── Monthly Report Card ── */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
        <h2 className="text-sm font-bold text-black mb-1">AWS Monthly Cost Report</h2>
        <p className="text-xs text-gray-500 mb-4">Download full multi-sheet Excel with shared cost split across all control towers</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs font-bold text-black mb-1 block">Month</label>
            <select value={reportMonth.start}
              onChange={(e) => setReportMonth(monthOptions.find((m) => m.start === e.target.value) || monthOptions[0])}
              className="border border-gray-300 rounded-md px-3 py-2 text-xs font-semibold text-black focus:border-blue-900 outline-none bg-white">
              {monthOptions.map((m) => <option key={m.start} value={m.start}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-black mb-1 block">1 USD = INR</label>
            <div className="flex items-center border border-gray-300 rounded-md overflow-hidden focus-within:border-blue-900">
              <div className="px-2 py-2 bg-gray-50 border-r border-gray-300"><IndianRupee className="w-3.5 h-3.5 text-black" /></div>
              <input type="number" value={inrRate} onChange={(e) => setInrRate(e.target.value)}
                placeholder="e.g. 84.50" className="w-24 px-2 py-2 text-xs font-semibold text-black outline-none" />
            </div>
          </div>
          <button onClick={handleDownload} disabled={reportLoading || awsTowers.length === 0 || !inrRate}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
            {reportLoading ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating...</> : <><Download className="w-3.5 h-3.5" /> Download Excel</>}
          </button>
        </div>
      </div>

      {/* ── Individual CT Download Card ── */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
        <h2 className="text-sm font-bold text-black mb-1">Individual CT Report</h2>
        <p className="text-xs text-gray-500 mb-4">Account-wise + service-wise breakdown for a single control tower</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs font-bold text-black mb-1 block">Control Tower</label>
            <select value={selectedCtId} onChange={(e) => setSelectedCtId(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-xs font-semibold text-black focus:border-blue-900 outline-none bg-white min-w-[180px]">
              <option value="">Select CT</option>
              {awsTowers.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-black mb-1 block">From</label>
            <input type="date" value={ctStart} onChange={(e) => setCtStart(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          </div>
          <div>
            <label className="text-xs font-bold text-black mb-1 block">To</label>
            <input type="date" value={ctEnd} onChange={(e) => setCtEnd(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
          </div>
          <div>
            <label className="text-xs font-bold text-black mb-1 block">1 USD = INR</label>
            <div className="flex items-center border border-gray-300 rounded-md overflow-hidden focus-within:border-blue-900">
              <div className="px-2 py-2 bg-gray-50 border-r border-gray-300"><IndianRupee className="w-3.5 h-3.5 text-black" /></div>
              <input type="number" value={ctInrRate} onChange={(e) => setCtInrRate(e.target.value)}
                placeholder="e.g. 84.50" className="w-24 px-2 py-2 text-xs font-semibold text-black outline-none" />
            </div>
          </div>
          <button onClick={handleCtDownload} disabled={ctLoading || !selectedCtId || !ctInrRate}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
            {ctLoading ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating...</> : <><Download className="w-3.5 h-3.5" /> Download CT Excel</>}
          </button>
        </div>
      </div>

      {/* ── Master Mapping Editor ── */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-black">Master Sheet Mapping</h2>
            <p className="text-xs text-gray-500 mt-0.5">Edit application names, account IDs and cost fractions. Changes apply to next download.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={resetMappings}
              className="px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-md text-black hover:bg-gray-50 transition">
              Reset Defaults
            </button>
            <button onClick={addMapping}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-blue-900 text-white rounded-md hover:bg-blue-800 transition">
              <Plus className="w-3 h-3" /> Add Row
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-3 py-2 w-40">Application</th>
                <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-3 py-2">Account IDs (fraction %)</th>
                <th className="text-left text-xs font-bold uppercase tracking-wider text-black px-3 py-2">Note</th>
                <th className="px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {mappings.map((row, i) => (
                <MappingRow key={i} row={row} index={i} onUpdate={updateMapping} onDelete={deleteMapping} allAccounts={[]} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
