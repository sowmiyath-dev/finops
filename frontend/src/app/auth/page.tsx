"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { DollarSign, TrendingDown } from "lucide-react";

function AuthForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">(params.get("mode") === "signup" ? "signup" : "login");
  const [step, setStep] = useState<"credentials" | "mfa_setup" | "mfa_validate" | "pending">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [qrBase64, setQrBase64] = useState("");
  const [loading, setLoading] = useState(false);
  const { setAuth, token } = useAuthStore();
  const router = useRouter();

  useEffect(() => { if (token) router.push("/org"); }, [token]);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        await api.post("/auth/signup", { email, password, full_name: fullName });
        toast.success("Account created! Awaiting admin approval.");
        setMode("login");
        return;
      }
      const { data } = await api.post("/auth/login", { email, password });
      setTempToken(data.temp_token);
      if (data.status === "mfa_setup") {
        const qr = await api.get(`/auth/mfa/qr?temp_token=${data.temp_token}`);
        setQrBase64(qr.data.qr_base64);
        setStep("mfa_setup");
      } else {
        setStep("mfa_validate");
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (detail === "pending_approval") { setStep("pending"); }
      else toast.error(detail || "Invalid credentials");
    } finally { setLoading(false); }
  };

  const handleMFASetup = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const { data } = await api.post(`/auth/mfa/confirm?temp_token=${tempToken}`, { code });
      await setAuth(data.access_token);
      router.push("/org");
    } catch (err: any) { toast.error(err.response?.data?.detail || "Invalid code"); }
    finally { setLoading(false); }
  };

  const handleMFAValidate = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const { data } = await api.post("/auth/mfa/validate", { temp_token: tempToken, code });
      await setAuth(data.access_token);
      router.push("/org");
    } catch (err: any) { toast.error(err.response?.data?.detail || "Invalid code"); }
    finally { setLoading(false); }
  };

  const inputCls = "w-full border rounded-md px-3 py-2.5 text-sm focus:outline-none transition"
    + " bg-white text-gray-900 border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

  return (
    <div className="min-h-screen flex" style={{ background: "#f1f4f9" }}>
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: "var(--bg-nav)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "var(--accent)" }}>
            <DollarSign className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-bold text-xl">Finoptix</span>
        </div>

        <div>
          <h1 className="text-4xl font-bold text-white mb-4 leading-tight">
            Multi-Cloud Cost Intelligence<br />
            <span style={{ color: "var(--accent)" }}>at your fingertips</span>
          </h1>
          <p className="text-white/70 text-base mb-8">
            Centralized cost visibility across AWS, Azure, and Google Cloud.
            Track spending by project, team, or application — all from one platform.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Cloud Providers", value: "AWS · Azure · GCP" },
              { label: "Cost Granularity", value: "Daily" },
              { label: "Group By", value: "Project / Team" },
              { label: "Export Format", value: "CSV" },
            ].map((item) => (
              <div key={item.label} className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-lg font-bold text-white">{item.value}</div>
                <div className="text-sm text-white/60">{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/40 text-xs">
          © 2026 Finoptix. Multi-Cloud FinOps Platform.
        </p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">

          {/* Mobile brand */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "var(--bg-nav)" }}>
              <DollarSign className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg" style={{ color: "var(--primary)" }}>Finoptix</span>
          </div>

          <div className="bg-white rounded-xl border p-8" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-lg)" }}>

            {step === "credentials" && (
              <>
                <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
                  {mode === "login" ? "Sign in to your account" : "Create an account"}
                </h2>
                <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
                  {mode === "login" ? "Enter your credentials to continue" : "Fill in the details below"}
                </p>

                {/* Tabs */}
                <div className="flex rounded-lg p-1 mb-6" style={{ background: "#f1f4f9" }}>
                  {(["login", "signup"] as const).map((m) => (
                    <button key={m} onClick={() => setMode(m)}
                      className={`flex-1 py-2 text-sm font-semibold rounded-md transition ${
                        mode === m ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                      }`}>
                      {m === "login" ? "Sign In" : "Sign Up"}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleCredentials} className="space-y-4">
                  {mode === "signup" && (
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>Full Name</label>
                      <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} placeholder="John Doe" />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>Email address</label>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@company.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>Password</label>
                    <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
                  </div>
                  <button type="submit" disabled={loading}
                    className="w-full py-2.5 text-sm font-semibold text-white rounded-md transition disabled:opacity-50 mt-2"
                    style={{ background: loading ? "#6b7280" : "var(--primary)" }}>
                    {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
                  </button>
                </form>
              </>
            )}

            {step === "mfa_setup" && (
              <form onSubmit={handleMFASetup} className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Set up two-factor authentication</h2>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    Scan the QR code with <strong>Google Authenticator</strong> or any TOTP app
                  </p>
                </div>
                {qrBase64 && (
                  <div className="flex justify-center">
                    <div className="p-3 bg-white border rounded-xl" style={{ borderColor: "var(--border)" }}>
                      <img src={`data:image/png;base64,${qrBase64}`} alt="MFA QR" className="w-48 h-48" />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>Verification Code</label>
                  <input type="text" required maxLength={6} value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className={`${inputCls} text-center tracking-[0.5em] font-mono text-lg`}
                    placeholder="000000" autoFocus />
                </div>
                <button type="submit" disabled={loading || code.length !== 6}
                  className="w-full py-2.5 text-sm font-semibold text-white rounded-md transition disabled:opacity-50"
                  style={{ background: "var(--primary)" }}>
                  {loading ? "Verifying..." : "Activate & Sign In"}
                </button>
                <button type="button" onClick={() => { setStep("credentials"); setCode(""); }}
                  className="w-full py-2 text-sm transition" style={{ color: "var(--text-secondary)" }}>← Back</button>
              </form>
            )}

            {step === "mfa_validate" && (
              <form onSubmit={handleMFAValidate} className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Two-factor authentication</h2>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    Enter the 6-digit code from your authenticator app
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>Authenticator Code</label>
                  <input type="text" required maxLength={6} value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className={`${inputCls} text-center tracking-[0.5em] font-mono text-lg`}
                    placeholder="000000" autoFocus />
                </div>
                <button type="submit" disabled={loading || code.length !== 6}
                  className="w-full py-2.5 text-sm font-semibold text-white rounded-md transition disabled:opacity-50"
                  style={{ background: "var(--primary)" }}>
                  {loading ? "Verifying..." : "Verify & Sign In"}
                </button>
                <button type="button" onClick={() => { setStep("credentials"); setCode(""); }}
                  className="w-full py-2 text-sm transition" style={{ color: "var(--text-secondary)" }}>← Back</button>
              </form>
            )}

            {step === "pending" && (
              <div className="text-center space-y-4">
                <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                  style={{ background: "var(--warning-bg)" }}>
                  <svg className="w-7 h-7" style={{ color: "var(--warning)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Approval Pending</h2>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  Your account is awaiting admin approval. You will be notified once approved.
                </p>
                <button onClick={() => { setStep("credentials"); setEmail(""); setPassword(""); }}
                  className="w-full py-2.5 text-sm font-medium rounded-md border transition"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                  ← Back to Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f1f4f9" }}>
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
      </div>
    }>
      <AuthForm />
    </Suspense>
  );
}
