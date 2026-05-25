import { useState } from "react";
import { ArrowRight, BarChart3, Bell, Box, BriefcaseBusiness, Eye, EyeOff, Home, Lock, Mail, Settings, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";

function FeedXLogo({ size = "lg" }) {
  return (
    <div className={`feedx-logo ${size === "xl" ? "feedx-logo-xl" : ""}`}>
      <div className="feedx-logo-mark">
        <span className="feedx-logo-bar feedx-logo-bar-top" />
        <span className="feedx-logo-bar feedx-logo-bar-mid" />
        <span className="feedx-logo-dot" />
      </div>
      <div>
        <div className="feedx-logo-title">FeedX</div>
        <div className="feedx-logo-tagline">F&amp;B Intelligence</div>
      </div>
    </div>
  );
}

function FeatureList() {
  const items = [
    { icon: BarChart3, title: "Real-time Intelligence", text: "See what matters, instantly" },
    { icon: Box, title: "Multi-Outlet Control", text: "Manage all outlets with ease" },
    { icon: Bell, title: "Smart Alerts", text: "AI-powered alerts and recommendations" },
    { icon: Users, title: "Team & Operations", text: "Roster, tasks, assets, and more" },
  ];
  return (
    <div className="feedx-feature-list">
      {items.map(({ icon: Icon, title, text }) => (
        <div key={title} className="feedx-feature-item">
          <span className="feedx-feature-icon"><Icon size={22} /></span>
          <div>
            <div className="feedx-feature-title">{title}</div>
            <div className="feedx-feature-text">{text}</div>
          </div>
        </div>
      ))}
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
    { label: "MTD Sales", value: "RM 147,210", trend: "+12.6%" },
    { label: "COGS %", value: "32.6%", trend: "+1.8pp" },
    { label: "Gross Profit", value: "RM 97,360", trend: "+12.1%" },
  ];
  const sideIcons = [Home, BarChart3, BriefcaseBusiness, Box, Bell, Users, Settings];

  return (
    <div className="feedx-dashboard-visual">
      <div className="feedx-light-trail feedx-light-trail-a" />
      <div className="feedx-light-trail feedx-light-trail-b" />
      <div className="feedx-dashboard-card">
        <aside className="feedx-dashboard-sidebar">
          <FeedXMiniMark />
          {sideIcons.map((Icon, index) => (
            <span key={index} className={index === 0 ? "active" : ""}><Icon size={16} /></span>
          ))}
        </aside>
        <div className="feedx-dashboard-main">
          <div className="flex items-center justify-between">
            <div className="text-lg font-bold text-white">Overview</div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-1.5 text-[11px] font-bold text-slate-300">Last 6 Months</div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {kpis.map((item) => (
              <div key={item.label} className="feedx-kpi-mini">
                <div className="text-[10px] font-bold text-slate-400">{item.label}</div>
                <div className="mt-2 text-lg font-black text-white">{item.value}</div>
                <div className="mt-1 text-[10px] font-black text-emerald-300">{item.trend} <span className="text-slate-500">vs Apr 2026</span></div>
              </div>
            ))}
          </div>

          <div className="feedx-chart-panel">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-bold text-white">Sales vs Purchase (Monthly)</div>
              <div className="flex gap-3 text-[10px] font-bold text-slate-400">
                <span className="inline-flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-emerald-400" /> Sales</span>
                <span className="inline-flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-blue-500" /> Purchase</span>
              </div>
            </div>
            <svg viewBox="0 0 520 210" className="feedx-chart-svg" role="img" aria-label="Monthly sales and purchase chart">
              {[30, 72, 114, 156].map((y) => <line key={y} x1="54" x2="500" y1={y} y2={y} />)}
              {["RM 200K", "RM 150K", "RM 100K", "RM 50K"].map((label, index) => <text key={label} x="8" y={36 + index * 42}>{label}</text>)}
              {["Dec", "Jan", "Feb", "Mar", "Apr", "May"].map((label, index) => <text key={label} x={70 + index * 82} y="194">{label}</text>)}
              <polyline className="sales-line" points="70,142 152,100 234,90 316,70 398,76 480,42" />
              <polyline className="purchase-line" points="70,166 152,136 234,118 316,96 398,108 480,72" />
              {[70, 152, 234, 316, 398, 480].map((x, index) => <circle key={`s-${x}`} className="sales-dot" cx={x} cy={[142, 100, 90, 70, 76, 42][index]} r="4" />)}
              {[70, 152, 234, 316, 398, 480].map((x, index) => <circle key={`p-${x}`} className="purchase-dot" cx={x} cy={[166, 136, 118, 96, 108, 72][index]} r="4" />)}
            </svg>
          </div>

          <div className="feedx-outlet-panel">
            <div className="mb-3 text-sm font-bold text-white">Top Outlets by Sales</div>
            {[
              ["Friends Corner", "RM 52,300", "82%"],
              ["Hola Hola", "RM 38,900", "68%"],
              ["JYMT", "RM 21,560", "44%"],
              ["Happiness", "RM 34,450", "57%"],
            ].map(([outlet, value, width]) => (
              <div key={outlet} className="feedx-outlet-row">
                <span>{outlet}</span>
                <div><i style={{ width }} /></div>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedXMiniMark() {
  return (
    <span className="feedx-mini-mark">
      <i />
      <i />
      <i />
    </span>
  );
}

function OutletNodeMap() {
  return (
    <div className="feedx-city-map" aria-hidden="true">
      <svg viewBox="0 0 940 250">
        <defs>
          <linearGradient id="feedx-city-line" x1="0" x2="1">
            <stop offset="0" stopColor="#22c55e" stopOpacity="0.18" />
            <stop offset="0.5" stopColor="#86efac" stopOpacity="0.55" />
            <stop offset="1" stopColor="#22c55e" stopOpacity="0.18" />
          </linearGradient>
        </defs>
        <path d="M110 166 C260 98, 392 190, 520 132 S748 108, 846 160" />
        {[
          [110, 166, 0],
          [296, 118, 1],
          [520, 132, 2],
          [770, 146, 3],
          [846, 160, 4],
        ].map(([x, y, index]) => (
          <g key={index} className="feedx-city-node" style={{ "--delay": `${index * 0.35}s` }}>
            <rect x={x - 38} y={y + 26} width="76" height="38" rx="4" />
            <rect x={x - 24} y={y + 7} width="48" height="57" rx="4" />
            <path d={`M${x} ${y - 18} C${x - 16} ${y - 18}, ${x - 16} ${y + 4}, ${x} ${y + 18} C${x + 16} ${y + 4}, ${x + 16} ${y - 18}, ${x} ${y - 18}Z`} />
            <circle cx={x} cy={y - 5} r="5" />
          </g>
        ))}
      </svg>
    </div>
  );
}

function StatsStrip() {
  const stats = [
    { icon: ShieldCheck, value: "100%", label: "Secure" },
    { icon: Users, value: "5+", label: "Outlets" },
    { icon: Settings, value: "98%", label: "Data Accuracy" },
    { icon: Bell, value: "24/7", label: "Monitoring" },
  ];
  return (
    <div className="feedx-stats-strip">
      {stats.map(({ icon: Icon, value, label }) => (
        <div key={label} className="feedx-stat-item">
          <span><Icon size={18} /></span>
          <div>
            <strong>{value}</strong>
            <small>{label}</small>
          </div>
        </div>
      ))}
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
          <FeedXLogo size="xl" />
          <div className="max-w-xl">
            <h1 className="mt-7 text-[clamp(44px,5vw,76px)] font-black leading-[0.94] tracking-tight text-white">
              Smart Operations.
              <span className="mt-2 block bg-gradient-to-r from-emerald-200 via-lime-100 to-white bg-clip-text text-transparent">Stronger Business.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">
              All your F&amp;B operations, analytics and insights in one intelligent workspace.
            </p>
          </div>
          <FeatureList />
          <DashboardVisual />
          <OutletNodeMap />
          <StatsStrip />
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
                  Forgot password?
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
              Your data is encrypted and secure
            </div>
          </div>
        </section>
      </div>
      <footer className="feedx-login-footer">
        <span>© 2026 FeedX. All rights reserved.</span>
        <a href="#privacy">Privacy Policy</a>
        <i />
        <a href="#terms">Terms of Service</a>
      </footer>
    </main>
  );
}
