import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles, TrendingUp, Zap } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";

function FeedXLogo({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className="feedx-logo-mark">
        <span>F</span>
      </div>
      {!compact ? (
        <div>
          <div className="text-lg font-black tracking-tight text-white">FeedX</div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-200/70">F&amp;B Intelligence</div>
        </div>
      ) : null}
    </div>
  );
}

function ParticleField() {
  return (
    <div className="feedx-particles" aria-hidden="true">
      {Array.from({ length: 20 }, (_, index) => (
        <span
          key={index}
          style={{
            "--x": `${(index * 37) % 100}%`,
            "--y": `${(index * 53) % 100}%`,
            "--delay": `${(index % 7) * 0.55}s`,
            "--size": `${2 + (index % 3)}px`,
          }}
        />
      ))}
    </div>
  );
}

function DashboardVisual() {
  const kpis = [
    { label: "MTD Sales", value: "RM 128K", tone: "emerald" },
    { label: "COGS", value: "31.8%", tone: "cyan" },
    { label: "Alerts", value: "4", tone: "amber" },
  ];

  return (
    <div className="feedx-dashboard-visual">
      <div className="feedx-light-trail feedx-light-trail-a" />
      <div className="feedx-light-trail feedx-light-trail-b" />
      <div className="relative rounded-[28px] border border-emerald-300/14 bg-slate-950/78 p-4 shadow-[0_28px_90px_rgba(16,185,129,0.22)] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-200/60">HQ Overview</div>
            <div className="mt-1 text-lg font-bold text-white">Monthly Command Center</div>
          </div>
          <div className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-100">
            Live workspace
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          {kpis.map((item) => (
            <div key={item.label} className="feedx-kpi-mini">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.label}</div>
              <div className={`mt-2 text-lg font-black ${item.tone === "amber" ? "text-amber-200" : item.tone === "cyan" ? "text-cyan-200" : "text-emerald-200"}`}>{item.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-3xl border border-white/8 bg-white/[0.03] p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-bold text-white">Outlet Health</div>
            <TrendingUp size={16} className="text-emerald-300" />
          </div>
          <div className="space-y-3">
            {[
              ["Hola Hola", "Good", "82%"],
              ["Friends Corner", "Watch", "62%"],
              ["JYMT", "Good", "74%"],
            ].map(([outlet, status, width]) => (
              <div key={outlet}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">{outlet}</span>
                  <span className={status === "Watch" ? "text-amber-200" : "text-emerald-200"}>{status}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/8">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-300" style={{ width }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="feedx-map-nodes">
          <svg viewBox="0 0 420 92" role="img" aria-label="Outlet network visual">
            <path d="M46 54 C116 18, 160 76, 220 42 S332 22, 382 58" />
            {[46, 142, 220, 306, 382].map((x, index) => (
              <circle key={x} cx={x} cy={index % 2 ? 34 : 58} r="5" />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
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
      setError("Enter your email first, then request a password setup link.");
      return;
    }
    setError("");
    setMessage("");
    try {
      await auth.resetPassword(email);
      setMessage("Password setup email sent.");
    } catch (resetError) {
      setError(resetError.message || "Unable to send password setup email.");
    }
  }

  return (
    <main className="feedx-login-shell">
      <ParticleField />
      <div className="feedx-login-glow feedx-login-glow-a" />
      <div className="feedx-login-glow feedx-login-glow-b" />

      <div className="feedx-login-grid">
        <section className="feedx-brand-panel">
          <FeedXLogo />
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/16 bg-emerald-400/8 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100/80">
              <Sparkles size={13} />
              F&B Intelligence
            </div>
            <h1 className="mt-7 text-[clamp(44px,5vw,76px)] font-black leading-[0.94] tracking-tight text-white">
              Smart Operations.
              <span className="mt-2 block bg-gradient-to-r from-emerald-200 via-lime-100 to-white bg-clip-text text-transparent">Stronger Business.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">
              All your F&amp;B operations, analytics and insights in one intelligent workspace.
            </p>
          </div>
          <DashboardVisual />
        </section>

        <section className="feedx-auth-panel">
          <div className="feedx-auth-card">
            <div className="mb-8">
              <FeedXLogo />
            </div>

            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-200/60">Account Login</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white">Welcome back</h2>
              <p className="mt-2 text-sm font-medium text-slate-400">Sign in to your FeedX workspace</p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-xs font-bold text-slate-300">Email</span>
                <div className="feedx-login-input-wrap mt-2">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-200/50" size={17} />
                  <input
                    className="feedx-login-input pl-11"
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
                <span className="text-xs font-bold text-slate-300">Password</span>
                <div className="feedx-login-input-wrap mt-2">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-200/50" size={17} />
                  <input
                    className="feedx-login-input px-11"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/6 hover:text-emerald-100"
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                  <input
                    className="h-4 w-4 rounded border-emerald-300/30 bg-slate-950 text-emerald-400 focus:ring-emerald-400/20"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                  />
                  <span className="font-semibold">Remember me</span>
                </label>
                <button className="font-bold text-emerald-200 transition hover:text-white" type="button" onClick={handleResetPassword}>
                  Forgot password
                </button>
              </div>

              {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">{error}</div> : null}
              {message ? <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-100">{message}</div> : null}

              <button className="feedx-signin-button group" type="submit" disabled={isSubmitting}>
                <span>{isSubmitting ? "Signing in..." : "Sign in"}</span>
                <ArrowRight className="transition group-hover:translate-x-1" size={18} />
              </button>
            </form>

            <div className="mt-7 flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs font-semibold text-slate-400">
              <ShieldCheck size={16} className="text-emerald-300" />
              Secured by role-based access and outlet permissions.
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs font-semibold text-slate-500">
            <Zap size={14} className="text-emerald-300/70" />
            Monthly operations intelligence for modern F&amp;B teams
          </div>
        </section>
      </div>
    </main>
  );
}
