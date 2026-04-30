"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Users, UserPlus, Trash2, CheckCircle, Shield } from "lucide-react";

export default function SettingsUsersPage() {
  const { token, user } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) { router.push("/auth"); return; }
    if (user && user.role !== "owner") router.push("/org");
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

  const inputCls = "w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-900";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-blue-900" />
          <div>
            <h1 className="text-2xl font-bold text-black">Users</h1>
            <p className="text-sm text-black mt-0.5">Manage portal users and their access levels</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-blue-900 hover:bg-blue-800 rounded-md transition">
          <UserPlus className="w-4 h-4" /> Create User
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-6 mb-5">
          <h3 className="text-sm font-bold text-black mb-4">Create New User</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Email</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} placeholder="user@company.com" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Full Name</label>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className={inputCls} placeholder="John Doe" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Password</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} placeholder="••••••••" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
                <option value="viewer">Viewer — Read only</option>
                <option value="editor">Editor — Can sync and manage</option>
                <option value="owner">Owner — Full access</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => createMutation.mutate()} className="px-4 py-2 text-sm font-bold text-white bg-blue-900 hover:bg-blue-800 rounded-md transition">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm font-bold text-black border border-gray-400 hover:bg-gray-100 rounded-md transition">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-300">
              {["User", "Role", "Status", "Actions"].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-black">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={4} className="text-center py-10">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin border-blue-900 mx-auto" />
              </td></tr>
            )}
            {users.map((u: any) => (
              <tr key={u.id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-900 flex items-center justify-center text-white text-xs font-bold">
                      {(u.full_name || u.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-black">{u.full_name || "—"}</div>
                      <div className="text-xs font-semibold text-black">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <select value={u.role} onChange={(e) => roleMutation.mutate({ id: u.id, role: e.target.value })}
                    className="border border-gray-400 rounded-md px-2 py-1 text-xs text-black bg-white focus:outline-none focus:border-blue-900">
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="owner">Owner</option>
                  </select>
                </td>
                <td className="px-5 py-3">
                  {u.is_approved
                    ? <span className="text-xs font-bold px-2 py-1 rounded bg-green-100 text-green-900 border border-green-300">Approved</span>
                    : <span className="text-xs font-bold px-2 py-1 rounded bg-yellow-100 text-yellow-900 border border-yellow-300">Pending</span>}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1">
                    {!u.is_approved && (
                      <button onClick={() => approveMutation.mutate(u.id)}
                        className="p-1.5 rounded hover:bg-green-100 hover:text-green-800 transition text-black" title="Approve">
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => { if (confirm("Delete this user?")) deleteMutation.mutate(u.id); }}
                      className="p-1.5 rounded hover:bg-red-100 hover:text-red-700 transition text-black" title="Delete">
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
  );
}
