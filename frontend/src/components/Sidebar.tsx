"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import axios from "axios";
import {
  Building2, Cloud, BarChart2, Tag, Bell, Settings,
  ChevronRight, ChevronDown, Pin, PinOff, Menu, X,
  Users, Mail, AlertTriangle, Zap, Globe, DollarSign,
  LayoutDashboard, TrendingUp, Calendar, Clock, Layers,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface NavItem {
  id: string;
  label: string;
  icon: any;
  href?: string;
  children?: NavItem[];
  badge?: string;
  pinnable?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "org",
    label: "Organization",
    icon: Building2,
    children: [
      { id: "org-overview", label: "Overview", icon: LayoutDashboard, href: "/org" },
      { id: "org-dashboard", label: "Dashboards", icon: BarChart2, href: "/org/dashboard" },
      {
        id: "clouds",
        label: "Clouds",
        icon: Cloud,
        children: [
          {
            id: "aws",
            label: "Amazon Web Services",
            icon: Globe,
            badge: "Active",
            children: [
              { id: "aws-towers",  label: "Control Towers", icon: Building2,  href: "/dashboard" },
              { id: "aws-reports", label: "Cost Reports",   icon: DollarSign, href: "/reports" },
              { id: "aws-sync",    label: "Sync Logs",      icon: Clock,      href: "/sync-logs" },
            ],
          },
          {
            id: "azure",
            label: "Microsoft Azure",
            icon: Globe,
            badge: "Coming Soon",
            children: [
              { id: "azure-overview", label: "Overview", icon: LayoutDashboard, href: "/clouds/azure" },
            ],
          },
          {
            id: "gcp",
            label: "Google Cloud",
            icon: Globe,
            badge: "Coming Soon",
            children: [
              { id: "gcp-overview", label: "Overview", icon: LayoutDashboard, href: "/clouds/gcp" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "verticals",
    label: "Verticals",
    icon: Layers,
    children: [
      { id: "verticals-all", label: "All Verticals", icon: LayoutDashboard, href: "/verticals" },
    ],
  },
  {
    id: "tags",
    label: "Tag Manager",
    icon: Tag,
    href: "/tag-manager",
    pinnable: true,
  },
  {
    id: "alerts",
    label: "Alerts",
    icon: Bell,
    href: "/alerts",
    badge: "Soon",
    pinnable: true,
  },
  {
    id: "optimization",
    label: "Optimization",
    icon: Zap,
    href: "/optimization",
    badge: "Soon",
    pinnable: true,
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    children: [
      { id: "settings-users",  label: "Users",          icon: Users,        href: "/settings/users" },
      { id: "settings-groups", label: "Groups",         icon: Users,        href: "/settings/groups" },
      { id: "settings-alerts", label: "Alert Rules",    icon: AlertTriangle, href: "/settings/alert-rules" },
      { id: "settings-email",  label: "Email Config",   icon: Mail,         href: "/settings/email" },
    ],
  },
];

function NavItemRow({
  item, depth = 0, collapsed, pinned, onPin,
}: {
  item: NavItem; depth?: number; collapsed: boolean; pinned: Set<string>; onPin: (id: string) => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(() => {
    // Auto-expand if current path is under this item
    if (item.href && pathname.startsWith(item.href)) return true;
    if (item.children) {
      return item.children.some((c) =>
        c.href ? pathname.startsWith(c.href) : c.children?.some((cc) => cc.href && pathname.startsWith(cc.href))
      );
    }
    return false;
  });

  const isActive = item.href ? pathname === item.href || pathname.startsWith(item.href + "/") : false;
  const Icon = item.icon;
  const isPinned = pinned.has(item.id);

  const paddingLeft = collapsed ? "px-3" : depth === 0 ? "px-4" : depth === 1 ? "pl-8 pr-4" : "pl-12 pr-4";

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => !collapsed && setOpen(!open)}
          title={collapsed ? item.label : undefined}
          className={`w-full flex items-center justify-between py-2.5 text-sm font-semibold transition group ${paddingLeft} ${
            isActive ? "bg-blue-50 text-blue-900" : "text-black hover:bg-gray-100"
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-blue-900" : "text-black"}`} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </div>
          {!collapsed && (
            <div className="flex items-center gap-1">
              {item.badge && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  item.badge === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                }`}>{item.badge}</span>
              )}
              {open ? <ChevronDown className="w-3.5 h-3.5 text-black" /> : <ChevronRight className="w-3.5 h-3.5 text-black" />}
            </div>
          )}
        </button>
        {!collapsed && open && (
          <div>
            {item.children.map((child) => (
              <NavItemRow key={child.id} item={child} depth={depth + 1} collapsed={collapsed} pinned={pinned} onPin={onPin} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link href={item.href || "#"}
      title={collapsed ? item.label : undefined}
      className={`flex items-center justify-between py-2.5 text-sm font-semibold transition group ${paddingLeft} ${
        isActive
          ? "bg-blue-900 text-white border-r-2 border-blue-700"
          : "text-black hover:bg-gray-100"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-white" : "text-black"}`} />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </div>
      {!collapsed && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          {item.badge && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              item.badge === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
            }`}>{item.badge}</span>
          )}
          {item.pinnable && (
            <button
              onClick={(e) => { e.preventDefault(); onPin(item.id); }}
              className="p-0.5 rounded hover:bg-gray-200 transition"
              title={isPinned ? "Unpin" : "Pin to top"}
            >
              {isPinned
                ? <PinOff className="w-3 h-3 text-blue-900" />
                : <Pin className="w-3 h-3 text-black" />}
            </button>
          )}
        </div>
      )}
    </Link>
  );
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [navItems, setNavItems] = useState<NavItem[]>(NAV_ITEMS);
  const { token } = useAuthStore();

  // Load pinned from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("finoptix_pinned");
    if (saved) setPinned(new Set(JSON.parse(saved)));
  }, []);

  // Load verticals dynamically — cached, only fetches once per session
  useEffect(() => {
    if (!token) return;
    // Check session cache first
    const cached = sessionStorage.getItem("finoptix_verticals");
    if (cached) {
      try {
        const verts = JSON.parse(cached);
        if (verts.length > 0) { updateVerticals(verts); return; }
      } catch {}
    }
    const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/api$/, "");
    axios.get(`${BASE}/api/verticals/`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        const verts: { id: string; name: string }[] = res.data;
        if (verts.length === 0) return;
        sessionStorage.setItem("finoptix_verticals", JSON.stringify(verts));
        updateVerticals(verts);
      })
      .catch(() => {});
  }, [token]);

  const updateVerticals = (verts: { id: string; name: string }[]) => {
    setNavItems((prev) =>
      prev.map((item) =>
        item.id === "verticals"
          ? {
              ...item,
              children: [
                { id: "verticals-all", label: "All Verticals", icon: LayoutDashboard, href: "/verticals" },
                ...verts.map((v) => ({
                  id: `vertical-${v.id}`,
                  label: v.name,
                  icon: Layers,
                  href: `/verticals/${v.id}`,
                })),
              ],
            }
          : item
      )
    );
  };

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("finoptix_pinned", JSON.stringify(Array.from(next)));
      return next;
    });
  };

  // Pinned items shown at top
  const pinnedItems = navItems.filter((item) => pinned.has(item.id));
  const unpinnedItems = navItems.filter((item) => !pinned.has(item.id));

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
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
        </button>
      </div>

      {/* Pinned items */}
      {!collapsed && pinnedItems.length > 0 && (
        <div className="border-b border-gray-200">
          <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black bg-gray-50">
            Pinned
          </div>
          {pinnedItems.map((item) => (
            <NavItemRow key={item.id} item={item} collapsed={collapsed} pinned={pinned} onPin={togglePin} />
          ))}
        </div>
      )}

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {unpinnedItems.map((item) => (
          <NavItemRow key={item.id} item={item} collapsed={collapsed} pinned={pinned} onPin={togglePin} />
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
