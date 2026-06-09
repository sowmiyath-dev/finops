import { create } from "zustand";
import api from "@/lib/api";

interface User { id: string; email: string; full_name?: string; mfa_enabled: boolean; role: string; }
interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (token: string) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: typeof window !== "undefined" ? sessionStorage.getItem("token") : null,

  setAuth: async (token) => {
    sessionStorage.setItem("token", token);
    set({ token });
    const me = await api.get("/auth/me");
    set({ user: me.data });
  },

  logout: () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("finoptix_verticals"); // clear vertical cache on logout
    set({ user: null, token: null });
  },

  fetchMe: async () => {
    if (get().user) return;
    try {
      const { data } = await api.get("/auth/me");
      set({ user: data });
    } catch {
      sessionStorage.removeItem("token");
      set({ user: null, token: null });
    }
  },
}));
