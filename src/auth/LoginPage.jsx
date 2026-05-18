import { useState } from "react";
import { BarChart3, Lock, Mail } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";

export default function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setMessage("");
    try {
      await auth.signIn(email, password);
    } catch (signInError) {
      setError(signInError.message || "Unable to login. Please check your email and password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword() {
    if (!email) {
      setError("Enter your email first, then request a password reset.");
      return;
    }
    setError("");
    setMessage("");
    try {
      await auth.resetPassword(email);
      setMessage("Password reset email sent.");
    } catch (resetError) {
      setError(resetError.message || "Unable to send password reset email.");
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
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Smart Operations Workspace</div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-text-primary">Login to manage AI-enabled F&amp;B intelligence workflows.</h1>
              <p className="mt-4 text-sm leading-6 text-text-secondary">
                Access is controlled through role-based permissions. During alpha, admins can issue temporary passwords before production invitation email is configured.
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
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-text-secondary">Account Login</div>
              <h2 className="mt-2 text-2xl font-bold text-text-primary">Welcome back</h2>
              <p className="mt-2 text-sm text-text-secondary">Use your company email and password to continue.</p>
            </div>

            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-xs font-semibold text-text-secondary">Email</span>
                <div className="relative mt-1">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                  <input
                    className="control h-11 w-full pl-10"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-text-secondary">Password</span>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                  <input
                    className="control h-11 w-full pl-10"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </label>

              {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
              {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{message}</div> : null}

              <button className="btn-primary h-11 w-full justify-center" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Signing in..." : "Login"}
              </button>
              <button className="w-full rounded-xl px-3 py-2 text-sm font-bold text-text-secondary transition hover:bg-slate-50" type="button" onClick={handleResetPassword}>
                Send password reset email
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
