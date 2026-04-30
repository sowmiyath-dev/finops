"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { LogOut, LayoutDashboard, FileText, ScrollText, Shield, Plus, DollarSign } from "lucide-react";

export default function Navbar() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  const links = [
    { href: "/dashboard", label: "Control Towers", icon: LayoutDashboard },
    { href: "/reports",   label: "Cost Reports",   icon: FileText },
  ];

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-0 h-14"
      style={{ background: "var(--bg-nav)", boxShadow: "var(--shadow-nav)" }}>

      {/* Brand */}
      <Link href="/dashboard" className="flex items-center gap-2.5 group">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: "var(--accent)" }}>
          <DollarSign className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-white font-bold text-sm tracking-wide">FinOps CUR Portal</span>
          {user && (
            <span className="text-xs" style={{ color: "var(--text-nav-muted)" }}>
              {user.full_name || user.email} · <span className="capitalize">{user.role}</span>
            </span>
          )}
        </div>
      </Link>

      {/* Nav links */}
      <div className="flex items-center gap-1">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-all ${
                active
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </Link>
          );
        })}

        {(user?.role === "owner" || user?.role === "editor") && (
          <>
            <Link href="/sync-logs"
              className={`flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-all ${
                pathname === "/sync-logs"
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}>
              <ScrollText className="w-3.5 h-3.5" />Sync Logs
            </Link>
            <Link href="/onboard"
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded transition-all text-white"
              style={{ background: "var(--accent)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--accent-hover)")}
              onMouseLeave={e => (e.currentTarget.style.background = "var(--accent)")}>
              <Plus className="w-3.5 h-3.5" />Add Control Tower
            </Link>
          </>
        )}

        {user?.role === "owner" && (
          <Link href="/admin"
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded transition-all text-white/70 hover:text-white hover:bg-white/10">
            <Shield className="w-3.5 h-3.5" />Admin
          </Link>
        )}
      </div>

      {/* Logout */}
      <button onClick={() => { logout(); router.push("/"); }}
        className="flex items-center gap-1.5 px-3 py-2 rounded text-sm transition-all text-white/70 hover:text-white hover:bg-white/10">
        <LogOut className="w-4 h-4" />
        <span className="hidden lg:inline">Sign Out</span>
      </button>
    </nav>
  );
}
