"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import axios from "axios";
import {
  Building2, Cloud, Tag, Bell, Settings, ChevronRight, ChevronDown,
  Menu, X, Users, Mail, AlertTriangle, Zap, Globe, DollarSign,
  LayoutDashboard, Layers,
} from "lucide-react";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");

interface NavItem {
  id: string;
  label: string;
  icon: any;
  href?: string;
  children?: NavItem[];
  badge?: string;
}

const STATIC_NAV: NavItem[] = [
  {
    id: "org",
    label: "Organization",
    icon: Building2,
    href: "/org",
  },
  {
    id: "verticals",
    label: "Verticals",
    icon: Layers,
    children: [
      { id: "verticals-overview", label: "Overview",    icon: Layers,    href: "/verticals" },
      { id: "verticals-report",   label: "Cost Report", icon: DollarSign, href: "/verticals/report" },
    ],
  },
  {
    id: "tags",
    label: "Tag Manager",
    icon: Tag,
    href: "/tag-manager",
  },
  {
    id: "alerts",
    label: "Alerts",
    icon: Bell,
    href: "/alerts",
    badge: "Soon",
  },
  {
    id: "optimization",
    label: "Optimization",
    icon: Zap,
    href: "/optimization",
    badge: "Soon",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    children: [
      { id: "settings-users",  label: "Users",       icon: Users,         href: "/settings/users" },
      { id: "settings-groups", label: "Groups",      icon: Users,         href: "/settings/groups" },
      { id: "settings-alerts", label: "Alert Rules", icon: AlertTriangle, href: "/settings/alert-rules" },
      { id: "settings-email",  label: "Email Config",icon: Mail,          href: "/settings/email" },
    ],
  },
];

function NavRow({ item, depth = 0, collapsed }: { item: NavItem; depth?: number; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = item.href
    ? pathname === item.href || pathname.startsWith(item.href + "/")
    : false;

  const isParentActive = item.children?.some((c) =>
    c.href ? pathname.startsWith(c.href) : false
  );

  const [open, setOpen] = useState(isActive || !!isParentActive);
  const Icon = item.icon;
  const pl = collapsed ? "px-3" : depth === 0 ? "px-4" : depth === 1 ? "pl-8 pr-4" : "pl-12 pr-4";

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => !collapsed && setOpen(!open)}
          title={collapsed ? item.label : undefined}
          className={`w-full flex items-center justify-between py-2.5 text-sm font-semibold transition ${pl} ${
            isParentActive ? "text-blue-900 bg-blue-50" : "text-black hover:bg-gray-100"
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon className={`w-4 h-4 flex-shrink-0 ${isParentActive ? "text-blue-900" : "text-black"}`} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </div>
          {!collapsed && (
            open ? <ChevronDown className="w-3.5 h-3.5 text-black" />
                 : <ChevronRight className="w-3.5 h-3.5 text-black" />
          )}
        </button>
        {!collapsed && open && (
          <div>
            {item.children.map((child) => (
              <NavRow key={child.id} item={child} depth={depth + 1} collapsed={collapsed} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href || "#"}
      title={collapsed ? item.label : undefined}
      className={`flex items-center justify-between py-2.5 text-sm font-semibold transition group ${pl} ${
        isActive
          ? "bg-blue-900 text-white border-r-2 border-blue-700"
          : "text-black hover:bg-gray-100"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-white" : "text-black"}`} />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </div>
      {!collapsed && item.badge && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
          item.badge === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
        }`}>{item.badge}</span>
      )}
    </Link>
  );
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [navItems, setNavItems] = useState<NavItem[]>(STATIC_NAV);
  const { token } = useAuthStore();

  useEffect(() => {
    if (!token) return;
    const cached = sessionStorage.getItem("finoptix_verticals");
    if (cached) {
      try { JSON.parse(cached); } catch {}
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateVerticals = (_verts: { id: string; name: string }[]) => {};


  return (
    <aside
      className="flex-shrink-0 bg-white border-r border-gray-300 flex flex-col transition-all duration-200"
      style={{ width: collapsed ? 56 : 240, minHeight: "100vh" }}
    >
      {/* Header */}
      <div className={`flex items-center border-b border-gray-200 bg-blue-900 ${collapsed ? "justify-center py-4" : "justify-between px-4 py-3"}`}>
        {!collapsed && (
          <div>
            <span className="text-white font-bold text-base tracking-wide">Finoptix</span>
            <div className="text-white/60 text-[10px] font-medium">Multi-Cloud FinOps</div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded hover:bg-white/10 transition text-white"
        >
          {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map((item) => (
          <NavRow key={item.id} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
          <div className="text-[10px] font-semibold text-black">Finoptix v2.0</div>
          <div className="text-[10px] text-black">Multi-Cloud FinOps Platform</div>
        </div>
      )}
    </aside>
  );
}
