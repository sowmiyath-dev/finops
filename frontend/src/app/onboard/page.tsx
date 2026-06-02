"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Copy, Info, ArrowLeft, RefreshCw, Cloud } from "lucide-react";

export default function OnboardPage() {
  const router = useRouter();
  const [method, setMethod] = useState<"keys" | "role">("keys");
  const [loading, setLoading] = useState(false);
  const [externalId, setExternalId] = useState("");
  const [form, setForm] = useState({
    name: "", management_account_name: "",
    access_key_id: "", secret_access_key: "",
    role_arn: "", external_id: "",
    cur_s3_bucket: "", cur_s3_prefix: "",
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
      toast.success("External ID generated!");
    } catch { toast.error("Failed to generate External ID"); }
  };

  const handleAwsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (method === "role" && !form.external_id) {
      toast.error("Please generate an External ID first");
      return;
    }
    setLoading(true);
    try {
      if (method === "keys") {
        await api.post("/towers/onboard/keys", {
          name: form.name, management_account_name: form.management_account_name,
          access_key_id: form.access_key_id, secret_access_key: form.secret_access_key,
          cur_s3_bucket: form.cur_s3_bucket, cur_s3_prefix: form.cur_s3_prefix,
        });
      } else {
        await api.post("/towers/onboard/role", {
          name: form.name, management_account_name: form.management_account_name,
          role_arn: form.role_arn, external_id: form.external_id,
          cur_s3_bucket: form.cur_s3_bucket, cur_s3_prefix: form.cur_s3_prefix,
        });
      }
      toast.success("AWS Control Tower onboarded! Cost sync started.");
      router.push("/dashboard");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Onboarding failed");
    } finally { setLoading(false); }
  };

  const inputCls = "w-full border rounded-md px-3 py-2.5 text-sm focus:outline-none transition bg-white border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  const labelCls = "block text-sm font-medium mb-1.5";

  return (
    <div className="p-6">
      <div className="max-w-lg mx-auto px-6 py-10">
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm mb-6 transition"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}>
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-center gap-3 mb-6">
          <Cloud className="w-6 h-6" style={{ color: "#FF9900" }} />
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>Add AWS Control Tower</h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Connect an AWS account to start syncing cost data.
            </p>
          </div>
        </div>

        <div className="card p-8">
          {/* AWS Method tabs */}
          <div className="flex rounded-lg p-1 mb-6" style={{ background: "#f1f4f9" }}>
            {(["keys", "role"] as const).map((m) => (
              <button key={m} onClick={() => setMethod(m)}
                className="flex-1 py-2 text-sm font-semibold rounded-md transition"
                style={{
                  background: method === m ? "white" : "transparent",
                  color: method === m ? "var(--text-primary)" : "var(--text-secondary)",
                  boxShadow: method === m ? "var(--shadow-sm)" : "none",
                }}>
                {m === "keys" ? "Access Keys" : "IAM Role (Recommended)"}
              </button>
            ))}
          </div>

          <form onSubmit={handleAwsSubmit} className="space-y-4">
            <div>
              <label className={labelCls} style={{ color: "var(--text-primary)" }}>Control Tower Name</label>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)}
                className={inputCls} placeholder="e.g. Production CT"
                style={{ color: "var(--text-primary)" }} />
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--text-primary)" }}>Management Account Name</label>
              <input required value={form.management_account_name} onChange={(e) => set("management_account_name", e.target.value)}
                className={inputCls} placeholder="e.g. Master Billing Account"
                style={{ color: "var(--text-primary)" }} />
            </div>

            {method === "keys" ? (
              <>
                <div className="p-3 rounded-lg flex gap-2 text-sm" style={{ background: "var(--info-bg)", border: "1px solid var(--info-border)", color: "var(--info)" }}>
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Attach <strong>AWSOrganizationsReadOnlyAccess</strong> + <strong>S3 CUR bucket read</strong> to this IAM user.</span>
                </div>
                <div>
                  <label className={labelCls} style={{ color: "var(--text-primary)" }}>Access Key ID</label>
                  <input required value={form.access_key_id} onChange={(e) => set("access_key_id", e.target.value)}
                    className={`${inputCls} font-mono`} placeholder="AKIAIOSFODNN7EXAMPLE"
                    style={{ color: "var(--text-primary)" }} />
                </div>
                <div>
                  <label className={labelCls} style={{ color: "var(--text-primary)" }}>Secret Access Key</label>
                  <input required type="password" value={form.secret_access_key} onChange={(e) => set("secret_access_key", e.target.value)}
                    className={`${inputCls} font-mono`} placeholder="••••••••••••••••••••••••••••••••••••••••"
                    style={{ color: "var(--text-primary)" }} />
                </div>
              </>
            ) : (
              <>
                <div className="p-4 rounded-lg space-y-3" style={{ background: "#e8f0fe", border: "1px solid #c5d5f0" }}>
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--primary)" }}>Step 1 — Generate External ID</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    Generate an External ID first, then use it when deploying the CFT in your management account.
                  </p>
                  {externalId ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-md px-3 py-2"
                        style={{ background: "white", border: "1px solid var(--border)" }}>
                        <code className="text-xs flex-1 font-mono break-all" style={{ color: "var(--success)" }}>{externalId}</code>
                        <button type="button" onClick={() => { navigator.clipboard.writeText(externalId); toast.success("Copied!"); }}
                          className="p-1 transition flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs font-medium" style={{ color: "var(--warning)" }}>
                        ⚠️ Use this in the CFT parameter <strong>ExternalId</strong>
                      </p>
                    </div>
                  ) : (
                    <button type="button" onClick={generateExternalId}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-md transition"
                      style={{ background: "var(--primary)" }}>
                      <RefreshCw className="w-3.5 h-3.5" /> Generate External ID
                    </button>
                  )}
                </div>

                <div className="p-4 rounded-lg space-y-2" style={{ background: "#fafbfc", border: "1px solid var(--border)" }}>
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-primary)" }}>Step 2 — Deploy CFT</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    Deploy <strong>finops-management-account-role.json</strong> with the External ID above.
                  </p>
                </div>

                <div className="p-4 rounded-lg space-y-3" style={{ background: "#fafbfc", border: "1px solid var(--border)" }}>
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-primary)" }}>Step 3 — Enter Role Details</p>
                  <div>
                    <label className={labelCls} style={{ color: "var(--text-primary)" }}>Role ARN</label>
                    <input required value={form.role_arn} onChange={(e) => set("role_arn", e.target.value)}
                      className={`${inputCls} font-mono`} placeholder="arn:aws:iam::123456789012:role/FinOpsCURPortal-CrossAcctRole"
                      style={{ color: "var(--text-primary)" }} />
                  </div>
                  <div>
                    <label className={labelCls} style={{ color: "var(--text-primary)" }}>External ID</label>
                    <input required value={form.external_id} onChange={(e) => set("external_id", e.target.value)}
                      className={`${inputCls} font-mono`} placeholder="paste the generated external ID"
                      style={{ color: "var(--text-primary)" }} />
                  </div>
                </div>
              </>
            )}

            {/* CUR S3 fields */}
            <div className="p-4 rounded-lg space-y-3" style={{ background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--success)" }}>CUR S3 Configuration</p>
              <div>
                <label className={labelCls} style={{ color: "var(--text-primary)" }}>CUR S3 Bucket Name</label>
                <input required value={form.cur_s3_bucket} onChange={(e) => set("cur_s3_bucket", e.target.value)}
                  className={inputCls} placeholder="e.g. rilcurmall"
                  style={{ color: "var(--text-primary)" }} />
              </div>
              <div>
                <label className={labelCls} style={{ color: "var(--text-primary)" }}>CUR S3 Path Prefix</label>
                <input required value={form.cur_s3_prefix} onChange={(e) => set("cur_s3_prefix", e.target.value)}
                  className={inputCls} placeholder="e.g. rilcurmall/rilcurmall26NN"
                  style={{ color: "var(--text-primary)" }} />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-2.5 text-sm font-semibold text-white rounded-md transition disabled:opacity-50 mt-2"
              style={{ background: loading ? "#6b7280" : "#FF9900" }}>
              {loading ? "Connecting & syncing..." : "Connect AWS Control Tower"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
