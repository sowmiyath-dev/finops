import axios from "axios";

const api = axios.create({ 
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: false,
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      if (!window.location.pathname.includes("/auth")) {
        // Check if token is actually expired before redirecting
        const token = localStorage.getItem("token");
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            if (payload.exp * 1000 < Date.now()) {
              localStorage.removeItem("token");
              window.location.href = "/auth";
            }
          } catch {
            localStorage.removeItem("token");
            window.location.href = "/auth";
          }
        } else {
          window.location.href = "/auth";
        }
      }
    }
    return Promise.reject(err);
  }
);

export default api;
