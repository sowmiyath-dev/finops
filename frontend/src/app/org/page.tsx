"use client";
import { DollarSign, TrendingUp, AlertTriangle, BarChart2, Globe, Layers } from "lucide-react";
import Link from "next/link";

export default function OrgPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-black">Organization Overview</h1>
        <p className="text-sm text-black mt-1">Multi-cloud cost visibility across all providers</p>
      </div>

      {/* Cloud provider cards — main focus */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {[
          {
            name: "Amazon Web Services",
            status: "Active",
            color: "#ec7211",
            bg: "#fff8f3",
            border: "#f59332",
            href: "/dashboard",
            desc: "Control Towers, CUR reports, cost analysis",
          },
          {
            name: "Microsoft Azure",
            status: "Coming Soon",
            color: "#0078d4",
            bg: "#f0f7ff",
            border: "#93c5fd",
            href: "/clouds/azure",
            desc: "Subscriptions, resource groups, billing",
          },
          {
            name: "Google Cloud",
            status: "Coming Soon",
            color: "#4285f4",
            bg: "#f0f4ff",
            border: "#a5b4fc",
            href: "/clouds/gcp",
            desc: "Projects, billing accounts, cost export",
          },
        ].map((cloud) => (
          <Link key={cloud.name} href={cloud.href}
            className="rounded-xl border-2 p-6 hover:shadow-md transition group"
            style={{ background: cloud.bg, borderColor: cloud.border }}>
            <div className="flex items-center justify-between mb-4">
              <Globe className="w-8 h-8" style={{ color: cloud.color }} />
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                cloud.status === "Active"
                  ? "bg-green-100 text-green-800 border border-green-300"
                  : "bg-gray-100 text-gray-600 border border-gray-300"
              }`}>{cloud.status}</span>
            </div>
            <div className="text-base font-bold text-black mb-1">{cloud.name}</div>
            <div className="text-xs text-black">{cloud.desc}</div>
            {cloud.status === "Active" && (
              <div className="mt-3 text-xs font-bold text-orange-600 group-hover:underline">
                View Control Towers →
              </div>
            )}
            {cloud.status !== "Active" && (
              <div className="mt-3 text-xs font-bold text-gray-400">Coming Soon</div>
            )}
          </Link>
        ))}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Cost Reports",  href: "/reports",      icon: DollarSign,    color: "#ec7211" },
          { label: "Verticals",     href: "/verticals",    icon: Layers,        color: "#0f2d5e" },
          { label: "Tag Manager",   href: "/tag-manager",  icon: TrendingUp,    color: "#1d8348" },
          { label: "Optimization",  href: "/optimization", icon: BarChart2,     color: "#8e44ad" },
        ].map((item) => (
          <Link key={item.label} href={item.href}
            className="bg-white rounded-lg border border-gray-300 shadow-sm p-4 hover:shadow-md hover:border-blue-900 transition flex items-center gap-3">
            <item.icon className="w-5 h-5 flex-shrink-0" style={{ color: item.color }} />
            <span className="text-sm font-bold text-black">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
