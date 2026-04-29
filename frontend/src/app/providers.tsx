"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useState, useEffect } from "react";

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
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          className: "!text-sm",
          style: {
            background: "#0d1424",
            color: "#f0f4ff",
            border: "1px solid rgba(99,102,241,0.20)",
          },
        }}
      />
    </QueryClientProvider>
  );
}
