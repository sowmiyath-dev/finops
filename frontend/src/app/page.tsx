"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

export default function Home() {
  const token = useAuthStore((s) => s.token);
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    router.replace(token ? "/org" : "/auth");
  }, [token, router]);

  return <div className="min-h-screen" style={{ background: "#f1f4f9" }} />;
}
