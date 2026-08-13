import * as XLSX from "xlsx";
import {
  AppMapping,
  APP_VERTICAL_MAP,
  NOVAC_SHARED_SERVICES_ID, NOVAC_PAYER_ID,
  SFL_SHARED_ID, SFL_PROD_ID, SFL_UAT_ID,
} from "./awsMonthlyReportConfig";

export interface AccountCost {
  accountId: string;
  accountName: string;
  usageCost: number;   // USD — cost without SP (Usage only)
  trueCost: number;    // USD — usage + SP allocated
}
export interface CTData { ctName: string; ctId: string; accounts: AccountCost[]; }
export interface ServiceCost { service: string; usageCost: number; trueCost: number; }

// ── Cell helpers ──────────────────────────────────────────────────────────────
function inrCell(v: number): XLSX.CellObject {
  return { t: "n", v, z: "₹#,##0.00", s: { alignment: { horizontal: "left" } } };
}
// Plain USD number — no currency symbol
function usdCell(v: number): XLSX.CellObject {
  return { t: "n", v, z: "#,##0.00", s: { alignment: { horizontal: "left" } } };
}
function pctCell(v: number): XLSX.CellObject {
  return { t: "n", v, z: "0.00", s: { alignment: { horizontal: "left" } } };
}
function boldStr(v: string): XLSX.CellObject {
  return { t: "s", v, s: { font: { bold: true } } };
}
function setWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws["!cols"] = widths.map((w) => ({ wch: w }));
}

function ctTotal(ct: CTData) {
  return ct.accounts.reduce((s, a) => s + a.trueCost, 0);
}

