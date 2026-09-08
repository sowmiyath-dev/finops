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

export interface LicenseRowData {
  sno: number;
  description: string;
  team: string;
  unit_cost_pa: number;
  unit_cost_pm: number;
  dc_units: number;
  dr_units: number;
  uat_units: number;
  dc_cost: number;
  dr_cost: number;
  uat_cost: number;
  total_units: number;
  total_cost: number;
}

export interface AppLicenseData {
  appName: string;
  rows: LicenseRowData[];
}


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
  licenseTotals?: Record<string, number>,
): XLSX.WorkSheet {
  const accMap = new Map<string, number>();
  for (const ct of ctDataList) {
    for (const acc of ct.accounts) {
      accMap.set(acc.accountId, (accMap.get(acc.accountId) || 0) + acc.trueCost);
    }
  }

  const rows: any[][] = [
    [boldStr("Application Name"), boldStr("Vertical"), boldStr("Cost (USD)"), boldStr("Cost in INR"), boldStr("Ext. License (INR)"), boldStr("Total Cost (INR)"), boldStr("Note")],
  ];

  let grandTotalUsd = 0;
  let grandTotalInr = 0;
  let grandTotalLic = 0;
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
        costUsd += ((novacTotalCostMap.get(accountId) || 0) / rate) * fraction;
      } else {
        costUsd += (accMap.get(accountId) || 0) * fraction;
      }
    }
    const costInr = costUsd * rate;
    const licCost = licenseTotals?.[m.appName] || 0;
    const totalCost = costInr + licCost;
    grandTotalUsd += costUsd;
    grandTotalInr += costInr;
    grandTotalLic += licCost;
    const vertical = APP_VERTICAL_MAP[m.appName] || "";
    rows.push([m.appName, vertical, usdCell(costUsd), inrCell(costInr), inrCell(licCost), inrCell(totalCost), m.note]);
  }
  rows.push([boldStr("Total"), "", usdCell(grandTotalUsd), inrCell(grandTotalInr), inrCell(grandTotalLic), inrCell(grandTotalInr + grandTotalLic), ""]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setWidths(ws, [28, 14, 16, 18, 18, 18, 52]);
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

// ── Sheet: External License (detailed) ───────────────────────────────────────────
function buildExternalLicenseSheet(appLicenses: AppLicenseData[]): XLSX.WorkSheet {
  const rows: any[][] = [];

  // Group header
  rows.push([
    boldStr("S.No"), boldStr("Description"), boldStr("Team"),
    boldStr("Unit Cost P.A"), boldStr("Unit Cost P.M"),
    boldStr("MUM - DC"), "",
    boldStr("HYD - DR"), "",
    boldStr("UAT"), "",
    boldStr("TOTAL"), "",
  ]);
  rows.push([
    "", "", "", "", "",
    boldStr("No of Units"), boldStr("Cost P.M"),
    boldStr("No of Units"), boldStr("Cost P.M"),
    boldStr("No of Units"), boldStr("Cost P.M"),
    boldStr("No of Units"), boldStr("Cost P.M"),
  ]);

  let grandDcCost = 0, grandDrCost = 0, grandUatCost = 0, grandTotalUnits = 0, grandTotalCost = 0;

  for (const app of appLicenses) {
    // App name separator row
    rows.push([boldStr(`Application: ${app.appName}`), "", "", "", "", "", "", "", "", "", "", "", ""]);

    let appDcCost = 0, appDrCost = 0, appUatCost = 0, appTotalUnits = 0, appTotalCost = 0;

    for (const r of app.rows) {
      const pm = Number(r.unit_cost_pm) || 0;
      const dc = Number(r.dc_units) || 0;
      const dr = Number(r.dr_units) || 0;
      const uat = Number(r.uat_units) || 0;
      const dcCost = dc * pm;
      const drCost = dr * pm;
      const uatCost = uat * pm;
      const totalUnits = dc + dr + uat;
      const totalCost = dcCost + drCost + uatCost;

      appDcCost += dcCost; appDrCost += drCost; appUatCost += uatCost;
      appTotalUnits += totalUnits; appTotalCost += totalCost;

      rows.push([
        r.sno, r.description, r.team || "",
        inrCell(Number(r.unit_cost_pa) || 0),
        inrCell(pm),
        dc, inrCell(dcCost),
        dr, inrCell(drCost),
        uat, inrCell(uatCost),
        totalUnits, inrCell(totalCost),
      ]);
    }

    // App subtotal
    rows.push([
      "", boldStr(`${app.appName} Total`), "", "", "",
      "", inrCell(appDcCost),
      "", inrCell(appDrCost),
      "", inrCell(appUatCost),
      appTotalUnits, inrCell(appTotalCost),
    ]);
    rows.push([]);

    grandDcCost += appDcCost; grandDrCost += appDrCost; grandUatCost += appUatCost;
    grandTotalUnits += appTotalUnits; grandTotalCost += appTotalCost;
  }

  // Grand total
  rows.push([
    "", boldStr("GRAND TOTAL"), "", "", "",
    "", inrCell(grandDcCost),
    "", inrCell(grandDrCost),
    "", inrCell(grandUatCost),
    grandTotalUnits, inrCell(grandTotalCost),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setWidths(ws, [6, 28, 10, 14, 14, 12, 14, 12, 14, 12, 14, 12, 14]);
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
  selectedAccountIds?: string[],
  appLicenses?: AppLicenseData[],
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

  // External License sheet — detailed with all rows per app
  if (appLicenses && appLicenses.length > 0) {
    XLSX.utils.book_append_sheet(wb, buildExternalLicenseSheet(appLicenses), "External License");
  }

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
  licenseTotals?: Record<string, number>,
) {
  const wb = XLSX.utils.book_new();

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

  XLSX.utils.book_append_sheet(wb, buildMasterSheet(ctDataList, rate, mappings, novacTotalCostMap, licenseTotals), "Master");

  // External License sheet — all apps with their license costs
  if (licenseTotals && Object.keys(licenseTotals).length > 0) {
    const licRows: any[][] = [
      [boldStr("Application"), boldStr("Ext. License Cost (INR)")],
    ];
    let licGrand = 0;
    for (const m of mappings) {
      const licCost = licenseTotals[m.appName] || 0;
      licGrand += licCost;
      licRows.push([m.appName, inrCell(licCost)]);
    }
    licRows.push([boldStr("Total"), inrCell(licGrand)]);
    const licWs = XLSX.utils.aoa_to_sheet(licRows);
    setWidths(licWs, [28, 22]);
    XLSX.utils.book_append_sheet(wb, licWs, "External License");
  }

  for (const ct of ctDataList) {
    const nameL = ct.ctName.toLowerCase();
    if (nameL.includes("novac") && !nameL.includes("wonder") && !nameL.includes("credit")) {
      const { ws } = buildNovacSheet(ct, rate);
      XLSX.utils.book_append_sheet(wb, ws, ct.ctName.slice(0, 31));
      XLSX.utils.book_append_sheet(wb, buildSflSheet(ct, rate), "SFL");
    } else {
      XLSX.utils.book_append_sheet(wb, buildGenericSheet(ct, rate), ct.ctName.slice(0, 31));
    }
  }

  XLSX.writeFile(wb, `AWS-Monthly-Cost-${monthLabel}.xlsx`);
}
