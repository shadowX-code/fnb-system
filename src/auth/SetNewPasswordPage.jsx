import { useState } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import { AuthBrandPanel, FeedXLogo, ParticleField } from "./LoginPage.jsx";

export default function SetNewPasswordPage() {
  const auth = useAuth();
  const isRecovery = auth.source === "password-recovery";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (password.length < 8) {
      setError("Use at least 8 characters for your new password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await auth.completePasswordSetup(password);
      setMessage(isRecovery ? "Password reset successfully." : "Password set successfully.");
    } catch (setupError) {
      setError(setupError.message || "Unable to update password. Please request a new link.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    setError("");
    setIsSubmitting(true);
    try {
      await auth.cancelPasswordSetup();
    } catch (cancelError) {
      setError(cancelError.message || "Unable to cancel password setup.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="feedx-login-shell">
      <ParticleField />
      <div className="feedx-login-glow feedx-login-glow-a" />
      <div className="feedx-login-glow feedx-login-glow-b" />

      <div className="feedx-login-grid">
        <AuthBrandPanel />

        <section className="feedx-auth-panel">
          <div className="feedx-auth-card">
            <div className="feedx-auth-card-logo mb-8">
              <FeedXLogo />
            </div>

            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700/70">
                {isRecovery ? "Password Reset" : "Secure Account Setup"}
              </div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                {isRecovery ? "Reset your password" : "Create your password"}
              </h2>
              <p className="mt-2 text-sm font-medium text-slate-500">
                {isRecovery
                  ? "Choose a new password before returning to your FeedX workspace."
                  : "Create your password to activate secure access to FeedX."}
              </p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-xs font-bold text-slate-700">New password</span>
                <div className="feedx-login-input-wrap mt-2">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-700/45" size={17} />
                  <input
                    className="feedx-login-input px-11"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-700"
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-bold text-slate-700">Confirm password</span>
                <div className="feedx-login-input-wrap mt-2">
                  <KeyRound className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-700/45" size={17} />
                  <input
                    className="feedx-login-input px-11"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-700"
                    type="button"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}
              {message ? (
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 size={16} /> {message}
                </div>
              ) : null}

              <button className="feedx-signin-button group" type="submit" disabled={isSubmitting}>
                <span>{isSubmitting ? "Saving password..." : isRecovery ? "Reset password" : "Save password"}</span>
                <ArrowRight className="transition group-hover:translate-x-1" size={18} />
              </button>
              <button className="w-full rounded-2xl px-3 py-2 text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800" type="button" onClick={handleCancel} disabled={isSubmitting}>
                Cancel and return to login
              </button>
            </form>

            <div className="mt-7 flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-xs font-semibold text-slate-600">
              <ShieldCheck size={16} className="text-emerald-600" />
              Password updates are protected by Supabase Auth
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
