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
    onSuccess: () => { toast.success("User created"); qc.invalidateQueries({ queryKey: ["admin-users"] }); setShowCreate(false); setForm({ email: "", full_name: "", password: "", role: "viewer" }); },
    onError: (err: any) => toast.error(err.response?.data?.detail || "Failed"),
  });

  const inputCls = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#7c3aed] transition";

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-[#fb7185]" />
            <div>
              <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
              <p className="text-slate-400 text-sm">Manage users and access</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2 bg-[#7c3aed] hover:bg-[#6d28d9] text-white rounded-lg text-sm font-semibold transition">
            <UserPlus className="w-4 h-4" /> Create User
          </button>
        </div>

        {showCreate && (
          <div className="card p-6 mb-6 animate-slide-up">
            <h3 className="text-sm font-semibold text-white mb-4">Create New User</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Email</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} placeholder="user@company.com" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Full Name</label>
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className={inputCls} placeholder="John Doe" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Password</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} placeholder="••••••••" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => createMutation.mutate()}
                className="px-4 py-2 bg-[#7c3aed] hover:bg-[#6d28d9] text-white rounded-lg text-sm font-semibold transition">
                Create
              </button>
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 border border-slate-700 text-slate-400 hover:text-white rounded-lg text-sm transition">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-800/50">
                {["User", "Role", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className="text-center py-10"><div className="w-6 h-6 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>}
              {users.map((u: any) => (
                <tr key={u.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                  <td className="px-5 py-3">
                    <div className="text-sm text-white font-medium">{u.full_name || "—"}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    <select value={u.role} onChange={(e) => roleMutation.mutate({ id: u.id, role: e.target.value })}
                      className="bg-slate-900 border border-slate-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-[#7c3aed]">
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="owner">Owner</option>
                    </select>
                  </td>
                  <td className="px-5 py-3">
                    {u.is_approved ? (
                      <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">Approved</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full">Pending</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {!u.is_approved && (
                        <button onClick={() => approveMutation.mutate(u.id)}
                          className="p-1.5 hover:text-emerald-400 text-slate-400 transition hover:bg-emerald-400/10 rounded-lg" title="Approve">
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => { if (confirm("Delete this user?")) deleteMutation.mutate(u.id); }}
                        className="p-1.5 hover:text-[#fb7185] text-slate-400 transition hover:bg-[#f43f5e]/10 rounded-lg" title="Delete">
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
