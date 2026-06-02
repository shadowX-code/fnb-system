import { useState } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import { AuthBrandPanel, HolographicRing, ParticleField } from "./LoginPage.jsx";

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
        <HolographicRing />

        <section className="feedx-auth-panel">
          <div className="feedx-auth-card">
            <div>
              <div className="feedx-auth-eyebrow">
                {isRecovery ? "Password Reset" : "Secure Account Setup"}
              </div>
              <h2 className="feedx-auth-title mt-3">
                {isRecovery ? "Reset your password" : "Create your password"}
              </h2>
              <p className="feedx-auth-subtitle">
                {isRecovery
                  ? "Choose a new password before returning to your FeedX workspace."
                  : "Create your password to activate secure access to FeedX."}
              </p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="feedx-auth-label">New password</span>
                <div className="feedx-login-input-wrap mt-2">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-200/55" size={17} />
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
                    className="feedx-password-toggle"
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="feedx-auth-label">Confirm password</span>
                <div className="feedx-login-input-wrap mt-2">
                  <KeyRound className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-200/55" size={17} />
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
                    className="feedx-password-toggle"
                    type="button"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              {error ? <div className="feedx-auth-alert feedx-auth-alert-error">{error}</div> : null}
              {message ? (
                <div className="feedx-auth-alert feedx-auth-alert-success flex items-center gap-2">
                  <CheckCircle2 size={16} /> {message}
                </div>
              ) : null}

              <button className="feedx-signin-button group" type="submit" disabled={isSubmitting}>
                <span>{isSubmitting ? "Saving password..." : isRecovery ? "Reset password" : "Save password"}</span>
                <ArrowRight className="transition group-hover:translate-x-1" size={18} />
              </button>
              <button className="feedx-cancel-button" type="button" onClick={handleCancel} disabled={isSubmitting}>
                Cancel and return to login
              </button>
            </form>

            <div className="feedx-security-note">
              <ShieldCheck size={16} />
              Password updates are protected by Supabase Auth
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
