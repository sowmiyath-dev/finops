"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import {
  Layers, Users, Box, DollarSign, ChevronRight, Plus, Trash2, X,
  ChevronLeft, Tag, Server, CheckSquare, Square, RefreshCw, Cloud,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");

const GRANULARITY_OPTIONS = [
  { label: "Daily",   value: "daily" },
  { label: "Weekly",  value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

const COLORS = ["#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b","#8e44ad","#2980b9","#27ae60","#e67e22","#16a085"];

type ChartType = "stacked-bar" | "grouped-bar" | "line" | "area";
type ViewBy = "owner" | "business";

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "stacked-bar", label: "Stacked Bar" },
  { value: "grouped-bar", label: "Grouped Bar" },
  { value: "line",        label: "Line" },
  { value: "area",        label: "Area" },
];

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0);
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[160px]">
      <p className="text-xs font-bold text-black mb-2 border-b border-gray-100 pb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: p.color }} />
            <span className="text-xs text-black truncate max-w-[100px]">{p.dataKey}</span>
          </div>
          <span className="text-xs font-bold font-mono text-blue-900">{fmt(p.value || 0)}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="flex items-center justify-between gap-4 pt-1.5 mt-1 border-t border-gray-100">
          <span className="text-xs font-bold text-black">Total</span>
          <span className="text-xs font-bold font-mono text-blue-900">{fmt(total)}</span>
        </div>
      )}
    </div>
  );
};

interface Owner { id: string; name: string; email?: string; }
interface OwnerCost {
  owner_id: string; owner_name: string; app_count: number;
  resource_count: number; total_cost: number;
  trend: { period: string; cost: number }[];
}
interface Tower { id: string; name: string; sub_accounts: { aws_account_id: string; account_name: string }[]; }
interface Account { aws_account_id: string; account_name: string; ct_name: string; ct_id: string; }
interface Resource { resource_id: string; service: string; region: string; account_id?: string; }

type AzureScope = "subscription" | "resource_group" | "tag" | "resource";
interface AzureSub { subscription_id: string; subscription_name: string; resource_count: number; last_month_cost: number; }
interface AzureRG { resource_group: string; resource_count: number; }
interface AzureResource { resource_id: string; resource_name: string; service: string; resource_group: string; }
interface AzureTagValue { tag_value: string; resource_count: number; resources: AzureResource[]; }

