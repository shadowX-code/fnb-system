import { useState } from "react";
import { ArrowRight, BarChart3, Bell, Box, Eye, EyeOff, Lock, Mail, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";

export function FeedXLogo({ size = "lg" }) {
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

export function ParticleField() {
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

export function HolographicRing() {
  return (
    <div className="feedx-hologram" aria-hidden="true">
      <div className="feedx-hologram-orbit feedx-hologram-orbit-a" />
      <div className="feedx-hologram-orbit feedx-hologram-orbit-b" />
      <div className="feedx-hologram-orbit feedx-hologram-orbit-c" />
      <div className="feedx-hologram-ring">
        {Array.from({ length: 24 }, (_, index) => <span key={index} style={{ "--index": index }} />)}
      </div>
      <div className="feedx-hologram-core">
        <span>F</span>
        <span>E</span>
        <span>E</span>
        <span>D</span>
        <span>X</span>
      </div>
      <svg className="feedx-hologram-lines" viewBox="0 0 620 620">
        <defs>
          <radialGradient id="feedx-holo-dot" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#bbf7d0" stopOpacity="1" />
            <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
          </radialGradient>
        </defs>
        {Array.from({ length: 9 }, (_, index) => (
          <circle key={index} cx="310" cy="310" r={92 + index * 28} />
        ))}
        {Array.from({ length: 16 }, (_, index) => {
          const angle = (Math.PI * 2 * index) / 16;
          const x = 310 + Math.cos(angle) * (165 + (index % 3) * 38);
          const y = 310 + Math.sin(angle) * (165 + (index % 3) * 38);
          return <circle key={`dot-${index}`} className="feedx-holo-node" cx={x} cy={y} r={index % 4 === 0 ? 5 : 3} />;
        })}
      </svg>
      <div className="feedx-hologram-base" />
    </div>
  );
}

export function AuthBrandPanel() {
  return (
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
    </section>
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
      setError("Enter your email first, then request a password reset link.");
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
              <h2 className="feedx-auth-title">Access Your Operations Center</h2>
              <p className="feedx-auth-subtitle">Sign in to continue to FeedX</p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="feedx-auth-label">Email</span>
                <div className="feedx-login-input-wrap mt-2">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-200/55" size={17} />
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
                <span className="feedx-auth-label">Password</span>
                <div className="feedx-login-input-wrap mt-2">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-200/55" size={17} />
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
                    className="feedx-password-toggle"
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="feedx-remember-label">
                  <input
                    className="feedx-checkbox"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                  />
                  <span className="font-semibold">Remember me</span>
                </label>
                <button className="feedx-forgot-button" type="button" onClick={handleResetPassword}>
                  Forgot password?
                </button>
              </div>

              {error ? <div className="feedx-auth-alert feedx-auth-alert-error">{error}</div> : null}
              {message ? <div className="feedx-auth-alert feedx-auth-alert-success">{message}</div> : null}

              <button className="feedx-signin-button group" type="submit" disabled={isSubmitting}>
                <span>{isSubmitting ? "Signing in..." : "Sign In"}</span>
                <ArrowRight className="transition group-hover:translate-x-1" size={18} />
              </button>
            </form>

            <div className="feedx-security-note">
              <ShieldCheck size={16} />
              Your data is encrypted and secure
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
