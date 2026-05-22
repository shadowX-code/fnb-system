import { useState } from "react";
import { BarChart3, CheckCircle2, KeyRound, Lock } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";

export default function SetNewPasswordPage() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
      setMessage("Password set successfully.");
    } catch (setupError) {
      setError(setupError.message || "Unable to set up password. Please request a new setup link.");
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
    <div className="min-h-screen bg-app-bg px-4 py-8 text-text-primary">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-border bg-white shadow-sm lg:grid-cols-[1fr_430px]">
          <section className="hidden border-r border-border bg-slate-50 p-10 lg:block">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
                <BarChart3 size={20} />
              </div>
              <div>
                <div className="text-sm font-bold">FeedX</div>
                <div className="text-xs text-text-secondary">F&amp;B Intelligence</div>
              </div>
            </div>
            <div className="mt-16 max-w-xl">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Secure Account Setup</div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-text-primary">Set up your password before entering the workspace.</h1>
              <p className="mt-4 text-sm leading-6 text-text-secondary">
                This secure link verifies your account. Choose a new password to continue into FeedX.
              </p>
            </div>
          </section>

          <section className="p-6 sm:p-8">
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
                  <BarChart3 size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold">FeedX</div>
                  <div className="text-xs text-text-secondary">F&amp;B Intelligence</div>
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-text-secondary">Password Setup</div>
              <h2 className="mt-2 text-2xl font-bold text-text-primary">Create your password</h2>
              <p className="mt-2 text-sm text-text-secondary">Use a secure password for your company login.</p>
            </div>

            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-xs font-semibold text-text-secondary">New password</span>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                  <input
                    className="control h-11 w-full pl-10"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-text-secondary">Confirm password</span>
                <div className="relative mt-1">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                  <input
                    className="control h-11 w-full pl-10"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </label>

              {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
              {message ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 size={16} /> {message}
                </div>
              ) : null}

              <button className="btn-primary h-11 w-full justify-center" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving password..." : "Save password"}
              </button>
              <button className="w-full rounded-xl px-3 py-2 text-sm font-bold text-text-secondary transition hover:bg-slate-50" type="button" onClick={handleCancel} disabled={isSubmitting}>
                Cancel and return to login
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
