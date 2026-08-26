import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Banknote,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Delete,
  FileText,
  Gift,
  Fingerprint,
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
  UserRound,
} from "lucide-react";
import { crewService } from "../../services/crewService.js";
import CrewGrowthMobile from "./components/CrewGrowthMobile.jsx";
import CrewLearningMobile from "./components/CrewLearningMobile.jsx";
import CrewRewardMobile from "./components/CrewRewardMobile.jsx";
import CrewOperationsMobile from "./components/CrewOperationsMobile.jsx";
import CrewLeaveMobile from "./components/CrewLeaveMobile.jsx";
import CrewScheduleMobile from "./components/CrewScheduleMobile.jsx";
import CrewCashCheckoutMobile from "./components/CrewCashCheckoutMobile.jsx";
import CrewMobileDetailHeader from "./components/CrewMobileDetailHeader.jsx";
import { CrewActionRow, CrewBottomNav, CrewEmptyState, CrewMobilePageHeader, CrewSectionHeader, CrewStatusBadge } from "./components/CrewMobileUI.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import { formatCrewDate, formatCrewTime, crewLocale, translateStatus } from "./utils/crewI18n.js";
import { SUPPORTED_CREW_LANGUAGES } from "../../i18n/index.js";
import "./CrewMobileSystem.css";
import "./CrewAuthMobile.css";
import "./CrewMobileTypography.css";
import "./CrewMobileApp.css";
import "./CrewHome.css";
import "./components/CrewAttendanceMobile.css";
import "./components/CrewScheduleMobile.css";
import "./components/CrewLearningMobile.css";
import "./components/CrewLeaveMobile.css";
import "./components/CrewRewardMobile.css";
import "./components/CrewGrowthMobile.css";
import "./components/CrewPerformanceComponentModal.css";
import "./components/CrewOperationsMobile.css";
import "./components/CrewMeMobile.css";
import "./components/CrewCashCheckoutMobile.css";
import "./components/CrewTaskBlockRenderer.css";

const storageKey = "feedx.crew.session";
const reasonValues = {
  outlet_gps: "Outlet GPS location seems inaccurate",
  off_site: "Working off-site",
  another_location: "Assigned to another location",
  accuracy: "Location accuracy issue",
  permission: "Location permission unavailable",
  unavailable: "Device location unavailable",
  forgot_clock_out: "Forgot to clock out before leaving",
  other: "Other",
};
const clockInOptions = ["outlet_gps", "off_site", "another_location", "accuracy", "permission", "unavailable", "other"];
const clockOutOptions = ["off_site", "another_location", "outlet_gps", "accuracy", "forgot_clock_out", "permission", "unavailable", "other"];
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
const formatTime = (value) => formatCrewTime(value, { hour: "2-digit", minute: "2-digit" });
const formatDate = (value) => formatCrewDate(value, { day: "numeric", month: "short", year: "numeric" });
const malaysiaDateKey = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const formatHomeDate = (value = new Date()) => formatCrewDate(value, { weekday: "short", day: "numeric", month: "short" });
const formatHomeClock = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat(crewLocale(), { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(value));
  return {
    time: `${parts.find((part) => part.type === "hour")?.value || "—"}:${parts.find((part) => part.type === "minute")?.value || "—"}`,
    period: (parts.find((part) => part.type === "dayPeriod")?.value || "").toUpperCase(),
  };
};
const formatDuration = (start, end = new Date()) => {
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds % 3600000 / 60000);
  const seconds = Math.floor(milliseconds % 60000 / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};
