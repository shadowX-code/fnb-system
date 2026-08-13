import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Delete,
  FileText,
  Gift,
  GraduationCap,
  Hand,
  HelpCircle,
  Home,
  Languages,
  LockKeyhole,
  LogOut,
  MapPin,
  Navigation,
  Plane,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { crewService } from "../../services/crewService.js";
import CrewGrowthMobile from "./components/CrewGrowthMobile.jsx";
import CrewLearningMobile from "./components/CrewLearningMobile.jsx";
import CrewRewardMobile from "./components/CrewRewardMobile.jsx";
import CrewOperationsMobile from "./components/CrewOperationsMobile.jsx";
import CrewLeaveMobile from "./components/CrewLeaveMobile.jsx";
import CrewScheduleMobile from "./components/CrewScheduleMobile.jsx";
import { CrewActionRow, CrewBottomNav, CrewEmptyState, CrewMetric, CrewProgressBar, CrewSectionHeader, CrewStatusBadge } from "./components/CrewMobileUI.jsx";
import "./CrewMobileApp.css";

const storageKey = "feedx.crew.session";
const clockInOptions = ["Outlet GPS location seems inaccurate", "Working off-site", "Assigned to another location", "Location accuracy issue", "Location permission unavailable", "Device location unavailable", "Other"];
const clockOutOptions = ["Working off-site", "Assigned to another location", "Outlet GPS location seems inaccurate", "Location accuracy issue", "Forgot to clock out before leaving", "Location permission unavailable", "Device location unavailable", "Other"];
const navItems = [
  { id: "home", label: "Home", icon: Home },
  { id: "learn", label: "Learn", icon: BookOpen },
  { id: "reward", label: "Reward", icon: Gift },
  { id: "growth", label: "Growth", icon: Sparkles },
  { id: "me", label: "Me", icon: UserRound },
];

const readSession = () => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "null");
    return value?.token && new Date(value.expires_at) > new Date() ? value : null;
  } catch {
    return null;
  }
};
const formatTime = (value) => value ? new Date(value).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }) : "—";
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
const formatRosterTime = (value) => {
  if (!value) return "—";
  const [hours, minutes] = String(value).split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" });
};
const rosterEntryLabel = (entry) => ({ off: "OFF", leave: "Annual Leave", medical: "MC", annual_leave: "Annual Leave", medical_leave: "Medical Leave", unpaid_leave: "Unpaid Leave", other_leave: "Other Leave" }[entry?.entry_type] || entry?.template?.name || "Working");
const distanceMeters = (a, b, c, d) => {
  const radians = (value) => value * Math.PI / 180;
  const latitude = radians(c - a);
  const longitude = radians(d - b);
  const point = Math.sin(latitude / 2) ** 2 + Math.cos(radians(a)) * Math.cos(radians(c)) * Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(point), Math.sqrt(1 - point));
};
const getLocation = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error("Device location unavailable"));
  navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_meters: position.coords.accuracy }),
    (cause) => reject(new Error(cause.code === 1 ? "Location permission unavailable" : "Device location unavailable")),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
});

