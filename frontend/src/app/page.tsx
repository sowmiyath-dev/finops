"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

export default function Home() {
  const { token } = useAuthStore();
  const router = useRouter();
  useEffect(() => {
    router.replace(token ? "/dashboard" : "/auth");
  }, [token]);
  return <div className="min-h-screen bg-[#080d1a]" />;
}