const formatRosterTime = (value) => {
  if (!value) return "—";
  const [hours, minutes] = String(value).split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(crewLocale(), { hour: "numeric", minute: "2-digit" });
};
const rosterEntryLabel = (entry, t) => ({ off: t("schedule.off"), leave: t("schedule.annualLeave"), medical: "MC", annual_leave: t("schedule.annualLeave"), medical_leave: t("schedule.medicalLeave"), unpaid_leave: t("schedule.unpaidLeave"), other_leave: t("schedule.otherLeave") }[entry?.entry_type] || entry?.template?.name || t("schedule.working"));
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
  const { t } = useTranslation();
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
      setError(cause.message || t("auth.unable"));
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

  const normalizedDigits = mobile.replace(/\D/g, "");
  const mobileNumberValid = normalizedDigits.length >= 8 && normalizedDigits.length <= 12;
  const mobileSuffix = normalizedDigits.slice(-4).padStart(4, "•");
  const maskedMobile = `${countryCode} •••• ${mobileSuffix}`;

  const brand = <div className="crew-auth-brand" aria-label="FeedX">
    <span className="crew-auth-logo-mark"><img src="/design-homepage/logo.png" alt="" draggable="false" /></span>
    <strong>FeedX</strong>
  </div>;

  if (step === "passcode") return <main className="crew-v2-shell"><section className="crew-v2-login is-passcode">
    <header className="crew-auth-passcode-header">
      <button className="crew-v2-login-back" type="button" onClick={() => { setStep("mobile"); setPasscode(""); setError(""); }} aria-label={t("common.back")}><ArrowLeft size={21} /></button>
      {brand}
    </header>
    <div className="crew-v2-login-copy"><h1>{t("auth.welcomeBack")}</h1><p>{t("auth.enterPasscode")}</p><strong className="crew-auth-masked-mobile">{maskedMobile}</strong></div>
    <div className="crew-v2-passcode-dots" aria-label={t("auth.digitsEntered", { count: passcode.length })}>{[0, 1, 2, 3].map((index) => <span key={index} className={index < passcode.length ? "filled" : ""} />)}</div>
    <div className="crew-auth-feedback" aria-live="polite">
      {error && <div className="crew-v2-error" role="alert">{error}</div>}
      {loading && <div className="crew-v2-login-loading"><span className="crew-v2-spinner" /> {t("auth.signingIn")}</div>}
    </div>
    <div className="crew-v2-keypad" aria-label={t("auth.enterPasscode")}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => <button type="button" key={digit} disabled={loading} onClick={() => addDigit(String(digit))}>{digit}</button>)}<span aria-hidden="true" /><button type="button" disabled={loading} onClick={() => addDigit("0")}>0</button><button type="button" disabled={loading || !passcode.length} aria-label={t("auth.backspace")} onClick={() => setPasscode((current) => current.slice(0, -1))}><Delete size={21} /></button></div>
    <p className="crew-auth-security"><ShieldCheck size={17} /> {t("auth.secure")}</p>
  </section></main>;

  return <main className="crew-v2-shell"><section className="crew-v2-login">
    {brand}
    <div className="crew-v2-login-copy"><h1>{t("auth.welcomeTo")}<br />FeedX <span>{t("auth.crew")}</span></h1><p className="crew-auth-lead">{t("auth.workday")}</p><p>{t("auth.signInPrompt")}</p></div>
    <form onSubmit={(event) => { event.preventDefault(); if (!mobileNumberValid) { setError(t("auth.invalidMobile")); return; } setError(""); setStep("passcode"); }}>
      <label>{t("auth.mobile")}</label>
      <div className="crew-ui-field crew-auth-mobile-field"><span className="crew-auth-country"><select aria-label={t("auth.countryCode")} value={countryCode} onChange={(event) => setCountryCode(event.target.value)}><option value="+60">+60</option><option value="+65">+65</option></select><ChevronDown size={17} aria-hidden="true" /></span><input aria-label={t("auth.mobile")} aria-invalid={Boolean(error)} inputMode="tel" autoComplete="tel" value={mobile} onChange={(event) => { setMobile(event.target.value.replace(/[^\d\s-]/g, "")); if (error) setError(""); }} placeholder="12 345 6789" required /></div>
      {error && <div className="crew-v2-error crew-auth-mobile-error" role="alert">{error}</div>}
      <button className="crew-mobile-primary" type="submit">{t("common.continue")}</button>
    </form>
  </section></main>;
}

function EmptyState({ title, body }) {
  return <CrewEmptyState title={title} body={body} />;
}

function HomeScheduleRow({ entry, label, onClick }) {
  const { t } = useTranslation();
  const away = entry.entry_type !== "working";
  const outlet = entry.outlet_name || entry.outlet?.name || t("home.yourOutlet");
  const dateLabel = label || formatCrewDate(`${entry.date}T12:00:00+08:00`, { weekday: "short", day: "numeric", month: "short" });
  const scheduleLabel = away ? rosterEntryLabel(entry, t) : `${formatRosterTime(entry.start_time)} – ${formatRosterTime(entry.end_time)}`;
  const title = label === "today" ? t("common.today") : dateLabel;
  return <button type="button" className={`crew-home-schedule-row ${away ? "is-away" : "is-working"}`} onClick={onClick} aria-label={`${dateLabel}, ${scheduleLabel}`}><i className="crew-ui-icon-container crew-ui-icon-container--compact"><CalendarDays size={19} /></i><span><strong className="crew-list-primary">{title}</strong>{!away && <small className="crew-home-schedule-time">{scheduleLabel}</small>}<small className="crew-list-secondary">{outlet}{entry.position ? ` · ${entry.position}` : ""}</small></span>{away && <CrewStatusBadge tone="warning">{scheduleLabel}</CrewStatusBadge>}<ChevronRight size={18} /></button>;
}

