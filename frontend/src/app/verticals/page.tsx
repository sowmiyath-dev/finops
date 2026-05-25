"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { Layers, ChevronRight, Plus, RefreshCw, BarChart2 } from "lucide-react";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");

const GRANULARITY_OPTIONS = [
  { label: "Daily",   value: "daily" },
  { label: "Weekly",  value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

interface VerticalSummary {
  id: string; name: string; color: string; description?: string;
  total_cost: number; resource_count: number;
  owner_count: number; app_count: number;
  start: string; end: string;
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export default function VerticalsPage() {
  const { token } = useAuthStore();
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const router = useRouter();
  const [verticals, setVerticals] = useState<VerticalSummary[]>([]);
  const [granularity, setGranularity] = useState("monthly");
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const getHeaders = () => ({ Authorization: `Bearer ${tokenRef.current}` });

  const load = async (gran?: string) => {
    const g = gran ?? granularity;
    setLoading(true);
    try {
      const res = await axios.get(`${BASE}/api/verticals/summary`, {
        headers: getHeaders(),
        params: { granularity: g },
      });
      setVerticals(res.data);
    } catch (err) {
      console.error("Failed to load verticals", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return; // wait for token to be available
    load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGranularity = (g: string) => { setGranularity(g); load(g); };

  const seed = async () => {
    setSeeding(true);
    try {
      await axios.post(`${BASE}/api/verticals/seed`, {}, { headers: getHeaders() });
      await load(granularity);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Seed failed — check backend logs");
    } finally {
      setSeeding(false);
    }
  };

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
          <button onClick={() => router.push("/verticals/report")}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-md transition">
            <BarChart2 className="w-3.5 h-3.5" /> Cost Report
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-300 shadow-sm animate-pulse">
              <div className="h-14 rounded-t-lg bg-gray-200" />
              <div className="grid grid-cols-3 divide-x divide-gray-200 border-b border-gray-200">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="px-4 py-3 text-center">
                    <div className="h-2 bg-gray-200 rounded mx-auto w-16 mb-2" />
                    <div className="h-4 bg-gray-200 rounded mx-auto w-20" />
                  </div>
                ))}
              </div>
              <div className="px-5 py-3">
                <div className="h-3 bg-gray-200 rounded w-40" />
              </div>
            </div>
          ))}
        </div>
      ) : verticals.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-300 p-12 text-center">
          <Layers className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-black mb-1">No verticals yet</p>
          <p className="text-xs text-black mb-4">Click "Seed Verticals" to create the default verticals</p>
          <button onClick={seed} disabled={seeding}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-md transition disabled:opacity-60">
            <Plus className="w-3.5 h-3.5" />
            {seeding ? "Seeding..." : "Seed Verticals"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {verticals.map((v) => {
            const color = v.color || "#0f2d5e";
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
                    { label: "Total Cost",    value: fmt(v.total_cost) },
                    { label: "Owners",        value: v.owner_count },
                    { label: "Applications",  value: v.app_count },
                  ].map((stat) => (
                    <div key={stat.label} className="px-4 py-3 text-center">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-1">{stat.label}</div>
                      <div className="text-sm font-bold text-blue-900 font-mono">{stat.value}</div>
                    </div>
                  ))}
                </div>

                <div className="px-5 py-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-black">
                    {v.resource_count.toLocaleString()} tagged resources
                  </span>
                  <span className="text-[10px] text-gray-400">{v.start} → {v.end}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
