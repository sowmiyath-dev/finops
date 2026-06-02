"use client";
import { DollarSign, TrendingUp, Tag, BarChart2, Globe, Layers, ArrowRight } from "lucide-react";
import Link from "next/link";

export default function OrgPage() {
  return (
    <div className="min-h-screen" style={{ background: "#f8faff" }}>
      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Hero */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold mb-4"
            style={{ background: "#e8f0fe", color: "#1a56db" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Multi-Cloud FinOps Platform
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Organization Overview</h1>
          <p className="text-sm text-gray-500">Unified cost visibility across AWS, Azure and Google Cloud</p>
        </div>

        {/* Cloud provider cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          {[
            {
              name: "Amazon Web Services",
              short: "AWS",
              status: "Active",
              href: "/dashboard",
              gradient: "linear-gradient(135deg, #ff9a3c 0%, #ff6b00 100%)",
              desc: "Control Towers · CUR Reports · Cost Analysis",
              cta: "View Control Towers",
              ctaColor: "text-orange-600",
            },
            {
              name: "Microsoft Azure",
              short: "Azure",
              status: "Active",
              href: "/clouds/azure",
              gradient: "linear-gradient(135deg, #4facfe 0%, #0078d4 100%)",
              desc: "Subscriptions · Resource Groups · Billing",
              cta: "Onboard Azure",
              ctaColor: "text-blue-600",
            },
            {
              name: "Google Cloud",
              short: "GCP",
              status: "Coming Soon",
              href: "/clouds/gcp",
              gradient: "linear-gradient(135deg, #a8edea 0%, #4285f4 100%)",
              desc: "Projects · Billing Accounts · Cost Export",
              cta: "Coming Soon",
            },
          ].map((cloud) => (
            <Link key={cloud.name} href={cloud.href}
              className="group rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5">
              {/* Gradient header */}
              <div className="px-5 py-6 text-white" style={{ background: cloud.gradient }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl font-black tracking-tight">{cloud.short}</span>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    cloud.status === "Active"
                      ? "bg-white/30 text-white"
                      : "bg-white/20 text-white/80"
                  }`}>{cloud.status}</span>
                </div>
                <div className="text-sm font-semibold text-white/90">{cloud.name}</div>
              </div>
              {/* Card body */}
              <div className="bg-white px-5 py-4">
                <p className="text-xs text-gray-500 mb-3">{cloud.desc}</p>
                <div className={`flex items-center gap-1 text-xs font-bold transition ${
                  cloud.status === "Active"
                    ? `${(cloud as any).ctaColor || "text-orange-600"} group-hover:gap-2`
                    : "text-gray-400"
                }`}>
                  {cloud.cta}
                  {cloud.status === "Active" && <ArrowRight className="w-3.5 h-3.5" />}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick access */}
        <div className="mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Quick Access</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Cost Reports",  href: "/reports",      icon: DollarSign, color: "#ff6b00", bg: "#fff4ec" },
            { label: "Verticals",     href: "/verticals",    icon: Layers,     color: "#7c3aed", bg: "#f5f3ff" },
            { label: "Tag Manager",   href: "/tag-manager",  icon: Tag,        color: "#059669", bg: "#ecfdf5" },
            { label: "Optimization",  href: "/optimization", icon: BarChart2,  color: "#0284c7", bg: "#f0f9ff" },
          ].map((item) => (
            <Link key={item.label} href={item.href}
              className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:shadow-md hover:border-gray-300 transition group">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: item.bg }}>
                <item.icon className="w-4 h-4" style={{ color: item.color }} />
              </div>
              <span className="text-sm font-semibold text-gray-800 group-hover:text-gray-900">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