function AttendanceHistoryScreen({ employee, context, openShift, todayRoster, rows, loading, selectedMonth, onMonthChange, onBack, t }) {
  const months = [0, 1, 2].map((offset) => {
    const date = new Date();
    date.setMonth(date.getMonth() - offset, 1);
    return { value: date.toISOString().slice(0, 7), label: formatCrewDate(date, { month: "long", year: "numeric" }) };
  });
  const totalMinutes = rows.reduce((total, row) => total + (row.clock_in_at && row.clock_out_at ? Math.max(0, (new Date(row.clock_out_at) - new Date(row.clock_in_at)) / 60000) : 0), 0);
  const exceptions = rows.filter((row) => row.clock_in_location_exception || row.status === "open").length;
  const formatMonthDate = (value) => formatCrewDate(value, { day: "2-digit", month: "2-digit", year: "numeric" });
  const shift = todayRoster?.entry_type === "working" ? `${formatRosterTime(todayRoster.start_time)} – ${formatRosterTime(todayRoster.end_time)}` : null;
  return <section className="crew-v2-attendance crew-attendance-history-page">
    <CrewMobileDetailHeader title={t("attendance.title")} onBack={onBack} />
    <div className="crew-attendance-month-select"><SelectField label={t("attendance.month")} ariaLabel={t("attendance.month")} value={selectedMonth} onChange={onMonthChange} options={months} /></div>
    {openShift && <section className="crew-attendance-current-shift"><span><Clock3 size={18} /></span><div><strong>{t("home.onShift")}</strong><small>{t("attendance.started", { time: formatTime(openShift.clock_in_at) })}{shift ? ` · ${shift}` : ""}</small></div><button type="button" onClick={onBack}>{t("home.goHome")}</button></section>}
    <section className="crew-attendance-month-summary" aria-label={t("attendance.monthSummary")}>
      <div><small>{t("attendance.worked")}</small><strong>{rows.length} {t("common.shifts")}</strong></div>
      <div><small>{t("attendance.totalHours")}</small><strong>{Math.floor(totalMinutes / 60)}h {Math.round(totalMinutes % 60)}m</strong></div>
      <div><small>{t("attendance.exceptions")}</small><strong className={exceptions ? "is-warning" : ""}>{exceptions}</strong></div>
    </section>
    <section className="crew-v2-home-section"><div className="crew-v2-section-title"><h2>{t("attendance.history")}</h2><span>{rows.length} {t("common.shifts")}</span></div><div className="crew-v2-history">{loading ? <div className="crew-attendance-loading">{t("common.loading")}</div> : rows.length ? rows.map((row) => {
      const completed = Boolean(row.clock_out_at);
      const minutes = completed ? Math.max(0, (new Date(row.clock_out_at) - new Date(row.clock_in_at)) / 60000) : 0;
      return <div key={row.id}><span><strong>{formatMonthDate(row.clock_in_at)}</strong><small>{row.clock_in_location_verified ? t("attendance.locationVerified") : row.clock_in_location_exception ? t("attendance.locationException") : t("attendance.locationUnavailable")}</small></span><span><strong>{formatTime(row.clock_in_at)} – {completed ? formatTime(row.clock_out_at) : t("common.now")}</strong><small>{completed ? `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m · ${t("status.completed")}` : t("home.onShift")}</small></span></div>;
    }) : <EmptyState title={t("attendance.noShifts")} body={t("attendance.completedAppear")} />}</div></section>
  </section>;
}

