import * as XLSX from "xlsx";
import {
  APP_MAPPINGS, NOVAC_SHARED_SERVICES_ID, NOVAC_PAYER_ID,
  SFL_SHARED_ID, SFL_PROD_ID, SFL_UAT_ID,
  AUTOMALL_PAYER_ID, INDOSTAR_PAYER_ID,
} from "./awsMonthlyReportConfig";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AccountCost { accountId: string; accountName: string; trueCost: number; }
interface CTData { ctName: string; ctId: string; accounts: AccountCost[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function inr(usd: number, rate: number) { return usd * rate; }
function numCell(v: number): XLSX.CellObject { return { t: "n", v, z: '₹#,##0.00', s: { alignment: { horizontal: "left" } } }; }
function pctCell(v: number): XLSX.CellObject { return { t: "n", v, z: "0.00", s: { alignment: { horizontal: "left" } } }; }
function boldCell(v: string): XLSX.CellObject { return { t: "s", v, s: { font: { bold: true } } }; }
function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws["!cols"] = widths.map((w) => ({ wch: w }));
}

// ── Build account cost map from all CTs ───────────────────────────────────────
function buildAccountMap(ctDataList: CTData[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const ct of ctDataList) {
    for (const acc of ct.accounts) {
      map.set(acc.accountId, (map.get(acc.accountId) || 0) + acc.trueCost);
    }
  }
  return map;
}

function ctTotal(ct: CTData): number {
  return ct.accounts.reduce((s, a) => s + a.trueCost, 0);
}

// ── Sheet 1: Master ───────────────────────────────────────────────────────────
function buildMasterSheet(ctDataList: CTData[], rate: number): XLSX.WorkSheet {
  const accMap = buildAccountMap(ctDataList);
  const ctMap = new Map(ctDataList.map((ct) => [ct.ctName.toLowerCase(), ctTotal(ct)]));

  const rows: any[][] = [
    [boldCell("Application Name"), boldCell("Cost in INR"), boldCell("Note")],
  ];

  let grandTotal = 0;
  for (const m of APP_MAPPINGS) {
    let usd = 0;
    for (const { accountId, fraction = 1 } of m.accounts) {
      if (accountId === "__CT_AUTOMALL__") {
        const ct = ctDataList.find((c) => c.ctName.toLowerCase().includes("automall"));
        usd += (ct ? ctTotal(ct) : 0) * fraction;
      } else if (accountId === "__CT_INDOSTAR__") {
        const ct = ctDataList.find((c) => c.ctName.toLowerCase().includes("indostar"));
        usd += (ct ? ctTotal(ct) : 0) * fraction;
      } else {
        usd += (accMap.get(accountId) || 0) * fraction;
      }
    }
    const costInr = inr(usd, rate);
    grandTotal += costInr;
    rows.push([m.appName, numCell(costInr), m.note]);
  }

  rows.push([boldCell("Total"), numCell(grandTotal), ""]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setColWidths(ws, [28, 18, 50]);
  return ws;
}

// ── Sheet: Novac (with shared cost split + SFL below) ────────────────────────
function buildNovacSheet(novacCT: CTData, rate: number): XLSX.WorkSheet {
  const accounts = novacCT.accounts;

  // Separate shared-services, payer, SFL group, and regular accounts
  const sharedAcc  = accounts.find((a) => a.accountId === NOVAC_SHARED_SERVICES_ID);
  const payerAcc   = accounts.find((a) => a.accountId === NOVAC_PAYER_ID);
  const sflAccs    = accounts.filter((a) => [SFL_PROD_ID, SFL_UAT_ID, SFL_SHARED_ID].includes(a.accountId));
  const regularAccs = accounts.filter((a) =>
    a.accountId !== NOVAC_SHARED_SERVICES_ID &&
    a.accountId !== NOVAC_PAYER_ID &&
    ![SFL_PROD_ID, SFL_UAT_ID, SFL_SHARED_ID].includes(a.accountId)
  );

  const sharedUsd  = sharedAcc?.trueCost || 0;
  const totalRegularInr = regularAccs.reduce((s, a) => s + inr(a.trueCost, rate), 0);

  // SFL: SFL-SHARED splits into SFL-PROD + SFL-UAT proportionally
  const sflSharedUsd = sflAccs.find((a) => a.accountId === SFL_SHARED_ID)?.trueCost || 0;
  const sflProdUsd   = sflAccs.find((a) => a.accountId === SFL_PROD_ID)?.trueCost || 0;
  const sflUatUsd    = sflAccs.find((a) => a.accountId === SFL_UAT_ID)?.trueCost || 0;
  const sflBase      = sflProdUsd + sflUatUsd;
  const sflProdShare = sflBase > 0 ? sflProdUsd / sflBase : 0;
  const sflUatShare  = sflBase > 0 ? sflUatUsd / sflBase : 0;

  const rows: any[][] = [];

  // Header info row
  rows.push(["Dollar", rate, "", "", "Total cost", numCell(inr(regularAccs.reduce((s, a) => s + a.trueCost, 0), rate))]);
  rows.push(["", "", "", "", "Shared cost", numCell(inr(sharedUsd, rate))]);
  rows.push([]);

  // Table header
  rows.push([
    boldCell("Account ID"), boldCell("Account"), boldCell("Usage Cost"),
    boldCell("True Cost"), boldCell("Cost in INR"), boldCell("Percentage"),
    boldCell("Shared cost"), boldCell("Total cost"),
  ]);

  // Regular accounts
  let totalUsd = 0, totalInr = 0, totalShared = 0, totalFinal = 0;
  for (const acc of regularAccs) {
    const costInr   = inr(acc.trueCost, rate);
    const pct       = totalRegularInr > 0 ? costInr / totalRegularInr * 100 : 0;
    const sharedCost = inr(sharedUsd, rate) * pct / 100;
    const finalCost  = costInr + sharedCost;
    totalUsd    += acc.trueCost;
    totalInr    += costInr;
    totalShared += sharedCost;
    totalFinal  += finalCost;
    rows.push([acc.accountId, acc.accountName, numCell(acc.trueCost), numCell(acc.trueCost), numCell(costInr), pctCell(pct), numCell(sharedCost), numCell(finalCost)]);
  }

  // Payer row (no shared cost)
  if (payerAcc) {
    const costInr = inr(payerAcc.trueCost, rate);
    rows.push([payerAcc.accountId, payerAcc.accountName, numCell(payerAcc.trueCost), numCell(payerAcc.trueCost), numCell(costInr), "", "", numCell(costInr)]);
  }

  // Total row
  rows.push([
    boldCell(""), boldCell("Total Cost"),
    numCell(totalUsd), numCell(totalUsd), numCell(totalInr),
    pctCell(100), numCell(totalShared), numCell(totalFinal),
  ]);

  rows.push([]);

  // SFL section below
  const sflRows = [
    { acc: sflAccs.find((a) => a.accountId === SFL_SHARED_ID)!, share: null },
    { acc: sflAccs.find((a) => a.accountId === SFL_PROD_ID)!, share: sflProdShare },
    { acc: sflAccs.find((a) => a.accountId === SFL_UAT_ID)!, share: sflUatShare },
  ].filter((r) => r.acc);

  let sflTotal = 0;
  for (const { acc, share } of sflRows) {
    const costInr = inr(acc.trueCost, rate);
    const allocatedShared = share != null ? inr(sflSharedUsd, rate) * share : 0;
    const finalCost = costInr + allocatedShared;
    sflTotal += finalCost;
    rows.push([acc.accountId, acc.accountName, numCell(acc.trueCost), numCell(acc.trueCost), numCell(costInr), "", "", numCell(finalCost)]);
  }
  rows.push(["", "", "", "", numCell(sflTotal)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setColWidths(ws, [18, 22, 14, 14, 16, 12, 14, 16]);
  return ws;
}

// ── Sheet: Generic CT (account-wise, no shared split) ────────────────────────
function buildGenericSheet(ct: CTData, rate: number, excludePayerIds: string[] = []): XLSX.WorkSheet {
  const rows: any[][] = [
    [boldCell("Account ID"), boldCell("Account"), boldCell("Usage Cost"), boldCell("True Cost"), boldCell("Cost in INR")],
  ];

  let totalUsd = 0, totalInr = 0;
  for (const acc of ct.accounts) {
    const costInr = inr(acc.trueCost, rate);
    totalUsd += acc.trueCost;
    totalInr += costInr;
    rows.push([acc.accountId, acc.accountName, numCell(acc.trueCost), numCell(acc.trueCost), numCell(costInr)]);
  }

  rows.push([boldCell(""), boldCell("Total"), numCell(totalUsd), numCell(totalUsd), numCell(totalInr)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setColWidths(ws, [18, 24, 14, 14, 16]);
  return ws;
}

// ── Main export function ──────────────────────────────────────────────────────
export function generateAwsMonthlyReport(
  ctDataList: CTData[],
  rate: number,
  monthLabel: string,
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Master
  XLSX.utils.book_append_sheet(wb, buildMasterSheet(ctDataList, rate), "Master");

  // Remaining sheets in CT order — Novac first (with SFL inline), then others
  for (const ct of ctDataList) {
    const nameL = ct.ctName.toLowerCase();
    if (nameL.includes("novac") && !nameL.includes("wonder") && !nameL.includes("credit")) {
      XLSX.utils.book_append_sheet(wb, buildNovacSheet(ct, rate), ct.ctName.slice(0, 31));
    } else {
      XLSX.utils.book_append_sheet(wb, buildGenericSheet(ct, rate), ct.ctName.slice(0, 31));
    }
  }

  XLSX.writeFile(wb, `AWS-Monthly-Cost-${monthLabel}.xlsx`);
}

export type { CTData, AccountCost };
