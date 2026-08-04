"use client";
import { memo } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { LogOut, Bell, Settings } from "lucide-react";

export default memo(function Navbar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  return (
    <nav className="h-12 flex items-center justify-between px-6 border-b border-gray-300 bg-white sticky top-0 z-40"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>

      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-black">Finoptix</span>
        <span className="text-xs text-black px-2 py-0.5 rounded bg-blue-100 border border-blue-300 font-semibold">
          Multi-Cloud FinOps
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button className="p-2 rounded-md hover:bg-gray-100 transition text-black" title="Alerts">
          <Bell className="w-4 h-4" />
        </button>
        <button onClick={() => router.push("/settings/users")}
          className="p-2 rounded-md hover:bg-gray-100 transition text-black" title="Settings">
          <Settings className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 ml-2 pl-2 border-l border-gray-200">
          <div className="w-7 h-7 rounded-full bg-blue-900 flex items-center justify-center text-white text-xs font-bold">
            {user?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="hidden md:block">
            <div className="text-xs font-bold text-black leading-tight">{user?.full_name || user?.email}</div>
            <div className="text-[10px] text-black capitalize">{user?.role}</div>
          </div>
          <button onClick={() => { logout(); router.push("/"); }}
            className="p-1.5 rounded-md hover:bg-red-50 hover:text-red-700 transition text-black ml-1" title="Sign out">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </nav>
  );
});
