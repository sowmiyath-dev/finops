"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import toast from "react-hot-toast";
import Navbar from "@/components/Navbar";
import { Copy, Info, ArrowLeft } from "lucide-react";

export default function OnboardPage() {
  const router = useRouter();
  const [method, setMethod] = useState<"keys" | "role">("keys");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "", management_account_name: "",
    access_key_id: "", secret_access_key: "", role_arn: "",
  });

  const { data: trustPolicy } = useQuery({
    queryKey: ["trust-policy"],
    queryFn: () => api.get("/towers/trust-policy").then((r) => r.data),
    enabled: method === "role",
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (method === "keys") {
        await api.post("/towers/onboard/keys", {
          name: form.name,
          management_account_name: form.management_account_name,
          access_key_id: form.access_key_id,
          secret_access_key: form.secret_access_key,
        });
      } else {
        await api.post("/towers/onboard/role", {
          name: form.name,
          management_account_name: form.management_account_name,
          role_arn: form.role_arn,
        });
      }
      toast.success("Control Tower onboarded! Cost sync started.");
      router.push("/dashboard");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Onboarding failed");
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#7c3aed] transition";

  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <div className="max-w-lg mx-auto px-6 py-12">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white transition text-sm mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <h1 className="text-2xl font-bold text-white mb-1">Add Control Tower</h1>
        <p className="text-slate-400 text-sm mb-8">
          Connect a management account to start syncing cost data from all sub-accounts.
        </p>

        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-8">
          {/* Method tabs */}
          <div className="flex rounded-lg bg-slate-900 p-1 mb-6">
            {(["keys", "role"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
                  method === m ? "bg-[#7c3aed] text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                {m === "keys" ? "Access Keys" : "IAM Role"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Control Tower Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className={inputCls}
                placeholder="e.g. Production CT"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Management Account Name</label>
              <input
                required
                value={form.management_account_name}
                onChange={(e) => set("management_account_name", e.target.value)}
                className={inputCls}
                placeholder="e.g. Master Billing Account"
              />
            </div>

            {method === "keys" ? (
              <>
                <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 flex gap-2 text-xs text-sky-300">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  Attach <strong>ReadOnlyAccess</strong> +{" "}
                  <strong>AWSCostExplorerReadOnlyAccess</strong> +{" "}
                  <strong>AWSOrganizationsReadOnlyAccess</strong> to this IAM user.
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Access Key ID</label>
                  <input
                    required
                    value={form.access_key_id}
                    onChange={(e) => set("access_key_id", e.target.value)}
                    className={`${inputCls} font-mono`}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Secret Access Key</label>
                  <input
                    required
                    type="password"
                    value={form.secret_access_key}
                    onChange={(e) => set("secret_access_key", e.target.value)}
                    className={`${inputCls} font-mono`}
                    placeholder="••••••••••••••••••••••••••••••••••••••••"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300 space-y-2">
                  <p className="flex items-center gap-1">
                    <Info className="w-4 h-4" /> Create an IAM role with{" "}
                    <strong>ReadOnlyAccess</strong> + Cost Explorer + Organizations and this trust
                    policy:
                  </p>
                  {trustPolicy && (
                    <div className="relative">
                      <pre className="bg-slate-900 rounded p-3 text-xs overflow-auto max-h-40 text-slate-300">
                        {JSON.stringify(trustPolicy, null, 2)}
                      </pre>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(trustPolicy, null, 2));
                          toast.success("Copied!");
                        }}
                        className="absolute top-2 right-2 p-1 hover:text-white text-slate-400"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Role ARN</label>
                  <input
                    required
                    value={form.role_arn}
                    onChange={(e) => set("role_arn", e.target.value)}
                    className={`${inputCls} font-mono`}
                    placeholder="arn:aws:iam::123456789012:role/FinOpsReadOnly"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-50 text-white rounded-lg font-semibold transition mt-2"
            >
              {loading ? "Connecting & syncing..." : "Connect Control Tower"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
