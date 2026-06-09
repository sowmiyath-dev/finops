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

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 < Date.now();
  } catch { return true; }
}

function getSavedToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("token");
  if (!token || isTokenExpired(token)) {
    localStorage.removeItem("token");
    return null;
  }
  return token;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: getSavedToken(),

  setAuth: async (token) => {
    localStorage.setItem("token", token);
    set({ token });
    const me = await api.get("/auth/me");
    set({ user: me.data });
  },

  logout: () => {
    localStorage.removeItem("token");
    set({ user: null, token: null });
  },

  fetchMe: async () => {
    if (get().user) return;
    const token = get().token;
    if (!token || isTokenExpired(token)) {
      localStorage.removeItem("token");
      set({ user: null, token: null });
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      set({ user: data });
    } catch {
      localStorage.removeItem("token");
      set({ user: null, token: null });
    }
  },
}));
