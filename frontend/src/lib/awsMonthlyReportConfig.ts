export interface AppMappingAccount { accountId: string; fraction?: number; }
export interface AppMapping {
  appName: string;
  note: string;
  accounts: AppMappingAccount[];
}

export const NOVAC_SHARED_SERVICES_ID = "240329355338";
export const NOVAC_PAYER_ID           = "10241470425";
export const SFL_SHARED_ID            = "833660969797";
export const SFL_PROD_ID              = "683092765314";
export const SFL_UAT_ID               = "400487655910";
export const WH_CT_ACCOUNT_ID         = "339712884147";
export const CN_ACCOUNT_IDS           = ["730335499592", "890742572706", "471112760393"];

export const DEFAULT_APP_MAPPINGS: AppMapping[] = [
  { appName: "Finergy",              note: "Novac-EBS 80%",                                         accounts: [{ accountId: "583617605382", fraction: 0.8 }] },
  { appName: "Pahal",                note: "Novac-EBS 20%",                                         accounts: [{ accountId: "583617605382", fraction: 0.2 }] },
  { appName: "SLIC",                 note: "NOVAC-SLIC+NOVAC-SLIC-PROD+NOVAC-SLIC-UAT",            accounts: [{ accountId: "269670822583" }, { accountId: "168943791283" }, { accountId: "445876755409" }] },
  { appName: "SGIC",                 note: "NOVAC-SGIC",                                            accounts: [{ accountId: "374552481440" }] },
  { appName: "LMS",                  note: "LMS-PROD+NOVAC-LMS-UAT",                                accounts: [{ accountId: "329446032359" }, { accountId: "818131745851" }] },
  { appName: "Nestavia",             note: "Novac-Prod+Novac-UAT",                                  accounts: [{ accountId: "876493681666" }, { accountId: "706490763534" }] },
  { appName: "SFL - Credacc",        note: "SFL-Credacc",                                           accounts: [{ accountId: "573774855993" }] },
  { appName: "Immerz",               note: "Novac-Immerz",                                          accounts: [{ accountId: "870415500840" }] },
  { appName: "IDC",                  note: "NTS-IDC",                                               accounts: [{ accountId: "489600149487" }] },
  { appName: "Devops",               note: "Novac-DevOps",                                          accounts: [{ accountId: "375983336769" }] },
  { appName: "Digital",              note: "Novac-Digital",                                         accounts: [{ accountId: "540717552703" }] },
  { appName: "SFL-RnD",              note: "Novac-RnD",                                             accounts: [{ accountId: "78418245182" }] },
  { appName: "NTS-Development",      note: "NTS-DEVELOPMENT",                                       accounts: [{ accountId: "462768837460" }] },
  { appName: "Payer account Novac",  note: "Redington limited (10241470425)",                       accounts: [{ accountId: "10241470425" }] },
  { appName: "SFL",                  note: "SFL-PROD+SFL-UAT+SFL-SHARED-SERVICE",                   accounts: [{ accountId: SFL_PROD_ID }, { accountId: SFL_UAT_ID }, { accountId: SFL_SHARED_ID }] },
  { appName: "Automall",             note: "Automall CT total cost",                                accounts: [{ accountId: "__CT_AUTOMALL__" }] },
  { appName: "Indostar",             note: "Indostar CT total cost",                                accounts: [{ accountId: "__CT_INDOSTAR__" }] },
  { appName: "NOVACwonderlendhubs",  note: "NOVACwonderlendhubs",                                   accounts: [{ accountId: WH_CT_ACCOUNT_ID }] },
  { appName: "Novac Credit Nirvana", note: "NOVACcreditnirvana+UAT+Redington(471112760393)",        accounts: CN_ACCOUNT_IDS.map((id) => ({ accountId: id })) },
];
