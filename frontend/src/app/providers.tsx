"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useState, useEffect } from "react";
import AppShell from "@/components/AppShell";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    const token = sessionStorage.getItem("token");
    if (token) {
      import("@/store/authStore").then(({ useAuthStore }) => {
        useAuthStore.getState().fetchMe();
      });
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>{children}</AppShell>
      <Toaster
        position="top-right"
        toastOptions={{
          className: "!text-sm",
          style: {
            background: "white",
            color: "#000000",
            border: "1px solid #d1d9e6",
            boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
          },
        }}
      />
    </QueryClientProvider>
  );
}
