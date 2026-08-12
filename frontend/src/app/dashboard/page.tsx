"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { RefreshCw, Download, IndianRupee } from "lucide-react";
import { generateAwsMonthlyReport } from "@/lib/awsMonthlyReport";

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DashboardPage() {
  const { token, fetchMe } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!token) { router.push("/auth"); return; }
    fetchMe();
  }, [token]);

  const { data: towers = [] } = useQuery({
    queryKey: ["towers"],
    queryFn: () => api.get("/towers/").then((r) => r.data.filter((t: any) => t.cloud_provider === "aws")),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  // Month options — last 12 months, default last month
  const reportMonths = (() => {
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
  })();

  const [reportMonth, setReportMonth] = useState(reportMonths[0]);
  const [inrRate, setInrRate] = useState<string>("");
  const [reportLoading, setReportLoading] = useState(false);

  const handleDownload = async () => {
    const rate = parseFloat(inrRate);
    if (!rate || rate <= 0) { toast.error("Enter a valid INR rate"); return; }
    setReportLoading(true);
    try {
      const ctDataList = await Promise.all(
        towers.map(async (ct: any) => {
          const res = await api.get("/reports/savings/ct-distribution", {
            params: { ct_id: ct.id, start_date: reportMonth.start, end_date: reportMonth.end },
          }).catch(() => ({ data: null }));

          const subAccounts: { accountId: string; accountName: string; trueCost: number }[] = [];
          if (res.data?.sub_accounts) {
            for (const acc of res.data.sub_accounts) {
              subAccounts.push({
                accountId:   acc.aws_account_id,
                accountName: (acc.account_name || acc.aws_account_id).replace(" (Payer)", ""),
                trueCost:    acc.true_cost || 0,
              });
            }
          } else {
            const sumRes = await api.post("/reports/summary", {
              control_tower_ids: [ct.id],
              start_date: reportMonth.start,
              end_date:   reportMonth.end,
              granularity: "monthly",
              metric: "unblended_cost",
              group_by: "account",
              charge_types: ["Usage", "SavingsPlanCoveredUsage", "DiscountedUsage", "RIFee"],
            }).catch(() => ({ data: null }));
            for (const acc of sumRes.data?.per_account || []) {
              subAccounts.push({
                accountId:   acc.aws_account_id,
                accountName: acc.account_name || acc.aws_account_id,
                trueCost:    acc.cost || 0,
              });
            }
          }
          return { ctName: ct.name, ctId: ct.id, accounts: subAccounts };
        })
      );
      generateAwsMonthlyReport(ctDataList, rate, reportMonth.label.replace(" ", ""));
      toast.success("Report downloaded");
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate report");
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto mt-10">
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-6">
        <h2 className="text-base font-bold text-black mb-1">AWS Monthly Cost Report</h2>
        <p className="text-xs text-gray-500 mb-5">Select month and enter INR rate to download the full Excel report</p>

        <div className="space-y-4">
          {/* Month */}
          <div>
            <label className="text-xs font-bold text-black mb-1 block">Month</label>
            <select
              value={reportMonth.start}
              onChange={(e) => setReportMonth(reportMonths.find((m) => m.start === e.target.value) || reportMonths[0])}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-semibold text-black focus:border-blue-900 outline-none bg-white">
              {reportMonths.map((m) => (
                <option key={m.start} value={m.start}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* INR Rate */}
          <div>
            <label className="text-xs font-bold text-black mb-1 block">1 USD = INR</label>
            <div className="flex items-center border border-gray-300 rounded-md overflow-hidden focus-within:border-blue-900">
              <div className="px-3 py-2 bg-gray-50 border-r border-gray-300">
                <IndianRupee className="w-4 h-4 text-black" />
              </div>
              <input
                type="number"
                value={inrRate}
                onChange={(e) => setInrRate(e.target.value)}
                placeholder="e.g. 84.50"
                className="flex-1 px-3 py-2 text-sm font-semibold text-black outline-none"
              />
            </div>
          </div>

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={reportLoading || towers.length === 0 || !inrRate}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-sm font-bold rounded-md transition disabled:opacity-50">
            {reportLoading
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</>
              : <><Download className="w-4 h-4" /> Download Excel</>}
          </button>
        </div>
      </div>
    </div>
  );
}
