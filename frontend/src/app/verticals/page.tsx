"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { Layers, Users, Box, DollarSign, ChevronRight, Plus, RefreshCw } from "lucide-react";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");

const VERTICAL_COLORS: Record<string, string> = {
  Lending: "#0f2d5e",
  Insurance: "#1d8348",
  EBS: "#ec7211",
  "L&D": "#8e44ad",
};

const GRANULARITY_OPTIONS = [
  { label: "Daily",   value: "daily" },
  { label: "Weekly",  value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

interface VerticalItem { id: string; name: string; color: string; description?: string; }
interface OwnerCost {
  owner_id: string; owner_name: string; app_count: number;
  resource_count: number; total_cost: number;
  trend: { period: string; cost: number }[];
}
interface VerticalCost {
  vertical_id: string; owners: OwnerCost[];
}

export default function VerticalsPage() {
  const { token } = useAuthStore();
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const router = useRouter();
  const [verticals, setVerticals] = useState<VerticalItem[]>([]);
  const [costMap, setCostMap] = useState<Record<string, VerticalCost>>({});
  const [granularity, setGranularity] = useState("monthly");
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const getHeaders = () => ({ Authorization: `Bearer ${tokenRef.current}` });

  const load = async (gran?: string) => {
    const g = gran ?? granularity;
    setLoading(true);
    try {
      const vertsRes = await axios.get(`${BASE}/api/verticals/`, { headers: getHeaders() });
      const verts: VerticalItem[] = vertsRes.data;
      setVerticals(verts);

      if (verts.length > 0) {
        const costs: Record<string, VerticalCost> = {};
        await Promise.all(
          verts.map(async (v) => {
            try {
              const res = await axios.get(`${BASE}/api/verticals/${v.id}/cost`, {
                headers: getHeaders(),
                params: { granularity: g },
              });
              costs[v.id] = res.data;
            } catch { /* no cost data yet */ }
          })
        );
        setCostMap(costs);
      }
    } catch (err) {
      console.error("Failed to load verticals", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGranularity = (g: string) => {
    setGranularity(g);
    load(g);
  };

  const seed = async () => {
    setSeeding(true);
    try {
      await axios.post(`${BASE}/api/verticals/seed`, {}, { headers: getHeaders() });
      await load(granularity);
    } catch (err: any) {
      console.error("Seed failed", err?.response?.data || err);
      alert(err?.response?.data?.detail || "Seed failed — check backend logs");
    } finally {
      setSeeding(false);
    }
  };

  const totalCost = (v: VerticalItem) =>
    (costMap[v.id]?.owners || []).reduce((s, o) => s + o.total_cost, 0);
  const ownerCount = (v: VerticalItem) => costMap[v.id]?.owners.length ?? 0;
  const appCount = (v: VerticalItem) =>
    (costMap[v.id]?.owners || []).reduce((s, o) => s + o.app_count, 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-900" /> Verticals
          </h1>
          <p className="text-sm text-black mt-1">Business unit cost visibility across all cloud providers</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex border border-gray-300 rounded-md overflow-hidden">
            {GRANULARITY_OPTIONS.map((g) => (
              <button key={g.value} onClick={() => handleGranularity(g.value)}
                className={`px-4 py-2 text-xs font-bold transition ${
                  granularity === g.value ? "bg-blue-900 text-white" : "bg-white text-black hover:bg-gray-50"
                }`}>
                {g.label}
              </button>
            ))}
          </div>

          {!loading && verticals.length === 0 && (
            <button onClick={seed} disabled={seeding}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-md transition disabled:opacity-60">
              <Plus className="w-3.5 h-3.5" />
              {seeding ? "Seeding..." : "Seed Verticals"}
            </button>
          )}

          <button onClick={() => load()} title="Refresh"
            className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition">
            <RefreshCw className={`w-4 h-4 text-black ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-sm font-semibold text-black">
          Loading verticals...
        </div>
      ) : verticals.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-300 p-12 text-center">
          <Layers className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-black mb-1">No verticals yet</p>
          <p className="text-xs text-black mb-4">Click "Seed Verticals" to create Lending, Insurance, EBS and L&D</p>
          <button onClick={seed} disabled={seeding}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-md transition disabled:opacity-60">
            <Plus className="w-3.5 h-3.5" />
            {seeding ? "Seeding..." : "Seed Verticals"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {verticals.map((v) => {
            const color = VERTICAL_COLORS[v.name] || v.color || "#0f2d5e";
            const owners = costMap[v.id]?.owners || [];
            const total = totalCost(v);

            return (
              <div key={v.id}
                className="bg-white rounded-lg border border-gray-300 shadow-sm hover:shadow-md hover:border-blue-900 transition cursor-pointer"
                onClick={() => router.push(`/verticals/${v.id}`)}>
                <div className="rounded-t-lg px-5 py-4 flex items-center justify-between" style={{ background: color }}>
                  <div className="flex items-center gap-3">
                    <Layers className="w-5 h-5 text-white" />
                    <span className="text-white font-bold text-base">{v.name}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/70" />
                </div>

                <div className="grid grid-cols-3 divide-x divide-gray-200 border-b border-gray-200">
                  {[
                    { label: "Total Cost", value: `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                    { label: "Owners",      value: ownerCount(v) },
                    { label: "Applications", value: appCount(v) },
                  ].map((stat) => (
                    <div key={stat.label} className="px-4 py-3 text-center">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-1">{stat.label}</div>
                      <div className="text-sm font-bold text-blue-900 font-mono">{stat.value}</div>
                    </div>
                  ))}
                </div>

                <div className="p-4">
                  {owners.length === 0 ? (
                    <p className="text-xs text-black text-center py-2">No owners yet — click to add</p>
                  ) : (
                    <div className="space-y-2">
                      {owners.slice(0, 4).map((o) => (
                        <div key={o.owner_id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                              style={{ background: color }}>
                              {o.owner_name.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-xs font-semibold text-black">{o.owner_name}</span>
                            <span className="text-[10px] text-black bg-gray-100 px-1.5 py-0.5 rounded">{o.app_count} apps</span>
                          </div>
                          <span className="text-xs font-bold font-mono text-blue-900">
                            ${o.total_cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                      {owners.length > 4 && (
                        <p className="text-[10px] text-black text-right">+{owners.length - 4} more owners</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
