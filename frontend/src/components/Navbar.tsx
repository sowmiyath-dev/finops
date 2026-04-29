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
    <nav className="flex items-center justify-between px-6 py-3 border-b bg-[#080d1a]/90 border-[#7c3aed]/10 backdrop-blur-md sticky top-0 z-50">
      {/* Brand */}
      <Link href="/dashboard" className="flex items-center gap-2.5 group">
        <div className="w-8 h-8 bg-gradient-to-br from-[#7c3aed] to-[#06b6d4] rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
          <DollarSign className="w-4 h-4 text-white" />
        </div>
        <span className="text-lg font-bold text-white">
          <span className="text-[#22d3ee]">FinOps</span> CUR Portal
        </span>
        {user && (
          <div className="hidden lg:flex flex-col leading-tight ml-1">
            <span className="text-xs font-medium text-white">{user.full_name || user.email}</span>
            <span className="text-[10px] text-[#94a3c4] capitalize">{user.role}</span>
          </div>
        )}
      </Link>

      {/* Nav links */}
      <div className="flex items-center gap-1">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                active
                  ? "bg-[#7c3aed]/15 text-[#c084fc] border-[#7c3aed]/30"
                  : "text-[#94a3c4] hover:text-white hover:bg-[#7c3aed]/8 border-transparent"
              }`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </Link>
          );
        })}

        {(user?.role === "owner" || user?.role === "editor") && (
          <>
            <Link href="/sync-logs"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                pathname === "/sync-logs"
                  ? "bg-[#7c3aed]/15 text-[#c084fc] border-[#7c3aed]/30"
                  : "text-[#94a3c4] hover:text-white hover:bg-[#7c3aed]/8 border-transparent"
              }`}>
              <ScrollText className="w-3.5 h-3.5" />Sync Logs
            </Link>
            <Link href="/onboard"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gradient-to-r from-[#7c3aed]/15 to-[#06b6d4]/10 hover:from-[#7c3aed]/25 hover:to-[#06b6d4]/20 text-[#c084fc] border border-[#7c3aed]/25 hover:border-[#7c3aed]/45 rounded-lg transition-all">
              <Plus className="w-3.5 h-3.5" />Add Control Tower
            </Link>
          </>
        )}

        {user?.role === "owner" && (
          <Link href="/admin"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-[#f43f5e]/10 hover:bg-[#f43f5e]/20 text-[#fb7185] border border-[#f43f5e]/25 rounded-lg transition-all">
            <Shield className="w-3.5 h-3.5" />Admin
          </Link>
        )}
      </div>

      {/* Logout */}
      <button onClick={() => { logout(); router.push("/"); }}
        className="p-2 rounded-lg transition-all text-[#94a3c4] hover:text-[#fb7185] hover:bg-[#f43f5e]/10">
        <LogOut className="w-4 h-4" />
      </button>
    </nav>
  );
}