function CrewLogin({ onSignedIn }) {
  const [step, setStep] = useState("mobile");
  const [countryCode, setCountryCode] = useState("+60");
  const [mobile, setMobile] = useState("");
  const [passcode, setPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submitLogin = async (code) => {
    if (loading || code.length !== 4) return;
    setLoading(true);
    setError("");
    try {
      const normalizedMobile = mobile.trim().startsWith("+") ? mobile.trim() : `${countryCode}${mobile.replace(/^0+/, "")}`;
      const session = await crewService.signIn(normalizedMobile, code);
      localStorage.setItem(storageKey, JSON.stringify(session));
      onSignedIn(session);
    } catch (cause) {
      setError(cause.message || "Unable to sign in.");
      setPasscode("");
    } finally {
      setLoading(false);
    }
  };

  const addDigit = (digit) => {
    if (loading) return;
    const next = `${passcode}${digit}`.slice(0, 4);
    setPasscode(next);
    if (next.length === 4) submitLogin(next);
  };

  if (step === "passcode") return <main className="crew-v2-shell"><section className="crew-v2-login is-passcode">
    <button className="crew-v2-login-back" type="button" onClick={() => { setStep("mobile"); setPasscode(""); setError(""); }} aria-label="Back"><ArrowLeft size={20} /></button>
    <div className="crew-v2-brand"><span>F</span><strong>FeedX</strong></div>
    <div className="crew-v2-login-copy"><h1>Enter Passcode</h1><p>Use your 4-digit Crew passcode.</p></div>
    <div className="crew-v2-passcode-dots" aria-label={`${passcode.length} of 4 digits entered`}>{[0, 1, 2, 3].map((index) => <span key={index} className={index < passcode.length ? "filled" : ""} />)}</div>
    {error && <div className="crew-v2-error" role="alert">{error}</div>}
    {loading && <div className="crew-v2-login-loading"><span className="crew-v2-spinner" /> Signing in…</div>}
    <div className="crew-v2-keypad" aria-label="Passcode keypad">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => <button type="button" key={digit} onClick={() => addDigit(String(digit))}>{digit}</button>)}<span /><button type="button" onClick={() => addDigit("0")}>0</button><button type="button" aria-label="Backspace" onClick={() => setPasscode((current) => current.slice(0, -1))}><Delete size={20} /></button></div>
  </section></main>;

  return <main className="crew-v2-shell"><section className="crew-v2-login">
    <div className="crew-v2-brand"><span>F</span><strong>FeedX</strong></div>
    <div className="crew-v2-login-copy"><h1>Welcome</h1><p>Enter your mobile number to continue.</p></div>
    <form onSubmit={(event) => { event.preventDefault(); setError(""); setStep("passcode"); }}>
      <label>Mobile Number</label>
      <div className="crew-v2-mobile-field"><select aria-label="Country code" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}><option value="+60">+60</option><option value="+65">+65</option></select><input aria-label="Mobile Number" inputMode="tel" autoComplete="tel" value={mobile} onChange={(event) => setMobile(event.target.value.replace(/[^\d\s-]/g, ""))} placeholder="12 345 6789" required /></div>
      <button className="crew-v2-primary" type="submit">Continue</button>
    </form>
    <a href="#dashboard" className="crew-v2-admin-link">FeedX Admin sign in</a>
  </section></main>;
}

function EmptyState({ title, body }) {
  return <CrewEmptyState title={title} body={body} />;
}

