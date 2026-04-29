"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import toast from "react-hot-toast";
import Navbar from "@/components/Navbar";
import { Copy, Info, ArrowLeft, RefreshCw } from "lucide-react";

export default function OnboardPage() {
  const router = useRouter();
  const [method, setMethod] = useState<"keys" | "role">("keys");
  const [loading, setLoading] = useState(false);
  const [externalId, setExternalId] = useState("");
  const [form, setForm] = useState({
    name: "",
    management_account_name: "",
    access_key_id: "",
    secret_access_key: "",
    role_arn: "",
    external_id: "",
    cur_s3_bucket: "",
    cur_s3_prefix: "",
  });

  const { data: trustPolicy } = useQuery({
    queryKey: ["trust-policy"],
    queryFn: () => api.get("/towers/trust-policy").then((r) => r.data),
    enabled: method === "role",
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const generateExternalId = async () => {
    try {
      const { data } = await api.get("/towers/generate-external-id");
      setExternalId(data.external_id);
      set("external_id", data.external_id);
      toast.success("External ID generated! Copy it before deploying CFT.");
    } catch {
      toast.error("Failed to generate External ID");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (method === "role" && !form.external_id) {
      toast.error("Please generate an External ID first");
      return;
    }
    setLoading(true);
    try {
      if (method === "keys") {
        await api.post("/towers/onboard/keys", {
          name: form.name,
          management_account_name: form.management_account_name,
          access_key_id: form.access_key_id,
          secret_access_key: form.secret_access_key,
          cur_s3_bucket: form.cur_s3_bucket,
          cur_s3_prefix: form.cur_s3_prefix,
        });
      } else {
        await api.post("/towers/onboard/role", {
          name: form.name,
          management_account_name: form.management_account_name,
          role_arn: form.role_arn,
          external_id: form.external_id,
          cur_s3_bucket: form.cur_s3_bucket,
          cur_s3_prefix: form.cur_s3_prefix,
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
          Connect a management account to start syncing CUR cost data from all sub-accounts.
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
                {m === "keys" ? "Access Keys" : "IAM Role (Recommended)"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Common fields */}
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

            {/* Auth method specific fields */}
            {method === "keys" ? (
              <>
                <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 flex gap-2 text-xs text-sky-300">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  Attach <strong>AWSOrganizationsReadOnlyAccess</strong> + <strong>S3 CUR bucket read</strong> to this IAM user.
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
                {/* Step 1 — Generate External ID */}
                <div className="p-4 rounded-lg bg-[#7c3aed]/10 border border-[#7c3aed]/30 space-y-3">
                  <p className="text-xs font-semibold text-[#c084fc]">Step 1 — Generate External ID</p>
                  <p className="text-xs text-slate-400">
                    Generate an External ID first, then use it when deploying the CFT in your management account.
                  </p>
                  {externalId ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-2">
                        <code className="text-xs text-emerald-400 flex-1 font-mono break-all">{externalId}</code>
                        <button
                          type="button"
                          onClick={() => { navigator.clipboard.writeText(externalId); toast.success("Copied!"); }}
                          className="p-1 hover:text-white text-slate-400 flex-shrink-0"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-amber-400">⚠️ Use this in the CFT parameter <strong>ExternalId</strong></p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={generateExternalId}
                      className="flex items-center gap-2 px-4 py-2 bg-[#7c3aed] hover:bg-[#6d28d9] text-white rounded-lg text-sm font-semibold transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Generate External ID
                    </button>
                  )}
                </div>

                {/* Step 2 — Deploy CFT */}
                <div className="p-4 rounded-lg bg-slate-900/50 border border-slate-700 space-y-2">
                  <p className="text-xs font-semibold text-slate-300">Step 2 — Deploy CFT in Management Account</p>
                  <p className="text-xs text-slate-400">
                    Deploy <strong className="text-white">finops-management-account-role.json</strong> in your management account with:
                  </p>
                  <ul className="text-xs text-slate-400 space-y-1 ml-3">
                    <li>• <strong className="text-white">FinOpsHostAccountId:</strong> {trustPolicy ? JSON.stringify(trustPolicy).match(/iam::([0-9]+)/)?.[1] : "your portal account ID"}</li>
                    <li>• <strong className="text-white">CURBucketName:</strong> your CUR S3 bucket name</li>
                    <li>• <strong className="text-white">ExternalId:</strong> the External ID generated above</li>
                  </ul>
                  <p className="text-xs text-slate-500 mt-1">After deployment, copy the <strong className="text-white">RoleARN</strong> from CFT Outputs tab.</p>
                </div>

                {/* Step 3 — Enter Role ARN */}
                <div className="p-4 rounded-lg bg-slate-900/50 border border-slate-700 space-y-3">
                  <p className="text-xs font-semibold text-slate-300">Step 3 — Enter Role Details</p>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Role ARN</label>
                    <input
                      required
                      value={form.role_arn}
                      onChange={(e) => set("role_arn", e.target.value)}
                      className={`${inputCls} font-mono`}
                      placeholder="arn:aws:iam::123456789012:role/FinOpsCURPortal-CrossAcctRole"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">External ID</label>
                    <input
                      required
                      value={form.external_id}
                      onChange={(e) => set("external_id", e.target.value)}
                      className={`${inputCls} font-mono`}
                      placeholder="paste the generated external ID"
                    />
                  </div>
                </div>
              </>
            )}

            {/* CUR S3 fields — shown for both methods */}
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-3">
              <p className="text-xs font-semibold text-emerald-400">CUR S3 Configuration</p>
              <p className="text-xs text-slate-400">
                Enter the S3 bucket and path prefix where CUR reports are stored in this management account.
              </p>
              <div>
                <label className="block text-sm text-slate-400 mb-1">CUR S3 Bucket Name</label>
                <input
                  required
                  value={form.cur_s3_bucket}
                  onChange={(e) => set("cur_s3_bucket", e.target.value)}
                  className={inputCls}
                  placeholder="e.g. rilcurmall"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">CUR S3 Path Prefix</label>
                <input
                  required
                  value={form.cur_s3_prefix}
                  onChange={(e) => set("cur_s3_prefix", e.target.value)}
                  className={inputCls}
                  placeholder="e.g. rilcurmall/rilcurmall26NN"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Found in S3 → bucket → folder path before the billing period folder (e.g. 20260401-20260501)
                </p>
              </div>
            </div>

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