export default function VerticalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuthStore();
  const headers = { Authorization: `Bearer ${token}` };

  const [vertical, setVertical] = useState<{ id: string; name: string; color: string } | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [businesses, setBusinesses] = useState<{id:string;name:string;color:string;owner_name?:string;owner_email?:string}[]>([]);
  const [bizCosts, setBizCosts] = useState<Record<string, number>>({});
  const [costData, setCostData] = useState<OwnerCost[]>([]);
  const [taggedCount, setTaggedCount] = useState(0);
  const [taggedAccounts, setTaggedAccounts] = useState<{aws_account_id: string; account_name: string; resource_count: number}[]>([]);
  const [granularity, setGranularity] = useState("monthly");
  const [dateMode, setDateMode] = useState<"preset" | "custom">("preset");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [costLoading, setCostLoading] = useState(true);

  // Add Business modal
  const [showAddBusiness, setShowAddBusiness] = useState(false);
  const [newBizName, setNewBizName] = useState("");
  const [newBizOwner, setNewBizOwner] = useState("");
  const [newBizEmail, setNewBizEmail] = useState("");
  const [savingBiz, setSavingBiz] = useState(false);

  // Add Owner modal
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // Bulk tag modal
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [selectedBusiness, setSelectedBusiness] = useState<string>("");
  const [accountResources, setAccountResources] = useState<Resource[]>([]);
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
  const [loadingResources, setLoadingResources] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [serviceFilter, setServiceFilter] = useState("");
  const [accountLevelBiz, setAccountLevelBiz] = useState(""); // business for account-level tagging
  const [accountTagging, setAccountTagging] = useState(false);

  // Azure tag modal
  const [showAzureTag, setShowAzureTag] = useState(false);
  const [azureScope, setAzureScope] = useState<AzureScope>("subscription");
  const [azureBusiness, setAzureBusiness] = useState("");
  const [azureBillingTag, setAzureBillingTag] = useState("");
  const [azureSubs, setAzureSubs] = useState<AzureSub[]>([]);
  const [azureSelectedSub, setAzureSelectedSub] = useState("");
  const [azureRGs, setAzureRGs] = useState<AzureRG[]>([]);
  const [azureSelectedRG, setAzureSelectedRG] = useState("");
  const [azureTagKeys, setAzureTagKeys] = useState<string[]>([]);
  const [azureTagKey, setAzureTagKey] = useState("");
  const [azureTagValues, setAzureTagValues] = useState<AzureTagValue[]>([]);
  const [azureSelectedTagValue, setAzureSelectedTagValue] = useState("");
  const [azureResources, setAzureResources] = useState<AzureResource[]>([]);
  const [azureSelectedResources, setAzureSelectedResources] = useState<Set<string>>(new Set());
  const [azureLoading, setAzureLoading] = useState(false);
  const [azureTagging, setAzureTagging] = useState(false);
  const [azureServiceFilter, setAzureServiceFilter] = useState("");

  const load = async (gran = granularity, start?: string, end?: string) => {
    setLoading(true);
    try {
      const params: any = { granularity: gran };
      if (start) params.start_date = start;
      if (end) params.end_date = end;

      // Step 1 — fast metadata (owners, businesses, vertical name) in parallel
      const [ownersRes, bizRes, vertsRes] = await Promise.all([
        axios.get(`${BASE}/api/verticals/${id}/owners`, { headers }),
        axios.get(`${BASE}/api/verticals/${id}/businesses`, { headers }),
        axios.get(`${BASE}/api/verticals/`, { headers }),
      ]);
      setOwners(ownersRes.data);
      const bizList = bizRes.data || [];
      setBusinesses(bizList);
      const v = (vertsRes.data as any[]).find((x: any) => x.id === id);
      setVertical(v || null);

      // Show page immediately — cost loads in background
      setLoading(false);

      // Step 2 — slow cost query in background (doesn't block page render)
      setCostLoading(true);
      axios.get(`${BASE}/api/verticals/${id}/cost`, { headers, params })
        .then((costRes) => {
          setCostData(costRes.data.owners || []);
          setTaggedCount(costRes.data.tagged_resource_count || 0);
          setCostLoading(false);
        })
        .catch(() => { setCostLoading(false); });

      // Step 3 — tagged accounts in background
      axios.get(`${BASE}/api/verticals/${id}/tagged-accounts`, { headers })
        .then((r) => setTaggedAccounts(r.data || []))
        .catch(() => {});

      // Step 4 — business costs in background (single bulk query)
      if (bizList.length > 0) {
        const now = new Date();
        const lm = {
          start: `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}-01`,
          end: `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}-${new Date(now.getFullYear(), now.getMonth(), 0).getDate()}`,
        };
        axios.get(`${BASE}/api/verticals/${id}/businesses-cost`, {
          headers, params: { granularity: "monthly", start_date: lm.start, end_date: lm.end },
        }).then((r) => setBizCosts(r.data || {})).catch(() => {});
      }
    } catch {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    load();
  }, [id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGranularity = (g: string) => { setGranularity(g); load(g, customStart || undefined, customEnd || undefined); };

  const handleCustomDate = () => {
    if (customStart && customEnd) load(granularity, customStart, customEnd);
  };

  const addBusiness = async () => {
    if (!newBizName.trim()) return;
    setSavingBiz(true);
    try {
      await axios.post(`${BASE}/api/verticals/${id}/businesses`,
        { name: newBizName.trim(), owner_name: newBizOwner.trim() || null, owner_email: newBizEmail.trim() || null },
        { headers }
      );
      setNewBizName(""); setNewBizOwner(""); setNewBizEmail(""); setShowAddBusiness(false);
      await load();
    } finally { setSavingBiz(false); }
  };

  const addOwner = async () => {
    if (!newOwnerName.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${BASE}/api/verticals/${id}/owners`,
        { name: newOwnerName.trim(), email: newOwnerEmail.trim() || null },
        { headers }
      );
      setNewOwnerName(""); setNewOwnerEmail(""); setShowAddOwner(false);
      await load();
    } finally { setSaving(false); }
  };

  const deleteOwner = async (ownerId: string) => {
    if (!confirm("Delete this owner and all their applications?")) return;
    await axios.delete(`${BASE}/api/verticals/${id}/owners/${ownerId}`, { headers });
    await load();
  };

  // Bulk tag handlers
  const openAzureTag = async () => {
    setShowAzureTag(true);
    setAzureScope("subscription");
    setAzureBusiness("");
    setAzureBillingTag("");
    setAzureSelectedSub("");
    setAzureSelectedRG("");
    setAzureTagKey("");
    setAzureTagValues([]);
    setAzureSelectedTagValue("");
    setAzureResources([]);
    setAzureSelectedResources(new Set());
    setAzureServiceFilter("");
    setAzureLoading(true);
    try {
      const subsRes = await api.get("/azure-costs/browse/subscriptions");
      setAzureSubs(subsRes.data || []);
    } catch (err: any) {
      console.error("openAzureTag error:", err?.response?.status, err?.response?.data, err?.message);
      alert(err?.response?.data?.detail || "Failed to load Azure subscriptions");
    } finally {
      setAzureLoading(false);
    }
    // Load tag-keys in background — don't block subscription dropdown
    api.get("/azure-costs/tag-keys")
      .then((r) => setAzureTagKeys(r.data || []))
      .catch(() => {});
  };

  const onAzureSubChange = async (subId: string) => {
    setAzureSelectedSub(subId);
    setAzureSelectedRG("");
    setAzureResources([]);
    setAzureSelectedResources(new Set());
    if (!subId) return;
    setAzureLoading(true);
    try {
      const res = await api.get("/azure-costs/browse/resource-groups", { params: { subscription_id: subId } });
      setAzureRGs(res.data || []);
    } finally { setAzureLoading(false); }
  };

  const onAzureRGChange = async (rg: string) => {
    setAzureSelectedRG(rg);
    setAzureResources([]);
    setAzureSelectedResources(new Set());
    if (!rg || azureScope !== "resource") return;
    setAzureLoading(true);
    try {
      const res = await api.get("/azure-costs/browse/resources", {
        params: { subscription_id: azureSelectedSub, resource_group: rg },
      });
      setAzureResources(res.data || []);
    } finally { setAzureLoading(false); }
  };

  const onAzureTagKeyChange = async (key: string) => {
    setAzureTagKey(key);
    setAzureSelectedTagValue("");
    setAzureTagValues([]);
    if (!key) return;
    setAzureLoading(true);
    try {
      const res = await api.get("/azure-costs/browse/tag-values", {
        params: { tag_key: key, subscription_id: azureSelectedSub || undefined },
      });
      setAzureTagValues(res.data || []);
    } finally { setAzureLoading(false); }
  };

  const loadAzureResources = async () => {
    if (!azureSelectedSub) return;
    setAzureLoading(true);
    try {
      const res = await api.get("/azure-costs/browse/resources", {
        params: { subscription_id: azureSelectedSub, resource_group: azureSelectedRG || undefined },
      });
      setAzureResources(res.data || []);
    } finally { setAzureLoading(false); }
  };

  const applyAzureTag = async () => {
    setAzureTagging(true);
    try {
      const body: any = {
        vertical_id: id,
        business_id: azureBusiness || null,
        billing_tag: azureBillingTag.trim() || null,
        scope: azureScope,
        subscription_id: azureSelectedSub || null,
      };
      if (azureScope === "subscription") {
        const sub = azureSubs.find(s => s.subscription_id === azureSelectedSub);
        body.subscription_name = sub?.subscription_name;
      } else if (azureScope === "resource_group") {
        body.resource_group = azureSelectedRG;
      } else if (azureScope === "tag") {
        body.tag_key = azureTagKey;
        body.tag_value = azureSelectedTagValue;
      } else if (azureScope === "resource") {
        const selected = azureResources.filter(r => azureSelectedResources.has(r.resource_id));
        body.resource_ids = selected.map(r => r.resource_id);
        body.resource_names = selected.map(r => r.resource_name);
        body.resource_group = azureSelectedRG || null;
      }
      const res = await axios.post(`${BASE}/api/verticals/bulk-tag-azure`, body, { headers });
      alert(`✓ Tagged ${res.data.tagged} Azure resource(s) — ${res.data.tags}`);
      setShowAzureTag(false);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Azure tagging failed");
    } finally { setAzureTagging(false); }
  };

  const azureFilteredResources = azureResources.filter(r =>
    !azureServiceFilter || r.service?.toLowerCase().includes(azureServiceFilter.toLowerCase()) ||
    r.resource_name?.toLowerCase().includes(azureServiceFilter.toLowerCase())
  );

  const openBulkTag = async () => {
    setShowBulkTag(true);
    setSelectedAccounts(new Set());
    setSelectedBusiness("");
    setAccountResources([]);
    setSelectedResources(new Set());
    setServiceFilter("");
    // Load towers AND businesses in parallel
    const [towersRes] = await Promise.all([
      axios.get(`${BASE}/api/towers/`, { headers }),
    ]);
    const towersData: Tower[] = towersRes.data;
    setTowers(towersData.filter((t: any) => !t.cloud_provider || t.cloud_provider === "aws"));
    const flat: Account[] = towersData
      .filter((t: any) => !t.cloud_provider || t.cloud_provider === "aws")
      .flatMap((t) =>
      (t.sub_accounts || []).map((s) => ({
        aws_account_id: s.aws_account_id,
        account_name: s.account_name,
        ct_name: t.name,
        ct_id: t.id,
      }))
    );
    setAccounts(flat);
    // Reload businesses if empty
    if (businesses.length === 0) {
      const bizRes = await axios.get(`${BASE}/api/verticals/${id}/businesses`, { headers });
      setBusinesses(bizRes.data || []);
    }
    // Reload vertical name if empty
    if (!vertical) {
      const vertsRes = await axios.get(`${BASE}/api/verticals/`, { headers });
      const v = (vertsRes.data as any[]).find((x: any) => x.id === id);
      setVertical(v || null);
    }
  };

  const applyAccountLevelTag = async () => {
    if (selectedAccounts.size === 0 || !accountLevelBiz) return;
    setAccountTagging(true);
    try {
      // For account-level: insert one placeholder row per account (account_id as resource_id)
      for (const aid of Array.from(selectedAccounts)) {
        await axios.post(`${BASE}/api/verticals/bulk-tag-account`, {
          vertical_id: id,
          business_id: accountLevelBiz,
          aws_account_id: aid,
          resource_ids: [aid], // account_id as placeholder resource_id
          cloud_provider: "aws",
          account_level: true,
        }, { headers });
      }
      // Also set business cost_type to account
      await axios.patch(`${BASE}/api/verticals/businesses/${accountLevelBiz}`,
        { name: businesses.find(b => b.id === accountLevelBiz)?.name, cost_type: "account" },
        { headers }
      );
      alert(`✓ ${selectedAccounts.size} account(s) assigned to business with account-level cost tracking`);
      setShowBulkTag(false);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed");
    } finally { setAccountTagging(false); }
  };

  const loadAccountResources = async (accountIds: Set<string>) => {
    if (accountIds.size === 0) return;
    setLoadingResources(true);
    setSelectedResources(new Set());
    try {
      const results = await Promise.all(
        Array.from(accountIds).map((aid) => {
          // Find which CT this account belongs to — scope query to that CT only
          const acct = accounts.find((a) => a.aws_account_id === aid);
          const params: any = { account_id: aid };
          if (acct?.ct_id) params.ct_id = acct.ct_id;
          return axios.get(`${BASE}/api/reports/meta/resources-by-account`, {
            headers,
            params,
          }).then((r) => (r.data as Resource[]).map((res) => ({ ...res, account_id: aid })));
        })
      );
      // Merge and deduplicate by resource_id
      const merged = new Map<string, Resource>();
      results.flat()
        .filter((r) => r.resource_id && r.resource_id !== "*" && r.resource_id.trim() !== "")
        .forEach((r) => merged.set(r.resource_id, r));
      setAccountResources(Array.from(merged.values()));
    } finally {
      setLoadingResources(false);
    }
  };

  const toggleAccount = (aid: string) => {
    setSelectedAccounts((prev) => {
      const next = new Set(prev);
      next.has(aid) ? next.delete(aid) : next.add(aid);
      return next;
    });
  };

  const toggleResource = (rid: string) => {
    setSelectedResources((prev) => {
      const next = new Set(prev);
      next.has(rid) ? next.delete(rid) : next.add(rid);
      return next;
    });
  };

  const filteredResources = accountResources.filter((r) =>
    !serviceFilter || r.service.toLowerCase().includes(serviceFilter.toLowerCase())
  );

  const selectAll = () => setSelectedResources(new Set(filteredResources.map((r) => r.resource_id)));
  const clearAll = () => setSelectedResources(new Set());

  const applyBulkTag = async () => {
    if (selectedAccounts.size === 0 || selectedResources.size === 0) return;
    setTagging(true);
    try {
      // Group selected resources by their account_id
      const byAccount = new Map<string, string[]>();
      accountResources
        .filter((r) => selectedResources.has(r.resource_id))
        .forEach((r) => {
          const aid = r.account_id || Array.from(selectedAccounts)[0];
          if (!byAccount.has(aid)) byAccount.set(aid, []);
          byAccount.get(aid)!.push(r.resource_id);
        });

      let totalTagged = 0;
      for (const [aid, rids] of byAccount.entries()) {
        const res = await axios.post(`${BASE}/api/verticals/bulk-tag-account`, {
          vertical_id: id,
          business_id: selectedBusiness || null,
          aws_account_id: aid,
          resource_ids: rids,
          cloud_provider: "aws",
        }, { headers });
        totalTagged += res.data.tagged;
      }
      alert(`✓ Tagged ${totalTagged} resources with Vertical=${vertical?.name}${selectedBusiness ? ` + Business tag` : ""}`);
      setShowBulkTag(false);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Tagging failed");
    } finally {
      setTagging(false);
    }
  };

  const [chartType, setChartType] = useState<ChartType>("stacked-bar");
  const [viewBy, setViewBy] = useState<ViewBy>("owner");
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const totalCost = costData.reduce((s, o) => s + o.total_cost, 0);
  const unassigned = costData.find((c) => c.owner_id === "unassigned");
  const assignedOwners = costData.filter((c) => c.owner_id !== "unassigned");

  // Build chart series — owner view uses costData, business view uses bizCosts trend (flat)
  const ownerSeries = costData.map((o) => o.owner_name);
  const bizSeries = businesses.map((b) => b.name);
  const activeSeries = viewBy === "owner" ? ownerSeries : bizSeries;

  const trendMap: Record<string, Record<string, number>> = {};
  if (viewBy === "owner") {
    costData.forEach((o) => {
      o.trend.forEach((t) => {
        if (!trendMap[t.period]) trendMap[t.period] = {};
        trendMap[t.period][o.owner_name] = (trendMap[t.period][o.owner_name] || 0) + t.cost;
      });
    });
  } else {
    // Business view: aggregate owner trends by business name match
    // Use bizCosts as totals but spread across periods from owner trends
    costData.forEach((o) => {
      o.trend.forEach((t) => {
        if (!trendMap[t.period]) trendMap[t.period] = {};
        // Map owner to business — use "Other" if no match
        const biz = businesses.find((b) =>
          b.owner_name?.toLowerCase() === o.owner_name.toLowerCase() ||
          b.name.toLowerCase() === o.owner_name.toLowerCase()
        );
        const key = biz ? biz.name : o.owner_name;
        trendMap[t.period][key] = (trendMap[t.period][key] || 0) + t.cost;
      });
    });
  }
  const chartData = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, vals]) => ({ period, ...vals }));

  const visibleSeries = activeSeries.filter((s) => !hiddenSeries.has(s));

  const toggleSeries = (name: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-sm font-semibold text-black">Loading...</div>
  );

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-black mb-4">
        <button onClick={() => router.push("/verticals")} className="hover:text-blue-900 flex items-center gap-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Verticals
        </button>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <span className="font-bold text-black">{vertical?.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: vertical?.color || "#0f2d5e" }}>
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black">{vertical?.name}</h1>
            <p className="text-xs text-black">{owners.length} owners · {assignedOwners.reduce((s, o) => s + o.app_count, 0)} applications</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Granularity */}
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {GRANULARITY_OPTIONS.map((g) => (
              <button key={g.value} onClick={() => handleGranularity(g.value)}
                className={`px-4 py-2 text-xs font-bold transition ${granularity === g.value ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
                {g.label}
              </button>
            ))}
          </div>

          {/* Date mode toggle */}
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            <button onClick={() => { setDateMode("preset"); setCustomStart(""); setCustomEnd(""); load(granularity); }}
              className={`px-3 py-2 text-xs font-bold transition ${dateMode === "preset" ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
              Preset
            </button>
            <button onClick={() => setDateMode("custom")}
              className={`px-3 py-2 text-xs font-bold transition ${dateMode === "custom" ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
              Custom
            </button>
          </div>

          {/* Custom date inputs */}
          {dateMode === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
              <span className="text-xs text-black font-semibold">to</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                className="border border-gray-400 rounded-md px-3 py-2 text-xs text-black focus:border-blue-900 outline-none" />
              <button onClick={handleCustomDate} disabled={!customStart || !customEnd}
                className="px-3 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                Apply
              </button>
            </div>
          )}

          <button onClick={openAzureTag}
            className="flex items-center gap-2 px-4 py-2 bg-[#0078D4] hover:bg-[#006CBF] text-white text-xs font-bold rounded-md transition">
            <Cloud className="w-3.5 h-3.5" /> Add Azure Resources
          </button>
          <button onClick={openBulkTag}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-md transition">
            <Tag className="w-3.5 h-3.5" /> Tag AWS Resources
          </button>
          <button onClick={() => setShowAddBusiness(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-md transition">
            <Plus className="w-3.5 h-3.5" /> Add Business
          </button>
          <button onClick={() => setShowAddOwner(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition">
            <Plus className="w-3.5 h-3.5" /> Add Owner
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Cost",       value: costLoading ? null : `$${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign },
          { label: "Owners",           value: owners.length, icon: Users },
          { label: "Applications",     value: assignedOwners.reduce((s, o) => s + o.app_count, 0), icon: Box },
          { label: "Tagged Resources", value: costLoading ? null : taggedCount, icon: Tag },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <k.icon className="w-4 h-4 text-blue-900" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-black">{k.label}</span>
            </div>
            {k.value === null
              ? <div className="h-8 w-24 bg-gray-200 rounded animate-pulse" />
              : <div className="text-2xl font-bold text-blue-900 font-mono">{k.value}</div>
            }
          </div>
        ))}
      </div>

      {/* Tag info banner */}
      {taggedCount > 0 && (
        <div className="bg-orange-50 border border-orange-200 border-l-4 border-l-orange-500 rounded-lg px-4 py-3 mb-6 flex items-center gap-2">
          <Tag className="w-4 h-4 text-orange-600 flex-shrink-0" />
          <p className="text-xs font-semibold text-orange-800">
            {taggedCount} resource{taggedCount > 1 ? "s" : ""} tagged with <span className="font-bold">Vertical = {vertical?.name}</span> are included in this vertical's cost.
          </p>
        </div>
      )}

      {/* ── Chart Panel ─────────────────────────────────────────────────── */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm mb-6 overflow-hidden">
          {/* Chart header */}
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3"
            style={{ background: "linear-gradient(135deg, #f8fafc 0%, #f1f4f9 100%)" }}>
            <div>
              <h2 className="text-sm font-bold text-black">
                Cost Trend — {granularity.charAt(0).toUpperCase() + granularity.slice(1)}
              </h2>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {visibleSeries.length} of {activeSeries.length} {viewBy === "owner" ? "owners" : "businesses"} visible
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* View By */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">View by</span>
                <div className="flex border border-gray-300 rounded-md overflow-hidden">
                  {(["owner", "business"] as ViewBy[]).map((v) => (
                    <button key={v} onClick={() => setViewBy(v)}
                      className={`px-3 py-1.5 text-xs font-bold transition capitalize ${
                        viewBy === v ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                      }`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chart type */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Chart</span>
                <div className="flex border border-gray-300 rounded-md overflow-hidden">
                  {CHART_TYPES.map((ct) => (
                    <button key={ct.value} onClick={() => setChartType(ct.value)}
                      title={ct.label}
                      className={`px-3 py-1.5 text-xs font-bold transition ${
                        chartType === ct.value ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                      }`}>
                      {ct.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Series legend / toggles */}
          <div className="px-5 py-2.5 border-b border-gray-100 flex items-center gap-2 flex-wrap"
            style={{ background: "#fafbfc" }}>
            {activeSeries.map((name, i) => {
              const hidden = hiddenSeries.has(name);
              return (
                <button key={name} onClick={() => toggleSeries(name)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                    hidden
                      ? "bg-white border-gray-200 text-gray-400"
                      : "border-transparent text-white"
                  }`}
                  style={hidden ? {} : { background: COLORS[i % COLORS.length] }}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    hidden ? "bg-gray-300" : "bg-white/60"
                  }`} />
                  {name}
                </button>
              );
            })}
            {hiddenSeries.size > 0 && (
              <button onClick={() => setHiddenSeries(new Set())}
                className="text-[10px] font-bold text-blue-900 hover:underline ml-1">
                Show all
              </button>
            )}
          </div>

          {/* Chart */}
          <div className="p-5">
            <ResponsiveContainer width="100%" height={280}>
              {chartType === "stacked-bar" ? (
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barCategoryGap="30%">
                  <defs>
                    {visibleSeries.map((name, i) => (
                      <linearGradient key={name} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS[activeSeries.indexOf(name) % COLORS.length]} stopOpacity={1} />
                        <stop offset="100%" stopColor={COLORS[activeSeries.indexOf(name) % COLORS.length]} stopOpacity={0.75} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(15,45,94,0.04)" }} />
                  {visibleSeries.map((name, i) => (
                    <Bar key={name} dataKey={name} stackId="a"
                      fill={`url(#grad-${i})`}
                      radius={i === visibleSeries.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              ) : chartType === "grouped-bar" ? (
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barCategoryGap="25%" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(15,45,94,0.04)" }} />
                  {visibleSeries.map((name, i) => (
                    <Bar key={name} dataKey={name}
                      fill={COLORS[activeSeries.indexOf(name) % COLORS.length]}
                      radius={[3, 3, 0, 0]} />
                  ))}
                </BarChart>
              ) : chartType === "line" ? (
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                  <Tooltip content={<CustomTooltip />} />
                  {visibleSeries.map((name, i) => (
                    <Line key={name} type="monotone" dataKey={name}
                      stroke={COLORS[activeSeries.indexOf(name) % COLORS.length]}
                      strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 0 }}
                      activeDot={{ r: 5, strokeWidth: 0 }} />
                  ))}
                </LineChart>
              ) : (
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    {visibleSeries.map((name, i) => {
                      const color = COLORS[activeSeries.indexOf(name) % COLORS.length];
                      return (
                        <linearGradient key={name} id={`area-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#374151" }} tickFormatter={fmt} axisLine={false} tickLine={false} width={60} />
                  <Tooltip content={<CustomTooltip />} />
                  {visibleSeries.map((name, i) => {
                    const color = COLORS[activeSeries.indexOf(name) % COLORS.length];
                    return (
                      <Area key={name} type="monotone" dataKey={name}
                        stroke={color} strokeWidth={2.5}
                        fill={`url(#area-${i})`}
                        dot={{ r: 3, strokeWidth: 0, fill: color }}
                        activeDot={{ r: 5, strokeWidth: 0 }} />
                    );
                  })}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Mini summary bar */}
          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-6 flex-wrap"
            style={{ background: "#f8fafc" }}>
            {visibleSeries.map((name, i) => {
              const color = COLORS[activeSeries.indexOf(name) % COLORS.length];
              const seriesTotal = chartData.reduce((s, d) => s + ((d as any)[name] || 0), 0);
              const pct = totalCost > 0 ? (seriesTotal / totalCost) * 100 : 0;
              return (
                <div key={name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
                  <span className="text-xs font-semibold text-black">{name}</span>
                  <span className="text-xs font-bold font-mono text-blue-900">{fmt(seriesTotal)}</span>
                  <span className="text-[10px] text-gray-500">({pct.toFixed(1)}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Businesses */}
      {businesses.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm mb-6">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-black">Businesses ({businesses.length})</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {["Business", "Owner", "Cost", ""].map((h) => (
                  <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {businesses.map((b) => (
                <tr key={b.id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                        style={{ background: b.color || vertical?.color || "#0f2d5e" }}>
                        {b.name.charAt(0)}
                      </div>
                      <span className="text-sm font-bold text-black">{b.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm text-black">
                    {b.owner_name ? <span className="font-semibold">{b.owner_name}</span> : <span className="text-gray-400 text-xs">No owner</span>}
                  </td>
                  <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">
                    {bizCosts[b.id] !== undefined
                      ? `$${bizCosts[b.id].toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : <span className="text-gray-400 text-xs">Loading...</span>}
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => router.push(`/verticals/${id}/business/${b.id}`)}
                      className="text-xs font-bold text-blue-900 hover:underline">View Details →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Owners table */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-bold text-black">Owners</h2>
        </div>
        {owners.length === 0 && !unassigned ? (
          <div className="p-8 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-black">No owners yet</p>
            <p className="text-xs text-black mt-1">Add an owner or tag resources with Vertical={vertical?.name}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {["Owner", "Email", "Applications", "Resources", "Total Cost", ""].map((h) => (
                  <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {owners.map((owner) => {
                const cd = assignedOwners.find((c) => c.owner_id === owner.id);
                return (
                  <tr key={owner.id} className="border-b border-gray-200 hover:bg-blue-50 transition cursor-pointer"
                    onClick={() => router.push(`/verticals/${id}/${owner.id}`)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                          style={{ background: vertical?.color || "#0f2d5e" }}>
                          {owner.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-semibold text-black">{owner.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-black">{owner.email || "—"}</td>
                    <td className="px-5 py-3 text-sm font-semibold text-black">{cd?.app_count ?? 0}</td>
                    <td className="px-5 py-3 text-sm font-semibold text-black">{cd?.resource_count ?? 0}</td>
                    <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">
                      ${(cd?.total_cost ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <ChevronRight className="w-4 h-4 text-blue-900" />
                        <button onClick={(e) => { e.stopPropagation(); deleteOwner(owner.id); }}
                          className="p-1 rounded hover:bg-red-50 text-red-600 transition">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {unassigned && (
                <tr className="border-b border-gray-200 bg-orange-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center bg-orange-500 text-white">
                        <Tag className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-sm font-semibold text-black">Unassigned (via Tag)</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-300">
                        Vertical = {vertical?.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm text-black">—</td>
                  <td className="px-5 py-3 text-sm text-black">—</td>
                  <td className="px-5 py-3 text-sm font-semibold text-black">{unassigned.resource_count}</td>
                  <td className="px-5 py-3 text-sm font-bold font-mono text-blue-900">
                    ${unassigned.total_cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-3" />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Tagged Accounts */}
      {taggedAccounts.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm mt-6">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
            <Tag className="w-4 h-4 text-orange-600" />
            <h2 className="text-sm font-bold text-black">Tagged Accounts</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-300 ml-1">
              Vertical = {vertical?.name}
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {["Account ID", "Account Name", "Tagged Resources"].map((h) => (
                  <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {taggedAccounts.map((a) => (
                <tr key={a.aws_account_id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                  <td className="px-5 py-3 text-xs font-mono font-bold text-black">{a.aws_account_id}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-black">{a.account_name}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-bold px-2 py-1 rounded bg-orange-100 text-orange-800 border border-orange-200">
                      {a.resource_count} resources
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Azure Tag Modal */}
      {showAzureTag && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "#0078D4" }}>
                  <Cloud className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-black">Add Azure Resources to Vertical</h3>
                  <p className="text-xs text-gray-500">Tag Azure resources with <span className="font-bold text-[#0078D4]">Vertical = {vertical?.name}</span></p>
                </div>
              </div>
              <button onClick={() => setShowAzureTag(false)}><X className="w-4 h-4 text-black" /></button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4">
              {/* Scope selector */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-2">Scope</label>
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { value: "subscription", label: "Subscription", desc: "Entire subscription" },
                    { value: "resource_group", label: "Resource Group", desc: "All RG resources" },
                    { value: "tag", label: "By Tag", desc: "Match Azure tag" },
                    { value: "resource", label: "Individual", desc: "Pick resources" },
                  ] as { value: AzureScope; label: string; desc: string }[]).map((s) => (
                    <button key={s.value}
                      onClick={() => { setAzureScope(s.value); setAzureResources([]); setAzureSelectedResources(new Set()); }}
                      className={`p-3 rounded-lg border-2 text-left transition ${
                        azureScope === s.value
                          ? "border-[#0078D4] bg-blue-50"
                          : "border-gray-200 hover:border-gray-300 bg-white"
                      }`}>
                      <div className={`text-xs font-bold ${ azureScope === s.value ? "text-[#0078D4]" : "text-black" }`}>{s.label}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subscription picker — always shown */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">
                  {azureScope === "subscription" ? "Select Subscription *" : "Subscription (optional filter)"}
                </label>
                {azureLoading && azureSubs.length === 0
                  ? <div className="h-9 bg-gray-100 rounded-md animate-pulse" />
                  : (
                    <select value={azureSelectedSub} onChange={(e) => onAzureSubChange(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black focus:border-[#0078D4] outline-none">
                      <option value="">— Select subscription —</option>
                      {azureSubs.map(s => (
                        <option key={s.subscription_id} value={s.subscription_id}>
                          {s.subscription_name}{s.resource_count > 0 ? ` (${s.resource_count} resources)` : ""}
                        </option>
                      ))}
                    </select>
                  )}
              </div>

              {/* Resource Group picker */}
              {(azureScope === "resource_group" || azureScope === "resource") && azureSelectedSub && (
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">
                    {azureScope === "resource_group" ? "Select Resource Group *" : "Resource Group (optional filter)"}
                  </label>
                  {azureLoading && azureRGs.length === 0
                    ? <div className="h-9 bg-gray-100 rounded-md animate-pulse" />
                    : (
                      <select value={azureSelectedRG} onChange={(e) => onAzureRGChange(e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black focus:border-[#0078D4] outline-none">
                        <option value="">— All resource groups —</option>
                        {azureRGs.map(rg => (
                          <option key={rg.resource_group} value={rg.resource_group}>
                            {rg.resource_group}{rg.resource_count > 0 ? ` (${rg.resource_count} resources)` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                </div>
              )}

              {/* Tag scope */}
              {azureScope === "tag" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Tag Key *</label>
                    <select value={azureTagKey} onChange={(e) => onAzureTagKeyChange(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black focus:border-[#0078D4] outline-none">
                      <option value="">— Select tag key —</option>
                      {azureTagKeys.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Tag Value *</label>
                    {azureLoading && azureTagKey && azureTagValues.length === 0
                      ? <div className="h-9 bg-gray-100 rounded-md animate-pulse" />
                      : (
                        <select value={azureSelectedTagValue} onChange={(e) => setAzureSelectedTagValue(e.target.value)}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black focus:border-[#0078D4] outline-none">
                          <option value="">— Select value —</option>
                          {azureTagValues.map(tv => (
                            <option key={tv.tag_value} value={tv.tag_value}>
                              {tv.tag_value} ({tv.resource_count} resources)
                            </option>
                          ))}
                        </select>
                      )}
                  </div>
                </div>
              )}

              {/* Individual resource scope */}
              {azureScope === "resource" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold uppercase tracking-wide text-black">Select Resources *</label>
                    <div className="flex items-center gap-2">
                      <input value={azureServiceFilter} onChange={(e) => setAzureServiceFilter(e.target.value)}
                        placeholder="Filter by service/name..."
                        className="border border-gray-300 rounded-md px-2 py-1 text-xs text-black focus:border-[#0078D4] outline-none w-44" />
                      {azureResources.length === 0 && (
                        <button onClick={loadAzureResources} disabled={!azureSelectedSub || azureLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4] hover:bg-[#006CBF] text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                          <RefreshCw className={`w-3 h-3 ${azureLoading ? "animate-spin" : ""}`} /> Load
                        </button>
                      )}
                      {azureResources.length > 0 && (
                        <>
                          <button onClick={() => setAzureSelectedResources(new Set(azureFilteredResources.map(r => r.resource_id)))}
                            className="text-xs font-bold text-[#0078D4] hover:underline">All</button>
                          <button onClick={() => setAzureSelectedResources(new Set())}
                            className="text-xs font-bold text-gray-500 hover:underline">None</button>
                        </>
                      )}
                    </div>
                  </div>
                  {azureLoading && azureResources.length === 0
                    ? <div className="h-32 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center"><RefreshCw className="w-5 h-5 animate-spin text-[#0078D4]" /></div>
                    : azureResources.length > 0 ? (
                      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                        <table className="w-full">
                          <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="w-8 px-2 py-2" />
                              {["Resource", "Service", "Resource Group"].map(h => (
                                <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-3 py-2">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {azureFilteredResources.map(r => {
                              const checked = azureSelectedResources.has(r.resource_id);
                              return (
                                <tr key={r.resource_id}
                                  className={`border-b border-gray-100 cursor-pointer transition ${ checked ? "bg-blue-50" : "hover:bg-gray-50" }`}
                                  onClick={() => setAzureSelectedResources(prev => {
                                    const next = new Set(prev);
                                    next.has(r.resource_id) ? next.delete(r.resource_id) : next.add(r.resource_id);
                                    return next;
                                  })}>
                                  <td className="px-2 py-2">
                                    {checked ? <CheckSquare className="w-4 h-4 text-[#0078D4]" /> : <Square className="w-4 h-4 text-gray-400" />}
                                  </td>
                                  <td className="px-3 py-2 text-xs font-semibold text-black truncate max-w-[160px]">{r.resource_name}</td>
                                  <td className="px-3 py-2">
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-[#0078D4]">{r.service}</span>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[120px]">{r.resource_group}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : azureSelectedSub ? (
                      <div className="text-center py-6 text-xs text-gray-500 border border-gray-200 rounded-lg">Click Load to fetch resources</div>
                    ) : (
                      <div className="text-center py-6 text-xs text-gray-500 border border-gray-200 rounded-lg">Select a subscription first</div>
                    )}
                  {azureResources.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">{azureSelectedResources.size} of {azureFilteredResources.length} selected</p>
                  )}
                </div>
              )}

              {/* Business + Billing tag */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Business <span className="text-gray-400 font-normal">(optional)</span></label>
                  <select value={azureBusiness} onChange={(e) => setAzureBusiness(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black focus:border-[#0078D4] outline-none">
                    <option value="">— No business tag —</option>
                    {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Billing Tag <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input value={azureBillingTag} onChange={(e) => setAzureBillingTag(e.target.value)}
                    placeholder="e.g. Q1-2025"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-black focus:border-[#0078D4] outline-none" />
                </div>
              </div>

              {/* Summary */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs">
                <span className="font-bold text-[#0078D4]">Will apply: </span>
                <span className="font-bold text-black">Vertical={vertical?.name}</span>
                {azureBusiness && <span className="font-bold text-green-700">, Business={businesses.find(b => b.id === azureBusiness)?.name}</span>}
                {azureBillingTag && <span className="font-bold text-teal-700">, Billing={azureBillingTag}</span>}
                <span className="text-gray-600"> → scope: <span className="font-bold">{azureScope}</span></span>
                {azureScope === "subscription" && azureSelectedSub && (
                  <span className="text-gray-600"> → {azureSubs.find(s => s.subscription_id === azureSelectedSub)?.subscription_name}</span>
                )}
                {azureScope === "resource_group" && azureSelectedRG && (
                  <span className="text-gray-600"> → {azureSelectedRG}</span>
                )}
                {azureScope === "tag" && azureTagKey && azureSelectedTagValue && (
                  <span className="text-gray-600"> → {azureTagKey}={azureSelectedTagValue}</span>
                )}
                {azureScope === "resource" && azureSelectedResources.size > 0 && (
                  <span className="text-gray-600"> → {azureSelectedResources.size} resource(s)</span>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-gray-200 flex-shrink-0">
              <button onClick={() => setShowAzureTag(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={applyAzureTag} disabled={azureTagging || (
                azureScope === "subscription" ? !azureSelectedSub :
                azureScope === "resource_group" ? !azureSelectedRG :
                azureScope === "tag" ? !azureTagKey || !azureSelectedTagValue :
                azureSelectedResources.size === 0
              )}
                className="px-5 py-2 bg-[#0078D4] hover:bg-[#006CBF] text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {azureTagging ? "Tagging..." : "Apply Azure Tags"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Business Modal */}
      {showAddBusiness && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">Add Business</h3>
              <button onClick={() => setShowAddBusiness(false)}><X className="w-4 h-4 text-black" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Business Name *</label>
                <input value={newBizName} onChange={(e) => setNewBizName(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="e.g. IDC, SFL, SGIC" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Owner Name</label>
                <input value={newBizOwner} onChange={(e) => setNewBizOwner(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="e.g. John Doe" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Owner Email</label>
                <input value={newBizEmail} onChange={(e) => setNewBizEmail(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="owner@company.com" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowAddBusiness(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={addBusiness} disabled={savingBiz || !newBizName.trim()}
                className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {savingBiz ? "Saving..." : "Add Business"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Owner Modal */}
      {showAddOwner && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-black">Add Owner</h3>
              <button onClick={() => setShowAddOwner(false)}><X className="w-4 h-4 text-black" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Owner Name *</label>
                <input value={newOwnerName} onChange={(e) => setNewOwnerName(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="e.g. Platform Team" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">Email (optional)</label>
                <input value={newOwnerEmail} onChange={(e) => setNewOwnerEmail(e.target.value)}
                  className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none"
                  placeholder="team@company.com" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowAddOwner(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={addOwner} disabled={saving || !newOwnerName.trim()}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                {saving ? "Saving..." : "Add Owner"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Tag by Account Modal */}
      {showBulkTag && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-gray-300 shadow-lg w-full max-w-3xl p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div>
                <h3 className="text-sm font-bold text-black">Tag Resources by Account</h3>
                <p className="text-xs text-black mt-0.5">
                  Select an account, choose resources, and tag them with <span className="font-bold">Vertical = {vertical?.name}</span>
                </p>
              </div>
              <button onClick={() => setShowBulkTag(false)}><X className="w-4 h-4 text-black" /></button>
            </div>

            {/* Business selector — moved to AFTER resource selection */}

            {/* Step 1: Select accounts */}
            <div className="mb-4 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-wide text-black">Select Accounts</label>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedAccounts(new Set(accounts.map((a) => a.aws_account_id)))}
                    className="text-xs font-bold text-blue-900 hover:underline">Select All</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => { setSelectedAccounts(new Set()); setAccountResources([]); setSelectedResources(new Set()); }}
                    className="text-xs font-bold text-black hover:underline">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50">
                {towers.map((ct) => (
                  <div key={ct.id}>
                    {/* CT header */}
                    <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{ct.name}</span>
                      <button
                        onClick={() => {
                          const ctAccIds = (ct.sub_accounts || []).map((s) => s.aws_account_id);
                          const allSelected = ctAccIds.every((a) => selectedAccounts.has(a));
                          setSelectedAccounts((prev) => {
                            const next = new Set(prev);
                            ctAccIds.forEach((a) => allSelected ? next.delete(a) : next.add(a));
                            return next;
                          });
                        }}
                        className="text-[10px] font-bold text-blue-900 hover:underline">
                        {(ct.sub_accounts || []).every((s) => selectedAccounts.has(s.aws_account_id)) ? "Deselect all" : "Select all"}
                      </button>
                    </div>
                    {/* Sub-accounts */}
                    <div className="grid grid-cols-2 gap-1 ml-2">
                      {(ct.sub_accounts || []).map((acc) => {
                        const checked = selectedAccounts.has(acc.aws_account_id);
                        return (
                          <label key={acc.aws_account_id}
                            className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition text-xs font-semibold ${
                              checked ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-blue-50 border border-gray-200"
                            }`}>
                            <input type="checkbox" className="hidden" checked={checked}
                              onChange={() => toggleAccount(acc.aws_account_id)} />
                            <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                              checked ? "bg-white border-white" : "border-gray-400"
                            }`}>
                              {checked && <div className="w-2 h-2 rounded-sm bg-blue-900" />}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate">{acc.account_name}</div>
                              <div className={`text-[10px] font-mono ${checked ? "text-white/70" : "text-gray-500"}`}>{acc.aws_account_id}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-2 gap-2">
                {/* Account-level quick assign */}
                <div className="flex items-center gap-2 flex-1">
                  <select
                    value={accountLevelBiz}
                    onChange={(e) => setAccountLevelBiz(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-xs text-black focus:border-green-700 outline-none">
                    <option value="">— Select Business (Account-level) —</option>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={applyAccountLevelTag}
                    disabled={selectedAccounts.size === 0 || !accountLevelBiz || accountTagging}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50 whitespace-nowrap">
                    <Tag className="w-3.5 h-3.5" />
                    {accountTagging ? "Adding..." : "Add Entire Account"}
                  </button>
                </div>
                <button
                  onClick={() => loadAccountResources(selectedAccounts)}
                  disabled={selectedAccounts.size === 0 || loadingResources}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingResources ? "animate-spin" : ""}`} />
                  Load Resources
                </button>
              </div>
            </div>

            {/* Step 2: Filter + select resources */}
            {accountResources.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-2 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <input
                      value={serviceFilter}
                      onChange={(e) => setServiceFilter(e.target.value)}
                      placeholder="Filter by service..."
                      className="border border-gray-400 rounded-md px-3 py-1.5 text-xs text-black focus:border-blue-900 outline-none w-48"
                    />
                    <span className="text-xs text-black font-semibold">
                      {filteredResources.length} resources · {selectedResources.size} selected
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={selectAll}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-md hover:bg-blue-50 hover:border-blue-900 text-black transition">
                      <CheckSquare className="w-3.5 h-3.5" /> Select All
                    </button>
                    <button onClick={clearAll}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-md hover:bg-gray-50 text-black transition">
                      <Square className="w-3.5 h-3.5" /> Clear
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg mb-4">
                  <table className="w-full">
                    <thead className="sticky top-0">
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="w-10 px-3 py-2" />
                        {["Resource ID", "Service", "Region"].map((h) => (
                          <th key={h} className="text-left text-xs font-bold uppercase tracking-wider text-black px-3 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResources.map((r) => {
                        const checked = selectedResources.has(r.resource_id);
                        return (
                          <tr key={r.resource_id}
                            className={`border-b border-gray-100 cursor-pointer transition ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}
                            onClick={() => toggleResource(r.resource_id)}>
                            <td className="px-3 py-2">
                              {checked
                                ? <CheckSquare className="w-4 h-4 text-blue-900" />
                                : <Square className="w-4 h-4 text-gray-400" />}
                            </td>
                            <td className="px-3 py-2 text-xs font-mono font-semibold text-black">{r.resource_id}</td>
                            <td className="px-3 py-2">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900">{r.service}</span>
                            </td>
                            <td className="px-3 py-2 text-xs text-black">{r.region || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {loadingResources && (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-5 h-5 animate-spin text-blue-900" />
                <span className="ml-2 text-sm text-black">Loading resources...</span>
              </div>
            )}

            {selectedAccounts.size > 0 && !loadingResources && accountResources.length === 0 && (
              <div className="text-center py-8 text-sm text-black">
                No resources found for this account.
              </div>
            )}

            <div className="flex-shrink-0 border-t border-gray-200 pt-4 mt-2">
              {/* Step 3: Select Business — shown after resources are loaded */}
              {accountResources.length > 0 && (
                <div className="mb-3">
                  <label className="text-xs font-bold uppercase tracking-wide text-black block mb-1">
                    Step 3 — Select Business <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <select
                    value={selectedBusiness}
                    onChange={(e) => setSelectedBusiness(e.target.value)}
                    className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black focus:border-blue-900 outline-none">
                    <option value="">— No business tag —</option>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] mt-1">
                    <span className="font-bold text-blue-900">Vertical={vertical?.name}</span>
                    {selectedBusiness && <span className="font-bold text-green-700"> + Business={businesses.find(b => b.id === selectedBusiness)?.name}</span>}
                    {" "}→ will be applied to {selectedResources.size} selected resource{selectedResources.size !== 1 ? "s" : ""}
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowBulkTag(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-xs font-bold text-black hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button
                  onClick={applyBulkTag}
                  disabled={tagging || selectedResources.size === 0}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-md transition disabled:opacity-50">
                  {tagging ? "Tagging..." : `Apply Tags to ${selectedResources.size} Resource${selectedResources.size !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