export default function CrewMobileApp() {
  const [session, setSession] = useState(readSession);
  const [screen, setScreen] = useState("home");
  const [attendance, setAttendance] = useState([]);
  const [context, setContext] = useState(null);
  const [learningHome, setLearningHome] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [growthError, setGrowthError] = useState("");
  const [performance, setPerformance] = useState(null);
  const [growthInitialView, setGrowthInitialView] = useState("overview");
  const [reward, setReward] = useState(null);
  const [operations, setOperations] = useState(null);
  const [roster, setRoster] = useState(null);
  const [leave, setLeave] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(Boolean(session));
  const [error, setError] = useState("");
  const [clockDraft, setClockDraft] = useState(null);
  const [exception, setException] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [meView, setMeView] = useState("main");
  const [passcodeChangeOpen, setPasscodeChangeOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [currentPasscode, setCurrentPasscode] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const openShift = useMemo(() => attendance.find((item) => item.status === "open"), [attendance]);
  const employee = session?.employee || {};
  const firstName = employee.nickname || employee.full_name?.split(" ")[0] || "Crew";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  async function refresh(token = session?.token) {
    if (!token) return;
    setPageLoading(true);
    const [historyResult, contextResult, learningResult, growthResult, performanceResult, rewardResult, operationsResult, rosterResult, leaveResult] = await Promise.allSettled([
      crewService.myAttendance(token),
      crewService.attendanceContext(token),
      crewService.learningHome(token),
      crewService.growthMobile(token),
      crewService.performanceMobile(token),
      crewService.rewardMobile(token),
      crewService.operationsToday(token),
      crewService.myRoster(token),
      crewService.myLeave(token),
    ]);
    if ([historyResult, contextResult, learningResult].some((result) => result.status === "rejected")) {
      const cause = [historyResult, contextResult, learningResult].find((result) => result.status === "rejected")?.reason;
      localStorage.removeItem(storageKey);
      setSession(null);
      setError(cause?.message || "Your session ended. Please sign in again.");
      setPageLoading(false);
      return;
    }
    setAttendance(historyResult.value || []);
    setContext(contextResult.value || null);
    setLearningHome(learningResult.value || null);
    if (growthResult.status === "fulfilled") {
      setGrowth(growthResult.value);
      setGrowthError("");
    } else {
      setGrowthError(growthResult.reason?.message || "Growth is unavailable.");
    }
    setPerformance(performanceResult.status === "fulfilled" ? performanceResult.value : null);
    setReward(rewardResult.status === "fulfilled" ? rewardResult.value : null);
    setOperations(operationsResult.status === "fulfilled" ? operationsResult.value : { checklists: [], daily_tasks: [] });
    setRoster(rosterResult.status === "fulfilled" ? rosterResult.value : { today: null, entries: [] });
    setLeave(leaveResult.status === "fulfilled" ? leaveResult.value : { requests: [], upcoming: [] });
    setPageLoading(false);
  }

  useEffect(() => { refresh(); }, [session?.token]);

  async function prepareClock(action) {
    setError("");
    setLoading(true);
    setClockDraft(null);
    setException("");
    setOtherReason("");
    try {
      const location = await getLocation();
      const distance = context?.location_enabled ? distanceMeters(location.latitude, location.longitude, Number(context.latitude), Number(context.longitude)) : null;
      setClockDraft({ action, location, distance });
    } catch (cause) {
      setClockDraft({ action, location: null, locationError: cause.message });
    } finally {
      setLoading(false);
    }
  }

  async function submitClock() {
    const reason = exception === "Other" ? otherReason.trim() : exception;
    const requiresException = context?.location_enabled && (!clockDraft?.location || clockDraft?.distance > Number(context.radius_meters));
    if (requiresException && !reason) return setError(`Choose an exception reason to clock ${clockDraft.action === "out" ? "out" : "in"}.`);
    setLoading(true);
    setError("");
    try {
      await crewService.clock(session.token, clockDraft.action, clockDraft.location || null, reason);
      setClockDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause.message || "Unable to update attendance.");
    } finally {
      setLoading(false);
    }
  }

  async function changePasscode(event) {
    event.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(currentPasscode) || !/^\d{4}$/.test(newPasscode)) return setError("Enter both four-digit passcodes.");
    setLoading(true);
    try {
      const next = await crewService.changePasscode(session.token, currentPasscode, newPasscode);
      const updated = { ...session, token: next.token, expires_at: next.expires_at };
      localStorage.setItem(storageKey, JSON.stringify(updated));
      setSession(updated);
      setCurrentPasscode("");
      setNewPasscode("");
      setPasscodeChangeOpen(false);
    } catch (cause) {
      setError(cause.message || "Unable to change passcode.");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(storageKey);
    setSession(null);
    setAttendance([]);
    setScreen("home");
  }

  if (!session) return <CrewLogin onSignedIn={setSession} />;

  const lessonTotal = Number(learningHome?.assignment?.lessons_total) || 0;
  const lessonCompleted = Number(learningHome?.assignment?.lessons_completed) || 0;
  const learningProgress = Number(learningHome?.assignment?.progress_percentage) || (lessonTotal ? Math.round((lessonCompleted / lessonTotal) * 100) : 0);
  const requiredSops = learningHome?.required_sops || [];
  const pendingSops = requiredSops.filter((sop) => !sop.acknowledged).length;
  const growthSummary = growth?.summary || {};
  const exceptionRequired = Boolean(context?.location_enabled && (!clockDraft?.location || clockDraft?.distance > Number(context.radius_meters)));
  const outside = Boolean(clockDraft?.location && clockDraft?.distance > Number(context?.radius_meters));
  const options = clockDraft?.action === "out" ? clockOutOptions : clockInOptions;
  const todayRoster = roster?.today;
  const upcomingRoster = (roster?.entries || []).filter((entry) => entry.date > roster?.from).slice(0, 3);
  const operationsCount = (operations?.checklists?.filter((item) => item.status !== "completed").length || 0) + (operations?.daily_tasks?.filter((item) => item.status !== "completed").length || 0);
  const onboardingActive = Boolean(learningHome?.assignment && learningHome.assignment.status !== "completed" && learningProgress < 100);
  const currentMonthAttendance = attendance.filter((item) => {
    if (!item.clock_in_at) return false;
    const date = new Date(item.clock_in_at);
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const completedAttendance = currentMonthAttendance.filter((item) => item.status === "completed" || item.clock_out_at);
  const attendanceStatus = currentMonthAttendance.length && completedAttendance.length === currentMonthAttendance.length ? "Good" : currentMonthAttendance.length ? "Needs attention" : "No activity yet";
  const annualLeaveBalance = leave?.balances?.find((item) => item.leave_type === "annual");
  const annualLeaveAvailable = annualLeaveBalance?.balance_enforced === false ? null : annualLeaveBalance?.available;
  const pendingLeaveCount = (leave?.requests || []).filter((item) => item.status === "pending").length;

  return <main className="crew-v2-shell"><section className="crew-v2-app">
    {screen === "home" && <section className="crew-v2-home">
      <header className="crew-v2-home-header"><div><p>{greeting},</p><h1>{firstName} <Hand size={18} aria-hidden="true" /></h1><small>{employee.position || "Crew Member"} · {context?.outlet_name || employee.workplace || "Your outlet"}</small></div><div><button type="button" aria-label="Notifications"><Bell size={18} /></button><span className="crew-v2-avatar">{firstName.slice(0, 1)}</span></div></header>
      <button type="button" className={`crew-v3-shift-hero ${openShift ? "is-on" : ""}`} onClick={() => setScreen("attendance")} aria-label={`Attendance ${openShift ? "On Shift" : "Clock In"}`}>
        <div className="crew-v3-shift-top"><CrewStatusBadge tone={openShift ? "success" : todayRoster ? "ready" : "neutral"}>{openShift ? "On Shift" : todayRoster ? "Ready" : "No shift today"}</CrewStatusBadge><span>{todayRoster?.entry_type === "working" ? `${formatRosterTime(todayRoster.start_time)} – ${formatRosterTime(todayRoster.end_time)}` : todayRoster ? rosterEntryLabel(todayRoster) : "Schedule not published"}</span></div>
        <div className="crew-v3-shift-main"><span><small>{openShift ? "Started" : "Today"}</small><strong>{openShift ? formatTime(openShift.clock_in_at) : todayRoster?.entry_type === "working" ? formatRosterTime(todayRoster.start_time) : "—"}</strong><em>{context?.outlet_name || "Your outlet"}</em></span><i>{openShift ? <Check size={22} /> : <Clock3 size={22} />}</i></div>
        <span className="crew-v3-shift-cta">View Attendance <ChevronRight size={16} /></span>
      </button>
      {(operationsCount || onboardingActive || pendingSops) ? <section className="crew-v2-home-section"><CrewSectionHeader title="Today’s Tasks" action="See all" onAction={() => setScreen("operations")} /><div className="crew-v3-row-group">
        {operationsCount > 0 && <CrewActionRow icon={ClipboardCheck} tone="blue" title="Opening & daily tasks" subtitle={`${operationsCount} item${operationsCount === 1 ? "" : "s"} still need attention`} meta="In Progress" onClick={() => setScreen("operations")} />}
        {onboardingActive && <CrewActionRow icon={GraduationCap} tone="mint" title="Continue onboarding" subtitle={`${lessonCompleted} of ${lessonTotal} lessons complete`} meta={`${learningProgress}%`} onClick={() => setScreen("learn")}><CrewProgressBar value={learningProgress} /></CrewActionRow>}
        {pendingSops > 0 && <CrewActionRow icon={FileText} tone="amber" title="SOP acknowledgement" subtitle={`${pendingSops} update${pendingSops === 1 ? "" : "s"} required`} meta="Required" onClick={() => setScreen("learn")} />}
      </div></section> : null}
      <section className="crew-v2-home-section"><CrewSectionHeader title="My Schedule" action="View all" onAction={() => setScreen("schedule")} /><div className="crew-v3-row-group">{todayRoster ? <CrewActionRow icon={CalendarDays} tone="mint" title={todayRoster.entry_type === "working" ? `${formatRosterTime(todayRoster.start_time)} – ${formatRosterTime(todayRoster.end_time)}` : rosterEntryLabel(todayRoster)} subtitle={`${todayRoster.outlet_name} · ${todayRoster.position || rosterEntryLabel(todayRoster)}`} meta="Today" onClick={() => setScreen("schedule")} /> : <EmptyState title="No published shift today" body="Your published schedule will appear here." />}{upcomingRoster.slice(0, 2).map((entry) => <CrewActionRow key={entry.id} icon={CalendarDays} tone="neutral" title={new Date(`${entry.date}T00:00:00`).toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" })} subtitle={entry.outlet?.name} meta={entry.entry_type === "working" ? `${formatRosterTime(entry.start_time)} – ${formatRosterTime(entry.end_time)}` : rosterEntryLabel(entry)} onClick={() => setScreen("schedule")} />)}</div></section>
      {(leave?.upcoming || []).length > 0 && <section className="crew-v2-home-section"><CrewActionRow icon={Plane} tone="blue" title="Upcoming Leave" subtitle={`${rosterEntryLabel({ entry_type: `${leave.upcoming[0].leave_type}_leave` })} · ${formatDate(leave.upcoming[0].start_date)}${leave.upcoming[0].end_date !== leave.upcoming[0].start_date ? ` – ${formatDate(leave.upcoming[0].end_date)}` : ""}`} meta="Approved" onClick={() => setScreen("leave")} /></section>}
      <section className="crew-v2-home-section"><CrewSectionHeader title="Keep Growing" action="Open Growth" onAction={() => setScreen("growth")} /><div className="crew-v3-growth-strip"><CrewMetric value={growthSummary.certified || 0} label="Certified" tone="success" /><CrewMetric value={growthSummary.in_progress || 0} label="In Progress" tone="blue" /><CrewMetric value={growthSummary.ready_for_review || 0} label="Ready" tone="amber" /><button type="button" onClick={() => setScreen("growth")}><TrendingUp size={19} /><span>View growth</span></button></div></section>
    </section>}

    {screen === "learn" && <CrewLearningMobile token={session.token} onRefreshHome={setLearningHome} />}
    {screen === "reward" && <CrewRewardMobile data={reward} loading={pageLoading && !reward} onRetry={() => refresh()} onViewPerformance={() => { setGrowthInitialView("performance"); setScreen("growth"); }} />}
    {screen === "growth" && <CrewGrowthMobile initialView={growthInitialView} data={growth} performance={performance} loading={pageLoading && !growth} error={growthError} onRetry={() => refresh()} onViewReward={() => setScreen("reward")} onNavigate={(target) => setScreen(target)} />}
    {screen === "operations" && <CrewOperationsMobile token={session.token} data={operations} loading={pageLoading && !operations} onRefresh={() => refresh()} onBack={() => setScreen("home")} />}
    {screen === "leave" && <CrewLeaveMobile token={session.token} onBack={() => setScreen("me")} onChanged={() => refresh()} />}

    {screen === "schedule" && <CrewScheduleMobile roster={roster} employee={employee} onBack={() => setScreen("home")} />}

    {screen === "attendance" && <section className="crew-v2-attendance">
      <header className="crew-v2-page-header"><div><button type="button" onClick={() => setScreen("home")} aria-label="Back"><ArrowLeft size={19} /></button><h1>Attendance</h1></div></header>
      <article className="crew-v3-attendance-summary"><div><CrewStatusBadge tone={openShift ? "success" : todayRoster ? "ready" : "neutral"}>{openShift ? "On Shift" : todayRoster ? "Ready for your shift" : "No published shift"}</CrewStatusBadge><Clock3 size={22} /></div><small>Today’s Shift</small><h2>{todayRoster?.entry_type === "working" ? `${formatRosterTime(todayRoster.start_time)} – ${formatRosterTime(todayRoster.end_time)}` : todayRoster ? rosterEntryLabel(todayRoster) : "Schedule not published"}</h2><p>{todayRoster?.position || employee.position || "Crew Member"} · {todayRoster?.outlet_name || context?.outlet_name || "Your outlet"}</p>{openShift && <span>Started {formatTime(openShift.clock_in_at)}</span>}</article>
      <button className="crew-v2-primary" type="button" onClick={() => prepareClock(openShift ? "out" : "in")} disabled={loading}>{loading ? "Checking location…" : openShift ? "Clock Out" : "Clock In"}</button>
      <section className="crew-v2-location"><MapPin size={19} /><span><strong>{context?.location_enabled ? "Location verification" : "Location not configured"}</strong><small>{context?.location_enabled ? `Within ${context.radius_meters}m of ${context.outlet_name}` : "Your manager has not enabled a geofence."}</small></span></section>
      {clockDraft && <section className="crew-v2-clock-confirm" aria-live="polite"><div><Navigation size={18} /><span><strong>{clockDraft.action === "out" ? "Clock out location" : "Clock in location"}</strong><small>{context?.outlet_name || "Outlet"}</small></span></div>{!exceptionRequired && <p className="is-safe"><Check size={16} /> Location verified</p>}{outside && <p className="is-warning">You are {Math.round(clockDraft.distance)}m from the outlet ({context.radius_meters}m allowed).</p>}{!clockDraft.location && <p className="is-warning">Location could not be verified.</p>}{exceptionRequired && <label>Reason<select value={exception} onChange={(event) => setException(event.target.value)}><option value="">Select a reason</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>}{exception === "Other" && <input value={otherReason} maxLength="280" onChange={(event) => setOtherReason(event.target.value)} placeholder="Brief reason" />}{error && <div className="crew-v2-error">{error}</div>}<div className="crew-v2-actions"><button type="button" onClick={() => setClockDraft(null)}>Cancel</button><button className="crew-v2-primary" type="button" onClick={submitClock} disabled={loading}>Confirm</button></div></section>}
      <section className="crew-v2-home-section"><div className="crew-v2-section-title"><h2>Attendance History</h2><span>{attendance.length} shifts</span></div><div className="crew-v2-history">{attendance.length ? attendance.map((row) => <div key={row.id}><span><strong>{formatDate(row.clock_in_at)}</strong><small>{row.clock_in_location_verified ? "Location verified" : row.clock_in_location_exception ? "Location exception" : "Location unavailable"}</small></span><span><strong>{formatTime(row.clock_in_at)} – {row.clock_out_at ? formatTime(row.clock_out_at) : "Now"}</strong><small>{row.status === "open" ? "On shift" : "Completed"}</small></span></div>) : <EmptyState title="No shifts yet" body="Your completed shifts will appear here." />}</div></section>
    </section>}

    {screen === "me" && <section className="crew-v2-me">
      {meView === "settings" ? <><header className="crew-v2-page-header"><div><button type="button" onClick={() => setMeView("main")} aria-label="Back"><ArrowLeft size={19} /></button><h1>Settings</h1></div></header><div className="crew-v2-menu"><div><Bell size={18} /><span>Notifications</span><ChevronRight size={17} /></div><div><Languages size={18} /><span>Language</span><em>English</em><ChevronRight size={17} /></div><button type="button" onClick={() => setPasscodeChangeOpen(true)}><LockKeyhole size={18} /><span>Passcode</span><ChevronRight size={17} /></button><div><ShieldCheck size={18} /><span>Privacy</span><ChevronRight size={17} /></div><div><FileText size={18} /><span>Terms</span><ChevronRight size={17} /></div><div><HelpCircle size={18} /><span>About FeedX</span><ChevronRight size={17} /></div></div></> : meView === "profile" ? <><header className="crew-v2-page-header"><div><button type="button" onClick={() => setMeView("main")} aria-label="Back"><ArrowLeft size={19} /></button><h1>Profile Information</h1></div></header><article className="crew-me-profile-detail"><span className="crew-v2-avatar is-large">{firstName.slice(0, 1)}</span><h2>{employee.full_name || firstName}</h2><p>{employee.position || "Crew Member"}</p><dl><div><dt>Outlet</dt><dd>{context?.outlet_name || employee.workplace || "Not assigned"}</dd></div><div><dt>Employment status</dt><dd>Active</dd></div></dl></article></> : <>
        <header className="crew-me-header"><h1>Me</h1></header>
        <button className="crew-me-profile-hero" type="button" onClick={() => setMeView("profile")} aria-label="View profile information">
          <span className="crew-v2-avatar is-large">{firstName.slice(0, 1)}</span>
          <span className="crew-me-profile-copy"><strong>{employee.full_name || firstName}</strong><small>{employee.position || "Crew Member"}</small><small className="crew-me-outlet"><BriefcaseBusiness size={14} />{context?.outlet_name || employee.workplace || "Your outlet"}</small><em><i />Active</em></span>
          <span className="crew-me-profile-link">View profile <ChevronRight size={17} /></span>
        </button>
        <section className="crew-me-quick-status" aria-label="Work status summary">
          <button type="button" onClick={() => setScreen("attendance")}><span className="crew-me-status-icon"><CalendarCheck size={21} /></span><span><small>Attendance</small><strong className={attendanceStatus === "Needs attention" ? "is-warning" : ""}>{attendanceStatus}</strong><em>{currentMonthAttendance.length ? `${currentMonthAttendance.length} shift${currentMonthAttendance.length === 1 ? "" : "s"} this month` : "No attendance history"}</em></span></button>
          <button type="button" onClick={() => setScreen("leave")}><span className="crew-me-status-icon"><Plane size={21} /></span><span><small>Leave Balance</small><strong>{annualLeaveAvailable == null ? "No balance" : Number(annualLeaveAvailable).toLocaleString("en-MY", { maximumFractionDigits: 1 })}</strong><em>{annualLeaveAvailable == null ? "Annual Leave" : "days available · Annual Leave"}</em></span></button>
        </section>
        <section className="crew-me-section"><h2>Work</h2><div className="crew-me-list">
          <button type="button" onClick={() => setScreen("attendance")}><span className="crew-me-row-icon"><Clock3 size={20} /></span><span><strong>Attendance</strong><small>{currentMonthAttendance.length ? `${currentMonthAttendance.length} shift${currentMonthAttendance.length === 1 ? "" : "s"} this month` : "No activity yet"}</small></span><ChevronRight size={19} /></button>
          <button type="button" onClick={() => setScreen("leave")}><span className="crew-me-row-icon"><Plane size={20} /></span><span><span>Leave</span></span>{pendingLeaveCount > 0 && <em className="crew-me-pending">{pendingLeaveCount} Pending</em>}<ChevronRight size={19} /></button>
          <div><span className="crew-me-row-icon"><FileText size={20} /></span><span><strong>Employment Documents</strong></span><ChevronRight size={19} /></div>
        </div></section>
        <section className="crew-me-section"><h2>Account</h2><div className="crew-me-list is-neutral">
          <button type="button" onClick={() => setMeView("profile")}><span className="crew-me-row-icon"><UserRound size={20} /></span><span><strong>Profile Information</strong></span><ChevronRight size={19} /></button>
          <button type="button" onClick={() => setPasscodeChangeOpen(true)}><span className="crew-me-row-icon"><LockKeyhole size={20} /></span><span><strong>Change Passcode</strong></span><ChevronRight size={19} /></button>
          <button type="button" onClick={() => setMeView("settings")}><span className="crew-me-row-icon"><Settings size={20} /></span><span><strong>Settings</strong></span><ChevronRight size={19} /></button>
        </div></section>
        <section className="crew-me-section"><h2>Support</h2><div className="crew-me-list is-neutral"><div><span className="crew-me-row-icon"><HelpCircle size={20} /></span><span><strong>Help &amp; Support</strong></span><ChevronRight size={19} /></div></div></section>
        <button className="crew-v2-logout" type="button" onClick={() => setLogoutConfirmOpen(true)}><LogOut size={20} /> Log Out</button>
      </>}
      {passcodeChangeOpen && <form className="crew-v2-passcode-form" onSubmit={changePasscode}><div className="crew-v2-section-title"><h2>Change Passcode</h2><button type="button" onClick={() => setPasscodeChangeOpen(false)}>Close</button></div><label>Current passcode<input inputMode="numeric" maxLength="4" value={currentPasscode} onChange={(event) => setCurrentPasscode(event.target.value.replace(/\D/g, ""))} /></label><label>New passcode<input inputMode="numeric" maxLength="4" value={newPasscode} onChange={(event) => setNewPasscode(event.target.value.replace(/\D/g, ""))} /></label>{error && <div className="crew-v2-error">{error}</div>}<button className="crew-v2-primary" disabled={loading}>Save Passcode</button></form>}
      {logoutConfirmOpen && <div className="crew-me-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogoutConfirmOpen(false); }}><section className="crew-me-confirm" role="dialog" aria-modal="true" aria-labelledby="crew-logout-title"><h2 id="crew-logout-title">Log out of FeedX?</h2><p>You’ll need your mobile number and passcode to sign in again.</p><div><button type="button" onClick={() => setLogoutConfirmOpen(false)}>Cancel</button><button type="button" className="is-danger" onClick={logout}>Log Out</button></div></section></div>}
    </section>}

    <CrewBottomNav items={navItems} active={["operations", "attendance", "schedule"].includes(screen) ? "home" : screen === "leave" ? "me" : screen} onChange={(next) => { if (next === "growth") setGrowthInitialView("overview"); setScreen(next); if (next === "me") setMeView("main"); }} />
  </section></main>;
}
