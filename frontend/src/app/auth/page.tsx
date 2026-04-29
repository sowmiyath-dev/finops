"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { DollarSign } from "lucide-react";

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

  useEffect(() => { if (token) router.push("/dashboard"); }, [token]);

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
      router.push("/dashboard");
    } catch (err: any) { toast.error(err.response?.data?.detail || "Invalid code"); }
    finally { setLoading(false); }
  };

  const handleMFAValidate = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const { data } = await api.post("/auth/mfa/validate", { temp_token: tempToken, code });
      await setAuth(data.access_token);
      router.push("/dashboard");
    } catch (err: any) { toast.error(err.response?.data?.detail || "Invalid code"); }
    finally { setLoading(false); }
  };

  const inputCls = "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#7c3aed] transition";

  return (
    <div className="min-h-screen bg-[#080d1a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7c3aed] to-[#06b6d4] mb-4">
            <DollarSign className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white"><span className="text-[#22d3ee]">FinOps</span> CUR Portal</h1>
          <p className="text-slate-400 mt-1 text-sm">AWS Control Tower Cost Management</p>
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-8">

          {step === "credentials" && (
            <>
              <div className="flex rounded-lg bg-slate-900 p-1 mb-6">
                {(["login", "signup"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition ${mode === m ? "bg-[#7c3aed] text-white" : "text-slate-400 hover:text-white"}`}>
                    {m === "login" ? "Sign In" : "Sign Up"}
                  </button>
                ))}
              </div>
              <form onSubmit={handleCredentials} className="space-y-4">
                {mode === "signup" && (
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Full Name</label>
                    <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} placeholder="John Doe" />
                  </div>
                )}
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Email</label>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@company.com" />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Password</label>
                  <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full py-2.5 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-50 text-white rounded-lg font-semibold transition mt-2">
                  {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
                </button>
              </form>
            </>
          )}

          {step === "mfa_setup" && (
            <form onSubmit={handleMFASetup} className="space-y-5">
              <div className="text-center">
                <p className="text-xs text-slate-400 mb-4">Scan with <strong className="text-white">Google Authenticator</strong> or any TOTP app</p>
                {qrBase64 && (
                  <div className="inline-block p-3 bg-white rounded-xl mb-4">
                    <img src={`data:image/png;base64,${qrBase64}`} alt="MFA QR" className="w-48 h-48" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Verification Code</label>
                <input type="text" required maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className={`${inputCls} text-center tracking-[0.5em] font-mono`} placeholder="000000" autoFocus />
              </div>
              <button type="submit" disabled={loading || code.length !== 6}
                className="w-full py-2.5 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-50 text-white rounded-lg font-semibold transition">
                {loading ? "Verifying..." : "Activate & Sign In"}
              </button>
              <button type="button" onClick={() => { setStep("credentials"); setCode(""); }}
                className="w-full py-2 text-sm text-slate-500 hover:text-slate-300 transition">← Back</button>
            </form>
          )}

          {step === "mfa_validate" && (
            <form onSubmit={handleMFAValidate} className="space-y-5">
              <p className="text-xs text-slate-400 text-center">Enter the 6-digit code from your authenticator app</p>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Authenticator Code</label>
                <input type="text" required maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className={`${inputCls} text-center tracking-[0.5em] font-mono`} placeholder="000000" autoFocus />
              </div>
              <button type="submit" disabled={loading || code.length !== 6}
                className="w-full py-2.5 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-50 text-white rounded-lg font-semibold transition">
                {loading ? "Verifying..." : "Verify & Sign In"}
              </button>
              <button type="button" onClick={() => { setStep("credentials"); setCode(""); }}
                className="w-full py-2 text-sm text-slate-500 hover:text-slate-300 transition">← Back</button>
            </form>
          )}

          {step === "pending" && (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 mb-2">
                <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">Approval Pending</h2>
              <p className="text-sm text-slate-400">Your account is awaiting admin approval.</p>
              <button onClick={() => { setStep("credentials"); setEmail(""); setPassword(""); }}
                className="w-full py-2 text-sm text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg transition">
                ← Back to Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#080d1a] flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin" /></div>}>
      <AuthForm />
    </Suspense>
  );
}
