"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";
import toast from "react-hot-toast";
import { UserPlus, Trash2, CheckCircle, Shield } from "lucide-react";

export default function AdminPage() {
  const { token, user } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) { router.push("/auth"); return; }
    if (user && user.role !== "owner") router.push("/dashboard");
  }, [token, user]);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", password: "", role: "viewer" });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get("/admin/users").then((r) => r.data),
    enabled: !!token && user?.role === "owner",
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/users/${id}/approve`),
    onSuccess: () => { toast.success("User approved"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.patch(`/admin/users/${id}/role?role=${role}`),
    onSuccess: () => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => { toast.success("User deleted"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/admin/users", form),
    onSuccess: () => {
      toast.success("User created");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setShowCreate(false);
      setForm({ email: "", full_name: "", password: "", role: "viewer" });
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || "Failed"),
  });

  const inputCls = "w-full border rounded-md px-3 py-2 text-sm focus:outline-none transition bg-white border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: "#fde8e8" }}>
              <Shield className="w-5 h-5" style={{ color: "var(--danger)" }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>Admin Panel</h1>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Manage users and access</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-md transition"
            style={{ background: "var(--primary)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--primary-light)")}
            onMouseLeave={e => (e.currentTarget.style.background = "var(--primary)")}>
            <UserPlus className="w-4 h-4" /> Create User
          </button>
        </div>

        {/* Create user form */}
        {showCreate && (
          <div className="card p-6 mb-6 animate-slide-up">
            <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>Create New User</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Email</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={inputCls} placeholder="user@company.com" style={{ color: "var(--text-primary)" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Full Name</label>
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className={inputCls} placeholder="John Doe" style={{ color: "var(--text-primary)" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Password</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={inputCls} placeholder="••••••••" style={{ color: "var(--text-primary)" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className={inputCls} style={{ color: "var(--text-primary)" }}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => createMutation.mutate()}
                className="px-4 py-2 text-sm font-semibold text-white rounded-md transition"
                style={{ background: "var(--primary)" }}>
                Create
              </button>
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm font-medium rounded-md border transition"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Users table */}
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid var(--border)" }}>
                {["User", "Role", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={4} className="text-center py-10">
                    <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto"
                      style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
                  </td>
                </tr>
              )}
              {users.map((u: any) => (
                <tr key={u.id} className="transition"
                  style={{ borderBottom: "1px solid #f0f4f8" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <td className="px-5 py-3">
                    <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{u.full_name || "—"}</div>
                    <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{u.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    <select value={u.role} onChange={(e) => roleMutation.mutate({ id: u.id, role: e.target.value })}
                      className="border rounded-md px-2 py-1 text-xs focus:outline-none focus:border-blue-600 bg-white"
                      style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="owner">Owner</option>
                    </select>
                  </td>
                  <td className="px-5 py-3">
                    {u.is_approved ? (
                      <span className="badge-success">Approved</span>
                    ) : (
                      <span className="badge-warning">Pending</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      {!u.is_approved && (
                        <button onClick={() => approveMutation.mutate(u.id)}
                          className="p-1.5 rounded-md transition" title="Approve"
                          style={{ color: "var(--text-muted)" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--success)"; (e.currentTarget as HTMLElement).style.background = "var(--success-bg)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => { if (confirm("Delete this user?")) deleteMutation.mutate(u.id); }}
                        className="p-1.5 rounded-md transition" title="Delete"
                        style={{ color: "var(--text-muted)" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--danger)"; (e.currentTarget as HTMLElement).style.background = "var(--danger-bg)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
