"use client";
import { Cloud, DollarSign, TrendingUp, AlertTriangle, BarChart2, Globe } from "lucide-react";
import Link from "next/link";

export default function OrgPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-black">Organization Overview</h1>
        <p className="text-sm text-black mt-1">Cumulative cost visibility across all cloud providers</p>
      </div>

      {/* Cloud status cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[
          { name: "Amazon Web Services", status: "Active", color: "#ec7211", href: "/dashboard", accounts: "6 accounts" },
          { name: "Microsoft Azure", status: "Coming Soon", color: "#0078d4", href: "/clouds/azure", accounts: "—" },
          { name: "Google Cloud", status: "Coming Soon", color: "#4285f4", href: "/clouds/gcp", accounts: "—" },
        ].map((cloud) => (
          <Link key={cloud.name} href={cloud.href}
            className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 hover:shadow-md hover:border-blue-900 transition">
            <div className="flex items-center justify-between mb-3">
              <Globe className="w-6 h-6" style={{ color: cloud.color }} />
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                cloud.status === "Active"
                  ? "bg-green-100 text-green-800 border border-green-300"
                  : "bg-gray-100 text-black border border-gray-300"
              }`}>{cloud.status}</span>
            </div>
            <div className="text-sm font-bold text-black">{cloud.name}</div>
            <div className="text-xs font-semibold text-black mt-1">{cloud.accounts}</div>
          </Link>
        ))}
      </div>

      {/* Dashboard links */}
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-bold text-black mb-4 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-blue-900" /> Cost Dashboards
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Monthly Cost Dashboard", href: "/org/dashboard/monthly", desc: "Month-over-month cost trends" },
            { label: "Weekly Cost Dashboard",  href: "/org/dashboard/weekly",  desc: "Week-over-week cost trends" },
            { label: "Daily Cost Dashboard",   href: "/org/dashboard/daily",   desc: "Daily cost breakdown" },
          ].map((d) => (
            <Link key={d.label} href={d.href}
              className="p-4 rounded-lg border-2 border-gray-200 hover:border-blue-900 hover:bg-blue-50 transition">
              <div className="text-sm font-bold text-black">{d.label}</div>
              <div className="text-xs text-black mt-1">{d.desc}</div>
              <div className="text-xs font-bold text-blue-900 mt-2">Coming Soon →</div>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "AWS Cost Reports", href: "/reports", icon: DollarSign, color: "#ec7211" },
          { label: "Tag Manager", href: "/tag-manager", icon: TrendingUp, color: "#0f2d5e" },
          { label: "Alerts", href: "/alerts", icon: AlertTriangle, color: "#c0392b" },
          { label: "Optimization", href: "/optimization", icon: BarChart2, color: "#1d8348" },
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
