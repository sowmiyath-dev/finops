"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

export default function Home() {
  const { token } = useAuthStore();
  const router = useRouter();
  useEffect(() => {
    router.replace(token ? "/org" : "/auth");
  }, [token]);
  return <div className="min-h-screen" style={{ background: "#f1f4f9" }} />;
}