function ProfileInformation({ profile, employee, context, firstName, t, onBack }) {
  const date = (value) => value ? formatCrewDate(value, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  const field = (label, value) => <div><dt>{label}</dt><dd>{value || "—"}</dd></div>;
  const name = profile.full_name || employee.full_name || firstName;
  const position = profile.position || employee.position || t("home.crewMember");
  const outlet = profile.outlet_name || context?.outlet_name || employee.workplace || t("me.notAssigned");
  const employmentStatus = profile.employment_status ? String(profile.employment_status).replace(/_/g, " ") : t("status.active");
  return <><CrewMobileDetailHeader title={t("me.profile")} onBack={onBack} /><article className="crew-me-profile-detail">
    <header className="crew-me-profile-summary"><span className="crew-v2-avatar is-large">{firstName.slice(0, 1)}</span><span><h2>{name}</h2><p>{position}</p><small>{outlet}</small><CrewStatusBadge tone="success">{employmentStatus}</CrewStatusBadge></span></header>
    <section><h2>{t("me.personal")}</h2><dl>{field(t("me.fullName"), name)}{field(t("me.nickname"), profile.nickname || employee.nickname)}{field(t("me.birthday"), date(profile.birthday))}{field(t("me.contact"), profile.contact || employee.contact)}</dl></section>
    <section><h2>{t("me.employment")}</h2><dl>{field(t("me.joinedDate"), date(profile.joined_date))}{field(t("me.position"), position)}{field(t("common.outlet"), outlet)}{field(t("me.employmentStatus"), <CrewStatusBadge tone="success">{employmentStatus}</CrewStatusBadge>)}</dl></section>
  </article></>;
}

export default function CrewMobileApp({ onNotify }) {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState(readSession);
  const [screen, setScreen] = useState("home");
  const [cashCheckoutFlow, setCashCheckoutFlow] = useState(false);
  const [attendance, setAttendance] = useState([]);
  const [attendanceMonth, setAttendanceMonth] = useState([]);
  const [attendanceMonthLoading, setAttendanceMonthLoading] = useState(false);
  const [selectedAttendanceMonth, setSelectedAttendanceMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [profile, setProfile] = useState(null);
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
  const [clockSuccess, setClockSuccess] = useState(null);
  const [clockTransition, setClockTransition] = useState("");
  const [operationTarget, setOperationTarget] = useState(null);
  const homeScrollY = useRef(0);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [exception, setException] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [meView, setMeView] = useState("main");
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [currentPasscode, setCurrentPasscode] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [passcodeSuccess, setPasscodeSuccess] = useState(false);
  const openShift = useMemo(() => attendance.find((item) => item.status === "open"), [attendance]);
  const employee = session?.employee || {};
  const firstName = employee.nickname || employee.full_name?.split(" ")[0] || t("auth.crew");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("home.morning") : hour < 18 ? t("home.afternoon") : t("home.evening");

  async function refresh(token = session?.token) {
    if (!token) return;
    setPageLoading(true);
    const [historyResult, contextResult, learningResult, growthResult, performanceResult, rewardResult, operationsResult, rosterResult, leaveResult, profileResult] = await Promise.allSettled([
      crewService.myAttendance(token),
      crewService.attendanceContext(token),
      crewService.learningHome(token),
      crewService.growthMobile(token),
      crewService.performanceMobile(token),
      crewService.rewardMobile(token),
      crewService.operationsToday(token),
      crewService.myRoster(token),
      crewService.myLeave(token),
      typeof crewService.myProfile === "function" ? crewService.myProfile(token) : Promise.resolve(null),
    ]);
    if ([historyResult, contextResult, learningResult].some((result) => result.status === "rejected")) {
      const cause = [historyResult, contextResult, learningResult].find((result) => result.status === "rejected")?.reason;
      localStorage.removeItem(storageKey);
      setSession(null);
      setError(cause?.message || t("auth.unable"));
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
      setGrowthError(growthResult.reason?.message || t("growth.unavailable"));
    }
    setPerformance(performanceResult.status === "fulfilled" ? performanceResult.value : null);
    setReward(rewardResult.status === "fulfilled" ? rewardResult.value : null);
    setOperations(operationsResult.status === "fulfilled" ? operationsResult.value : { tasks: [] });
    setRoster(rosterResult.status === "fulfilled" ? rosterResult.value : { today: null, entries: [] });
    setLeave(leaveResult.status === "fulfilled" ? leaveResult.value : { requests: [], upcoming: [] });
    setProfile(profileResult.status === "fulfilled" ? profileResult.value : null);
    setPageLoading(false);
  }

  useEffect(() => { refresh(); }, [session?.token]);
  useEffect(() => {
    if (!session?.token || screen !== "attendance") return;
    let active = true;
    setAttendanceMonthLoading(true);
    const loadMonth = typeof crewService.myAttendanceMonth === "function"
      ? crewService.myAttendanceMonth(session.token, `${selectedAttendanceMonth}-01`)
      : Promise.resolve(attendance.filter((row) => row.clock_in_at?.slice(0, 7) === selectedAttendanceMonth));
    loadMonth
      .then((rows) => { if (active) setAttendanceMonth(rows); })
      .catch((cause) => { if (active) setError(cause.message || t("attendance.unableUpdate")); })
      .finally(() => { if (active) setAttendanceMonthLoading(false); });
    return () => { active = false; };
  // This is a bounded server read. Keep it independent from Home's summary
  // refresh so opening Attendance never turns into duplicate month requests.
  }, [screen, selectedAttendanceMonth, session?.token]);
  useEffect(() => {
    if (!openShift) return undefined;
    setNowTick(Date.now());
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [openShift?.id, openShift?.clock_in_at]);

  async function prepareClock(action) {
    setError("");
    setLoading(true);
    setClockTransition("locating");
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
      setClockTransition("");
    }
  }

  async function submitClock() {
    const reason = exception === reasonValues.other ? otherReason.trim() : exception;
    const requiresException = context?.location_enabled && (!clockDraft?.location || clockDraft?.distance > Number(context.radius_meters));
    if (requiresException && !reason) return setError(t("errors.chooseExceptionReason", { action: clockDraft.action === "out" ? t("home.clockOut") : t("home.clockIn") }));
    setLoading(true);
    setClockTransition("scanning");
    setError("");
    try {
      const action = clockDraft.action;
      const result = await crewService.clock(session.token, action, clockDraft.location || null, reason);
      setClockDraft(null);
      setClockTransition("confirmed");
      await refresh();
      const transitionDelay = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 0 : 520;
      await new Promise((resolve) => window.setTimeout(resolve, transitionDelay));
      setClockTransition("");
      if (action === "in") {
        setClockSuccess({
          time: result?.record?.clock_in_at || new Date().toISOString(),
          outlet: result?.outlet?.name || context?.outlet_name || t("home.yourOutlet"),
          role: todayRoster?.position || employee.position || t("home.crewMember"),
        });
      }
    } catch (cause) {
      setClockTransition("");
      setError(cause.message || t("attendance.unableUpdate"));
    } finally {
      setLoading(false);
    }
  }

  async function changePasscode(event) {
    event.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(currentPasscode) || !/^\d{4}$/.test(newPasscode) || newPasscode !== confirmPasscode) return setError(t("me.enterPasscodes"));
    setLoading(true);
    try {
      const next = await crewService.changePasscode(session.token, currentPasscode, newPasscode);
      const updated = { ...session, token: next.token, expires_at: next.expires_at };
      localStorage.setItem(storageKey, JSON.stringify(updated));
      setSession(updated);
      setCurrentPasscode("");
      setNewPasscode("");
      setConfirmPasscode("");
      setPasscodeSuccess(true);
      setMeView("main");
    } catch (cause) {
      setError(cause.message || t("me.unablePasscode"));
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

  const exceptionRequired = Boolean(context?.location_enabled && (!clockDraft?.location || clockDraft?.distance > Number(context.radius_meters)));
  const outside = Boolean(clockDraft?.location && clockDraft?.distance > Number(context?.radius_meters));
  const options = clockDraft?.action === "out" ? clockOutOptions : clockInOptions;
  const todayRoster = roster?.today;
  const upcomingRoster = (roster?.entries || []).filter((entry) => entry.date > (todayRoster?.date || roster?.from)).slice(0, 2);
  const homeTasks = (operations?.tasks || []).map((row) => ({ kind: row.source === "legacy_daily" ? "legacy_task" : "task", row, id: `${row.source || "task"}-${row.id}`, title: row.name || row.title, context: row.source === "legacy_daily" ? row.description || (row.due_at ? formatTime(row.due_at) : t("common.today")) : t("tasks.completedCount", { completed: row.completed_count || 0, total: row.block_count || 0 }) + (row.due_at ? ` · ${formatTime(row.due_at)}` : ""), status: row.status || "pending" }));
  const visibleHomeTasks = tasksExpanded ? homeTasks : homeTasks.slice(0, 3);
  const completedToday = attendance.find((item) => item.clock_out_at && malaysiaDateKey(item.clock_in_at) === malaysiaDateKey());
  const attendanceMode = openShift ? "on" : completedToday ? "completed" : "ready";
  const currentMonthAttendance = attendance.filter((item) => {
    if (!item.clock_in_at) return false;
    const date = new Date(item.clock_in_at);
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const completedAttendance = currentMonthAttendance.filter((item) => item.status === "completed" || item.clock_out_at);
  const attendanceStatus = currentMonthAttendance.length && completedAttendance.length === currentMonthAttendance.length ? t("status.good") : currentMonthAttendance.length ? t("status.needs_attention") : t("me.noActivity");
  const annualLeaveBalance = leave?.balances?.find((item) => item.leave_type === "annual");
  const annualLeaveAvailable = annualLeaveBalance?.balance_enforced === false ? null : annualLeaveBalance?.available;
  const pendingLeaveCount = (leave?.requests || []).filter((item) => item.status === "pending").length;
  const homeClock = formatHomeClock(nowTick);
  const attendanceOutlet = context?.outlet_name || todayRoster?.outlet_name || t("home.yourOutlet");
  const shiftLabel = todayRoster?.entry_type === "working" ? `${formatRosterTime(todayRoster.start_time)} – ${formatRosterTime(todayRoster.end_time)}` : todayRoster ? rosterEntryLabel(todayRoster, t) : t("home.notPublished");
  const locationEvidence = attendanceMode === "on"
    ? openShift?.clock_in_location_verified
      ? { tone: "is-verified", label: t("locationEvidence.verified"), title: t("locationEvidence.verifiedHelp") }
      : openShift?.clock_in_location_exception
        ? { tone: "is-exception", label: t("locationEvidence.exception"), title: t("locationEvidence.exceptionHelp") }
        : { tone: "is-pending", label: t("locationEvidence.unavailable"), title: t("locationEvidence.unavailableHelp") }
    : context?.location_enabled
      ? { tone: "is-pending", label: t("locationEvidence.checkAtClockIn"), title: t("locationEvidence.checkAtClockInHelp") }
      : { tone: "is-pending", label: t("locationEvidence.notConfigured"), title: t("locationEvidence.notConfiguredHelp") };

  return <main className="crew-v2-shell"><section className="crew-v2-app">
    {screen === "home" && <section className="crew-v2-home">
      <header className="crew-v2-home-header"><div><p>{greeting},</p><h1>{firstName} <Hand size={18} aria-hidden="true" /></h1><small>{employee.position || t("home.crewMember")} · {context?.outlet_name || employee.workplace || t("home.yourOutlet")}</small></div><div><button type="button" aria-label={t("me.notifications")}><Bell size={18} /></button><span className="crew-v2-avatar">{firstName.slice(0, 1)}</span></div></header>
      <section className={`crew-home-attendance is-${attendanceMode}`} aria-label={t("locationEvidence.attendanceStatus")}>
        <div className="crew-home-attendance-main">
          <div className="crew-home-attendance-copy">
            <CrewStatusBadge tone={attendanceMode === "completed" ? "neutral" : "success"}>{attendanceMode === "on" ? t("home.onShift") : attendanceMode === "completed" ? t("home.shiftCompleted") : t("home.ready")}</CrewStatusBadge>
            {attendanceMode === "completed" ? <><div className="crew-home-attendance-metric"><strong className="crew-home-worked">{formatDuration(completedToday.clock_in_at, completedToday.clock_out_at)}</strong><small>{t("home.workedDuration")}</small></div><dl><div><dt>{t("home.clockInAt")}</dt><dd>{formatTime(completedToday.clock_in_at)}</dd></div><div><dt>{t("home.clockOutAt")}</dt><dd>{formatTime(completedToday.clock_out_at)}</dd></div></dl></> : attendanceMode === "on" ? <div className="crew-home-attendance-metric"><strong className="crew-home-worked">{formatDuration(openShift.clock_in_at, nowTick)}</strong><small>{t("home.clockedInAt", { time: formatTime(openShift.clock_in_at) })}</small></div> : <div className="crew-home-ready-row"><strong className="crew-home-current-time"><span>{homeClock.time}</span><b>{homeClock.period.toLowerCase()}</b></strong><span className="crew-home-ready-context"><b>{formatHomeDate(nowTick)}</b><small title={attendanceOutlet}><MapPin size={12} /><span>{attendanceOutlet}</span></small></span></div>}
            {attendanceMode !== "ready" && <p title={attendanceOutlet}><MapPin size={15} /> {attendanceOutlet}</p>}
          </div>
          <div className={`crew-home-clock-zone is-${attendanceMode}${clockTransition ? ` is-${clockTransition}` : ""}`}>
            <span className="crew-home-radar-orbit" aria-hidden="true"><i /><b /></span>
            {attendanceMode !== "completed" ? <button type="button" className="crew-home-clock-action" onClick={() => prepareClock(attendanceMode === "on" ? "out" : "in")} disabled={loading || Boolean(clockTransition)} aria-label={attendanceMode === "on" ? t("home.clockOut") : t("home.clockIn")}><i className="crew-home-clock-rings" aria-hidden="true"><span /><b /></i><span>{clockTransition === "confirmed" ? <Check size={28} /> : <Fingerprint size={28} />}<small>{clockTransition === "confirmed" ? t("home.attendanceSecured") : attendanceMode === "on" ? t("home.tapToFinish") : t("home.tapTo")}</small><strong>{clockTransition === "confirmed" ? t("home.confirmed") : loading ? t("home.locating") : attendanceMode === "on" ? t("home.clockOut") : t("home.clockIn")}</strong></span></button> : <div className="crew-home-complete-ring" aria-label={t("home.shiftCompleted")}><i className="crew-home-clock-rings" aria-hidden="true"><span /><b /></i><span><Check size={27} /><strong>{t("status.completed")}</strong><small>{formatDuration(completedToday.clock_in_at, completedToday.clock_out_at)}</small></span></div>}
            {attendanceMode !== "completed" && <em className={`crew-home-gps ${locationEvidence.tone}`} title={locationEvidence.title}><ShieldCheck size={13} /> {locationEvidence.label}</em>}
          </div>
        </div>
        <button type="button" className="crew-home-attendance-footer" onClick={() => setScreen("attendance")}><span><i className="crew-ui-icon-container crew-ui-icon-container--compact"><CalendarCheck size={18} /></i><small>{t("home.todayShift")}</small><strong>{shiftLabel}</strong></span><em>{t("home.viewAttendance")} <ChevronRight size={16} /></em></button>
      </section>
      <section className="crew-v2-home-section crew-home-tasks"><CrewSectionHeader density="operational" title={t("home.todaysTasks")} meta={homeTasks.length} action={t("common.viewAll")} actionLabel={t("tasks.title")} onAction={() => { setOperationTarget(null); setScreen("operations"); }} /><div className="crew-home-list">
        {visibleHomeTasks.length ? visibleHomeTasks.map((task) => <button type="button" key={task.id} className={`crew-home-task is-${task.status}`} onClick={() => { homeScrollY.current = window.scrollY; setOperationTarget({ kind: task.kind, row: task.row, context: { from: "home", scrollY: homeScrollY.current } }); setScreen("operations"); }} aria-label={t("learn.openSop", { title: task.title })}><i className="crew-ui-icon-container crew-ui-icon-container--compact">{task.status === "completed" ? <Check size={19} /> : <ClipboardCheck size={18} />}</i><span><strong className="crew-list-primary">{task.title}</strong><small className="crew-list-secondary">{task.context}</small></span><CrewStatusBadge tone={task.status === "completed" ? "success" : task.status === "overdue" || task.status === "exception" ? "danger" : task.status === "in_progress" ? "info" : "warning"}>{translateStatus(task.status, t)}</CrewStatusBadge><ChevronRight size={18} /></button>) : <div className="crew-home-empty"><Check size={20} /><span><strong>{t("home.allClear")}</strong><small>{t("home.noTasks")}</small></span></div>}
        {homeTasks.length > 3 && <button type="button" className="crew-home-show-more" onClick={() => setTasksExpanded((value) => !value)}>{tasksExpanded ? t("home.showFewer") : t("home.showRemaining", { count: homeTasks.length - 3 })}</button>}
      </div></section>
      <section className="crew-v2-home-section crew-home-schedule"><CrewSectionHeader density="operational" title={t("home.mySchedule")} action={t("common.viewAll")} onAction={() => setScreen("schedule")} /><div className="crew-home-list">{todayRoster ? <HomeScheduleRow entry={todayRoster} label="today" onClick={() => setScreen("schedule")} /> : <div className="crew-home-empty"><CalendarDays size={20} /><span><strong>{t("home.noPublishedShift")}</strong><small>{t("home.scheduleWillAppear")}</small></span></div>}{upcomingRoster.map((entry) => <HomeScheduleRow key={entry.id} entry={entry} onClick={() => setScreen("schedule")} />)}</div></section>
    </section>}

    {screen === "learn" && <CrewLearningMobile token={session.token} onRefreshHome={setLearningHome} />}
    {screen === "reward" && <CrewRewardMobile data={reward} loading={pageLoading && !reward} onRetry={() => refresh()} onViewPerformance={() => { setGrowthInitialView("performance"); setScreen("growth"); }} />}
    {screen === "growth" && <CrewGrowthMobile initialView={growthInitialView} data={growth} performance={performance} loading={pageLoading && !growth} error={growthError} onRetry={() => refresh()} onViewReward={() => setScreen("reward")} onNavigate={(target) => setScreen(target)} />}
    {screen === "operations" && <CrewOperationsMobile token={session.token} data={operations} loading={pageLoading && !operations} initialTarget={operationTarget} onRefresh={() => refresh()} onBack={(returnContext) => { setOperationTarget(null); setScreen("home"); requestAnimationFrame(() => window.scrollTo({ top: returnContext?.scrollY || homeScrollY.current || 0 })); }} />}
    {screen === "leave" && <CrewLeaveMobile token={session.token} onBack={() => setScreen("me")} onChanged={() => refresh()} />}
    {screen === "cash-checkout" && <CrewCashCheckoutMobile token={session.token} onBack={() => setScreen("me")} onFlowChange={setCashCheckoutFlow} onNotify={onNotify} />}

    {screen === "schedule" && <CrewScheduleMobile roster={roster} employee={employee} onBack={() => setScreen("home")} />}

    {screen === "attendance" && <AttendanceHistoryScreen
      employee={employee} context={context} openShift={openShift} todayRoster={todayRoster}
      rows={attendanceMonth} loading={attendanceMonthLoading} selectedMonth={selectedAttendanceMonth}
      onMonthChange={setSelectedAttendanceMonth} onBack={() => setScreen("home")} t={t}
    />}

    {screen === "me" && <section className="crew-v2-me">
      {meView === "settings" ? <><CrewMobileDetailHeader title={t("me.settings")} onBack={() => setMeView("main")} /><section className="crew-me-settings crew-ui-functional-surface"><CrewActionRow icon={Bell} title={t("me.notifications")} /><CrewActionRow icon={Languages} title={t("me.language")} subtitle={t(`languages.${i18n.resolvedLanguage || i18n.language}`)} ariaLabel={t("me.language")} onClick={() => setLanguageOpen(true)} /><CrewActionRow icon={ShieldCheck} title={t("me.privacy")} /><CrewActionRow icon={FileText} title={t("me.terms")} /><CrewActionRow icon={HelpCircle} title={t("me.about")} /></section></> : meView === "profile" ? <ProfileInformation profile={profile || employee} employee={employee} context={context} firstName={firstName} t={t} onBack={() => setMeView("main")} /> : meView === "passcode" ? <section className="crew-me-passcode-page"><CrewMobileDetailHeader title={t("me.changePasscode")} onBack={() => setMeView("main")} /><form className="crew-v2-passcode-form" onSubmit={changePasscode}><label>{t("me.currentPasscode")}<input inputMode="numeric" autoComplete="current-password" maxLength="4" value={currentPasscode} onChange={(event) => setCurrentPasscode(event.target.value.replace(/\D/g, ""))} /></label><label>{t("me.newPasscode")}<input inputMode="numeric" autoComplete="new-password" maxLength="4" value={newPasscode} onChange={(event) => setNewPasscode(event.target.value.replace(/\D/g, ""))} /></label><label>{t("me.confirmNewPasscode")}<input inputMode="numeric" autoComplete="new-password" maxLength="4" value={confirmPasscode} onChange={(event) => setConfirmPasscode(event.target.value.replace(/\D/g, ""))} /></label>{error && <div className="crew-v2-error">{error}</div>}<button className="crew-mobile-primary" disabled={loading}>{t("me.savePasscode")}</button></form></section> : <>
        <CrewMobilePageHeader title={t("me.title")} />{passcodeSuccess && <p className="crew-me-success" role="status"><Check size={16} /> {t("me.passcodeSaved")}</p>}
        <button className="crew-me-profile-hero" type="button" onClick={() => setMeView("profile")} aria-label={t("me.viewProfile")}>
          <span className="crew-v2-avatar is-large">{firstName.slice(0, 1)}</span>
          <span className="crew-me-profile-copy"><strong>{employee.full_name || firstName}</strong><small>{employee.position || t("home.crewMember")}</small><small className="crew-me-outlet"><BriefcaseBusiness size={14} />{context?.outlet_name || employee.workplace || t("home.yourOutlet")}</small><em><i />{t("status.active")}</em></span>
          <span className="crew-me-profile-link">{t("me.viewProfile")} <ChevronRight size={17} /></span>
        </button>
        <section className="crew-me-quick-status" aria-label={t("me.workSummary")}>
          <button type="button" onClick={() => setScreen("attendance")}><span className="crew-me-status-icon crew-ui-icon-container"><CalendarCheck size={21} /></span><span><small>{t("me.attendance")}</small><strong className={attendanceStatus === t("status.needs_attention") ? "is-warning" : ""}>{attendanceStatus}</strong><em>{currentMonthAttendance.length ? t("me.shiftsThisMonth", { count: currentMonthAttendance.length }) : t("me.noHistory")}</em></span></button>
          <button type="button" onClick={() => setScreen("leave")}><span className="crew-me-status-icon crew-ui-icon-container"><Plane size={21} /></span><span><small>{t("me.leaveBalance")}</small><strong>{annualLeaveAvailable == null ? t("me.noBalance") : Number(annualLeaveAvailable).toLocaleString(crewLocale(), { maximumFractionDigits: 1 })}</strong><em>{annualLeaveAvailable == null ? t("me.annualLeave") : t("me.daysAvailable")}</em></span></button>
        </section>
        <section className="crew-me-section"><h2>{t("me.work")}</h2><div className="crew-me-list">
          <button type="button" onClick={() => setScreen("attendance")}><span className="crew-me-row-icon crew-ui-icon-container"><Clock3 size={20} /></span><span><strong>{t("me.attendance")}</strong><small>{currentMonthAttendance.length ? t("me.shiftsThisMonth", { count: currentMonthAttendance.length }) : t("me.noActivity")}</small></span><ChevronRight size={19} /></button>
          <button type="button" onClick={() => setScreen("leave")}><span className="crew-me-row-icon crew-ui-icon-container"><Plane size={20} /></span><span><span>{t("me.leave")}</span></span>{pendingLeaveCount > 0 && <em className="crew-me-pending">{t("me.pendingCount", { count: pendingLeaveCount })}</em>}<ChevronRight size={19} /></button>
          <button type="button" onClick={() => setScreen("cash-checkout")}><span className="crew-me-row-icon crew-ui-icon-container"><Banknote size={20} /></span><span><strong>{t("cash.title")}</strong><small>{t("cash.meSubtitle")}</small></span><ChevronRight size={19} /></button>
          <div><span className="crew-me-row-icon crew-ui-icon-container"><FileText size={20} /></span><span><strong>{t("me.employmentDocuments")}</strong></span><ChevronRight size={19} /></div>
        </div></section>
        <section className="crew-me-section"><h2>{t("me.account")}</h2><div className="crew-me-list">
          <button type="button" onClick={() => setMeView("profile")}><span className="crew-me-row-icon crew-ui-icon-container"><UserRound size={20} /></span><span><strong>{t("me.profile")}</strong></span><ChevronRight size={19} /></button>
          <button type="button" onClick={() => setMeView("passcode")}><span className="crew-me-row-icon crew-ui-icon-container"><LockKeyhole size={20} /></span><span><strong>{t("me.changePasscode")}</strong></span><ChevronRight size={19} /></button>
          <button type="button" onClick={() => setMeView("settings")}><span className="crew-me-row-icon crew-ui-icon-container"><Settings size={20} /></span><span><strong>{t("me.settings")}</strong></span><ChevronRight size={19} /></button>
        </div></section>
        <button className="crew-v2-logout crew-mobile-destructive" type="button" onClick={() => setLogoutConfirmOpen(true)}><LogOut size={20} /> {t("me.logout")}</button>
      </>}
      {languageOpen && <div className="crew-me-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLanguageOpen(false); }}><section className="crew-me-confirm crew-language-modal" role="dialog" aria-modal="true" aria-labelledby="crew-language-title"><h2 id="crew-language-title">{t("me.languageTitle")}</h2><p>{t("me.languageHint")}</p><div className="crew-language-list">{SUPPORTED_CREW_LANGUAGES.map((language) => <button type="button" key={language} aria-pressed={(i18n.resolvedLanguage || i18n.language) === language} onClick={() => { i18n.changeLanguage(language); setLanguageOpen(false); }}><span>{t(`languages.${language}`)}</span>{(i18n.resolvedLanguage || i18n.language) === language && <Check size={18} />}</button>)}</div><div><button type="button" className="crew-mobile-ghost" onClick={() => setLanguageOpen(false)}>{t("common.close")}</button></div></section></div>}
      {logoutConfirmOpen && <div className="crew-me-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogoutConfirmOpen(false); }}><section className="crew-me-confirm" role="dialog" aria-modal="true" aria-labelledby="crew-logout-title"><h2 id="crew-logout-title">{t("me.logoutTitle")}</h2><p>{t("me.logoutBody")}</p><div><button type="button" className="crew-mobile-ghost" onClick={() => setLogoutConfirmOpen(false)}>{t("common.cancel")}</button><button type="button" className="crew-mobile-destructive" onClick={logout}>{t("me.logout")}</button></div></section></div>}
    </section>}

    {clockDraft && <div className="crew-home-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) setClockDraft(null); }}>
      <section className="crew-home-clock-modal" role="dialog" aria-modal="true" aria-labelledby="crew-clock-confirm-title">
        <header><span><Navigation size={19} /></span><div><h2 id="crew-clock-confirm-title">{t("attendance.confirmClock", { action: clockDraft.action === "out" ? t("home.clockOut") : t("home.clockIn") })}</h2><p>{context?.outlet_name || t("common.outlet")}</p></div></header>
        {!exceptionRequired && <p className="is-safe"><Check size={16} /> {t("attendance.locationVerified")}</p>}
        {outside && <p className="is-warning">{t("attendance.outsideRange", { distance: Math.round(clockDraft.distance), meters: context.radius_meters })}</p>}
        {!clockDraft.location && <p className="is-warning">{t("attendance.locationUnavailable")}</p>}
        {exceptionRequired && <div className="crew-home-modal-select"><SelectField label={t("attendance.reason")} ariaLabel={t("attendance.reason")} value={exception} onChange={setException} placeholder={t("attendance.selectReason")} options={options.map((option) => ({ value: reasonValues[option], label: t(`attendanceReasons.${option}`) }))} /></div>}
        {exception === reasonValues.other && <input value={otherReason} maxLength="280" onChange={(event) => setOtherReason(event.target.value)} placeholder={t("attendance.briefReason")} />}
        {error && <div className="crew-v2-error">{error}</div>}
        <div className="crew-v2-actions"><button type="button" className="crew-mobile-ghost" onClick={() => setClockDraft(null)} disabled={loading}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" onClick={submitClock} disabled={loading || (exceptionRequired && (!exception || (exception === reasonValues.other && !otherReason.trim())))}>{loading ? t("common.saving") : clockDraft.action === "out" ? t("home.clockOut") : t("common.confirm")}</button></div>
      </section>
    </div>}
    {clockSuccess && <div className="crew-home-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setClockSuccess(null); }}><section className="crew-home-success-modal" role="dialog" aria-modal="true" aria-labelledby="crew-clock-success-title"><span><Check size={28} /></span><h2 id="crew-clock-success-title">{t("home.clockedInSuccess")}</h2><dl><div><dt>{t("home.clockInTime")}</dt><dd>{formatTime(clockSuccess.time)}</dd></div><div><dt>{t("common.outlet")}</dt><dd>{clockSuccess.outlet}</dd></div><div><dt>{t("common.role")}</dt><dd>{clockSuccess.role}</dd></div></dl><div className="crew-home-modal-actions"><button type="button" className="crew-mobile-primary" onClick={() => { setClockSuccess(null); setScreen("home"); }}>{t("home.goHome")}</button><button type="button" className="crew-mobile-secondary" onClick={() => { setClockSuccess(null); setScreen("attendance"); }}>{t("home.viewAttendance")}</button></div></section></div>}

    {!cashCheckoutFlow && <CrewBottomNav items={navItems} active={["operations", "attendance", "schedule"].includes(screen) ? "home" : ["leave", "cash-checkout"].includes(screen) ? "me" : screen} onChange={(next) => { if (next === "growth") setGrowthInitialView("overview"); setScreen(next); if (next === "me") setMeView("main"); }} />}
  </section></main>;
}