// ── Sheet 1: Master ───────────────────────────────────────────────────────────
function buildMasterSheet(
  ctDataList: CTData[],
  rate: number,
  mappings: AppMapping[],
  novacTotalCostMap: Map<string, number>,
): XLSX.WorkSheet {
  const accMap = new Map<string, number>();
  for (const ct of ctDataList) {
    for (const acc of ct.accounts) {
      accMap.set(acc.accountId, (accMap.get(acc.accountId) || 0) + acc.trueCost);
    }
  }

  const rows: any[][] = [
    [boldStr("Application Name"), boldStr("Vertical"), boldStr("Cost (USD)"), boldStr("Cost in INR"), boldStr("Note")],
  ];

  let grandTotalUsd = 0;
  let grandTotalInr = 0;
  for (const m of mappings) {
    let costUsd = 0;
    for (const { accountId, fraction = 1 } of m.accounts) {
      if (accountId === "__CT_AUTOMALL__") {
        const ct = ctDataList.find((c) => c.ctName.toLowerCase().includes("automall"));
        costUsd += (ct ? ctTotal(ct) : 0) * fraction;
      } else if (accountId === "__CT_INDOSTAR__") {
        const ct = ctDataList.find((c) => c.ctName.toLowerCase().includes("indostar"));
        costUsd += (ct ? ctTotal(ct) : 0) * fraction;
      } else if (accountId === NOVAC_PAYER_ID) {
        costUsd += (accMap.get(accountId) || 0) * fraction;
      } else if (novacTotalCostMap.has(accountId)) {
        // totalCostMap stores INR already — convert back to USD for USD column
        costUsd += ((novacTotalCostMap.get(accountId) || 0) / rate) * fraction;
      } else {
        costUsd += (accMap.get(accountId) || 0) * fraction;
      }
    }
    const costInr = costUsd * rate;
    grandTotalUsd += costUsd;
    grandTotalInr += costInr;
    const vertical = APP_VERTICAL_MAP[m.appName] || "";
    rows.push([m.appName, vertical, usdCell(costUsd), inrCell(costInr), m.note]);
  }
  rows.push([boldStr("Total"), "", usdCell(grandTotalUsd), inrCell(grandTotalInr), ""]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setWidths(ws, [28, 14, 16, 18, 52]);
  return ws;
}

// ── Sheet: Novac ──────────────────────────────────────────────────────────────
// Returns sheet + map of accountId → totalCostINR (for master sheet)
// Redington (payer) shown as LAST row: Cost in INR = 0, Shared = 0, Total = trueCost × rate
function buildNovacSheet(
  novacCT: CTData,
  rate: number,
): { ws: XLSX.WorkSheet; totalCostMap: Map<string, number> } {
  const accounts = novacCT.accounts;

  // 240329355338 = shared pool for regular accounts
  const sharedAcc   = accounts.find((a) => a.accountId === NOVAC_SHARED_SERVICES_ID);
  const payerAcc    = accounts.find((a) => a.accountId === NOVAC_PAYER_ID);
  const sflIds      = new Set([SFL_PROD_ID, SFL_UAT_ID, SFL_SHARED_ID]);
  // Regular accounts: exclude shared-services, payer (Redington), and SFL accounts
  const regularAccs = accounts.filter((a) =>
    a.accountId !== NOVAC_SHARED_SERVICES_ID &&
    a.accountId !== NOVAC_PAYER_ID &&
    !sflIds.has(a.accountId)
  );

  const sharedUsd       = sharedAcc?.trueCost || 0;
  const totalRegularInr = regularAccs.reduce((s, a) => s + a.trueCost * rate, 0);

  const totalCostMap = new Map<string, number>();

  const rows: any[][] = [];
  rows.push(["Dollar", rate, "", "", "", "Total cost", inrCell(totalRegularInr)]);
  rows.push(["", "", "", "", "", "Shared cost", inrCell(sharedUsd * rate)]);
  rows.push([]);
  // Headers: Usage Cost (USD) and True Cost (USD) — no ₹ symbol on those columns
  rows.push([
    boldStr("Account ID"), boldStr("Account"),
    boldStr("Usage Cost (USD)"), boldStr("True Cost (USD)"),
    boldStr("Cost in INR"), boldStr("Percentage"),
    boldStr("Shared cost"), boldStr("Total cost"),
  ]);

  let totUsage = 0, totTrue = 0, totInr = 0, totShared = 0, totFinal = 0;

  for (const acc of regularAccs) {
    const costInr    = acc.trueCost * rate;
    const pct        = totalRegularInr > 0 ? costInr / totalRegularInr * 100 : 0;
    const sharedCost = sharedUsd * rate * pct / 100;
    const finalCost  = costInr + sharedCost;
    totUsage  += acc.usageCost;
    totTrue   += acc.trueCost;
    totInr    += costInr;
    totShared += sharedCost;
    totFinal  += finalCost;
    totalCostMap.set(acc.accountId, finalCost);
    rows.push([
      acc.accountId, acc.accountName,
      usdCell(acc.usageCost), usdCell(acc.trueCost),
      inrCell(costInr), pctCell(pct),
      inrCell(sharedCost), inrCell(finalCost),
    ]);
  }

  // Total row (regular accounts only)
  rows.push([
    boldStr(""), boldStr("Total Cost"),
    usdCell(totUsage), usdCell(totTrue), inrCell(totInr),
    pctCell(100), inrCell(totShared), inrCell(totFinal),
  ]);

  // Redington (payer) — LAST row: Cost in INR = 0, Percentage = 0, Shared = 0, Total = trueCost × rate
  if (payerAcc) {
    const payerTotal = payerAcc.trueCost * rate;
    totalCostMap.set(payerAcc.accountId, payerTotal);
    rows.push([
      payerAcc.accountId, payerAcc.accountName,
      usdCell(payerAcc.usageCost), usdCell(payerAcc.trueCost),
      inrCell(0), pctCell(0), inrCell(0), inrCell(payerTotal),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setWidths(ws, [18, 22, 16, 16, 16, 12, 14, 16]);
  return { ws, totalCostMap };
}

// ── Sheet: SFL ────────────────────────────────────────────────────────────────
// SFL-SHARED-SERVICE (833660969797) cost split proportionally to PROD and UAT
function buildSflSheet(novacCT: CTData, rate: number): XLSX.WorkSheet {
  const accounts   = novacCT.accounts;
  const sflShared  = accounts.find((a) => a.accountId === SFL_SHARED_ID);
  const sflProd    = accounts.find((a) => a.accountId === SFL_PROD_ID);
  const sflUat     = accounts.find((a) => a.accountId === SFL_UAT_ID);

  const sharedUsd  = sflShared?.trueCost || 0;
  const prodUsd    = sflProd?.trueCost || 0;
  const uatUsd     = sflUat?.trueCost || 0;
  const base       = prodUsd + uatUsd;
  const prodShare  = base > 0 ? prodUsd / base : 0.5;
  const uatShare   = base > 0 ? uatUsd / base : 0.5;

  const rows: any[][] = [
    [
      boldStr("Account ID"), boldStr("Account"),
      boldStr("Usage Cost (USD)"), boldStr("True Cost (USD)"),
      boldStr("Cost in INR"), boldStr("Shared cost"), boldStr("Total cost"),
    ],
  ];

  const entries = [
    { acc: sflProd, share: prodShare },
    { acc: sflUat,  share: uatShare },
  ].filter((e) => e.acc);

  let totFinal = 0;
  for (const { acc, share } of entries) {
    if (!acc) continue;
    const costInr    = acc.trueCost * rate;
    const sharedCost = sharedUsd * rate * share;
    const finalCost  = costInr + sharedCost;
    totFinal += finalCost;
    rows.push([
      acc.accountId, acc.accountName,
      usdCell(acc.usageCost), usdCell(acc.trueCost),
      inrCell(costInr), inrCell(sharedCost), inrCell(finalCost),
    ]);
  }

  // SFL-SHARED row for reference (split above, not added to total)
  if (sflShared) {
    rows.push([
      sflShared.accountId, sflShared.accountName,
      usdCell(sflShared.usageCost), usdCell(sflShared.trueCost),
      inrCell(sflShared.trueCost * rate), boldStr("(split above)"), inrCell(0),
    ]);
  }

  rows.push([boldStr(""), boldStr("Total"), usdCell(0), usdCell(0), inrCell(0), inrCell(0), inrCell(totFinal)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setWidths(ws, [18, 24, 16, 16, 16, 14, 16]);
  return ws;
}

// ── Sheet: Generic CT ─────────────────────────────────────────────────────────
function buildGenericSheet(ct: CTData, rate: number): XLSX.WorkSheet {
  const rows: any[][] = [
    [
      boldStr("Account ID"), boldStr("Account"),
      boldStr("Usage Cost (USD)"), boldStr("True Cost (USD)"),
      boldStr("Cost in INR"),
    ],
  ];
  let totUsage = 0, totTrue = 0, totInr = 0;
  for (const acc of ct.accounts) {
    const costInr = acc.trueCost * rate;
    totUsage += acc.usageCost;
    totTrue  += acc.trueCost;
    totInr   += costInr;
    rows.push([acc.accountId, acc.accountName, usdCell(acc.usageCost), usdCell(acc.trueCost), inrCell(costInr)]);
  }
  rows.push([boldStr(""), boldStr("Total"), usdCell(totUsage), usdCell(totTrue), inrCell(totInr)]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  setWidths(ws, [18, 26, 16, 16, 16]);
  return ws;
}

// ── Individual CT download ────────────────────────────────────────────────────
// Sheet 1: account-wise summary
// Sheet per sub-account: service-wise breakdown
export function generateCtReport(
  ct: CTData,
  rate: number,
  monthLabel: string,
  servicesByCt: Map<string, ServiceCost[]>,
  selectedAccountIds?: string[], // if provided, only include these accounts
) {
  const wb = XLSX.utils.book_new();
  const accounts = selectedAccountIds && selectedAccountIds.length > 0
    ? ct.accounts.filter((a) => selectedAccountIds.includes(a.accountId))
    : ct.accounts;

  // Sheet 1: Summary (account-wise)
  const accRows: any[][] = [
    [
      boldStr("Account ID"), boldStr("Account"),
      boldStr("Usage Cost (USD)"), boldStr("True Cost (USD)"),
      boldStr("Cost in INR"),
    ],
  ];
  let totUsage = 0, totTrue = 0, totInr = 0;
  for (const acc of accounts) {
    const costInr = acc.trueCost * rate;
    totUsage += acc.usageCost; totTrue += acc.trueCost; totInr += costInr;
    accRows.push([acc.accountId, acc.accountName, usdCell(acc.usageCost), usdCell(acc.trueCost), inrCell(costInr)]);
  }
  accRows.push([boldStr(""), boldStr("Total"), usdCell(totUsage), usdCell(totTrue), inrCell(totInr)]);
  const accWs = XLSX.utils.aoa_to_sheet(accRows);
  setWidths(accWs, [18, 26, 16, 16, 16]);
  XLSX.utils.book_append_sheet(wb, accWs, "Summary");

  // One sheet per sub-account: service-wise
  for (const acc of accounts) {
    const services = servicesByCt.get(acc.accountId) || [];
    const svcRows: any[][] = [
      [
        boldStr("Service"),
        boldStr("Usage Cost (USD)"), boldStr("True Cost (USD)"),
        boldStr("Cost in INR"),
      ],
    ];
    let sTotUsage = 0, sTotTrue = 0, sTotInr = 0;
    for (const svc of services) {
      const costInr = svc.trueCost * rate;
      sTotUsage += svc.usageCost; sTotTrue += svc.trueCost; sTotInr += costInr;
      svcRows.push([svc.service, usdCell(svc.usageCost), usdCell(svc.trueCost), inrCell(costInr)]);
    }
    svcRows.push([boldStr("Total"), usdCell(sTotUsage), usdCell(sTotTrue), inrCell(sTotInr)]);
    const svcWs = XLSX.utils.aoa_to_sheet(svcRows);
    setWidths(svcWs, [30, 16, 16, 16]);
    XLSX.utils.book_append_sheet(wb, svcWs, acc.accountName.slice(0, 31));
  }

  const suffix = selectedAccountIds && selectedAccountIds.length > 0 ? `-${selectedAccountIds.length}accts` : "";
  XLSX.writeFile(wb, `${ct.ctName}-Cost-${monthLabel}${suffix}.xlsx`);
}

// ── Main multi-CT report ──────────────────────────────────────────────────────
export function generateAwsMonthlyReport(
  ctDataList: CTData[],
  rate: number,
  monthLabel: string,
  mappings: AppMapping[],
) {
  const wb = XLSX.utils.book_new();

  // Build Novac sheet first to get totalCostMap for master
  const novacCT = ctDataList.find(
    (c) => c.ctName.toLowerCase().includes("novac") &&
           !c.ctName.toLowerCase().includes("wonder") &&
           !c.ctName.toLowerCase().includes("credit")
  );
  let novacTotalCostMap = new Map<string, number>();

  if (novacCT) {
    const { totalCostMap } = buildNovacSheet(novacCT, rate);
    novacTotalCostMap = totalCostMap;
  }

  // Sheet 1: Master — cost pulled from totalCost (costInINR + sharedCost)
  XLSX.utils.book_append_sheet(wb, buildMasterSheet(ctDataList, rate, mappings, novacTotalCostMap), "Master");

  // Remaining sheets
  for (const ct of ctDataList) {
    const nameL = ct.ctName.toLowerCase();
    if (nameL.includes("novac") && !nameL.includes("wonder") && !nameL.includes("credit")) {
      const { ws } = buildNovacSheet(ct, rate);
      XLSX.utils.book_append_sheet(wb, ws, ct.ctName.slice(0, 31));
      // SFL sheet — separate sheet for SFL-PROD and SFL-UAT with shared split
      XLSX.utils.book_append_sheet(wb, buildSflSheet(ct, rate), "SFL");
    } else {
      XLSX.utils.book_append_sheet(wb, buildGenericSheet(ct, rate), ct.ctName.slice(0, 31));
    }
  }

  XLSX.writeFile(wb, `AWS-Monthly-Cost-${monthLabel}.xlsx`);
}
