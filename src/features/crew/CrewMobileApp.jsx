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
  TriangleAlert,
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
import CrewBottomSheet from "./components/CrewBottomSheet.jsx";
import CrewHomeClockMotion from "./CrewHomeClockMotion.jsx";
import crewMeProfileCredentialAsset from "./assets/crew-me-profile-credential-approved.png";
import { CrewActionRow, CrewBottomNav, CrewEmptyState, CrewMobilePageHeader, CrewSectionHeader, CrewStatusBadge } from "./components/CrewMobileUI.jsx";
import { formatCrewDate, formatCrewTime, crewLocale, translateStatus } from "./utils/crewI18n.js";
import { crewRouteForState, parseCrewRoute } from "./crewRoute.js";
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
import crewHomeAttendanceMintBackground from "./assets/crew-home-attendance-mint-background.png";

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
const formatEmploymentType = (value) => String(value || "").split(/[_-]/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("-");
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
  return <button type="button" className={`crew-home-schedule-row ${away ? "is-away" : "is-working"}`} onClick={onClick} aria-label={`${dateLabel}, ${scheduleLabel}`}><i className="crew-ui-icon-container crew-ui-icon-container--compact"><CalendarDays size={19} /></i><span><strong className="crew-list-primary">{title}</strong>{!away && <small className="crew-home-schedule-time">{scheduleLabel}</small>}<small className="crew-list-secondary">{outlet}</small></span>{away && <CrewStatusBadge tone="warning">{scheduleLabel}</CrewStatusBadge>}<ChevronRight size={18} /></button>;
}

function AttendanceHistoryScreen({ rows, loading, selectedMonth, onMonthChange, onBack, t }) {
  const months = [0, 1, 2].map((offset) => {
    const date = new Date();
    date.setMonth(date.getMonth() - offset, 1);
    return { value: malaysiaDateKey(date).slice(0, 7), label: formatCrewDate(date, { month: "short", year: "numeric" }) };
  });
  const totalMinutes = rows.reduce((total, row) => total + (row.clock_in_at && row.clock_out_at ? Math.max(0, (new Date(row.clock_out_at) - new Date(row.clock_in_at)) / 60000) : 0), 0);
  const exceptions = rows.filter((row) => row.clock_in_location_exception || row.status === "open").length;
  const formatMonthDate = (value) => formatCrewDate(value, { day: "2-digit", month: "2-digit", year: "numeric" });
  const formatAttendanceTime = (value) => formatCrewTime(value, { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/gi, (meridiem) => meridiem.toUpperCase());
  const durationLabel = (minutes) => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  return <section className="crew-v2-attendance crew-attendance-history-page">
    <CrewMobileDetailHeader title={t("attendance.title")} subtitle={t("attendance.subtitle")} variant="page" onBack={onBack} />
    <nav className="crew-ui-segmented crew-ui-segmented--mint crew-attendance-month-select" aria-label={t("attendance.month")}>
      {months.map((month) => <button className={selectedMonth === month.value ? "is-active" : ""} type="button" key={month.value} aria-pressed={selectedMonth === month.value} onClick={() => onMonthChange(month.value)}><span>{month.label}</span>{selectedMonth === month.value && <CalendarCheck size={20} aria-hidden="true" />}</button>)}
    </nav>
    <section className="crew-attendance-month-summary" aria-label={t("attendance.monthSummary")}>
      <div><span className="crew-ui-icon-container crew-ui-icon-container--compact"><CalendarCheck size={18} /></span><small>{t("attendance.worked")}</small><strong>{rows.length}</strong><em>{t("common.shifts")}</em></div>
      <div><span className="crew-ui-icon-container crew-ui-icon-container--compact"><Clock3 size={18} /></span><small>{t("attendance.totalHours")}</small><strong>{durationLabel(totalMinutes)}</strong></div>
      <div className={exceptions ? "is-warning" : ""}><span className={`crew-ui-icon-container crew-ui-icon-container--compact${exceptions ? " is-warning" : ""}`}><TriangleAlert size={18} /></span><small>{t("attendance.exceptions")}</small><strong>{exceptions}</strong><em>{exceptions ? t("attendance.requiresReview") : t("status.completed")}</em></div>
    </section>
    <section className="crew-attendance-history"><header><div><h2 className="crew-type-section-title">{t("attendance.history")}</h2><p>{t("attendance.recentRecords")}</p></div><span className="crew-ui-count">{rows.length} {t("common.shifts")}</span></header><div className="crew-attendance-history-list">{loading ? <div className="crew-attendance-loading">{t("common.loading")}</div> : rows.length ? rows.map((row) => {
      const completed = Boolean(row.clock_out_at);
      const minutes = completed ? Math.max(0, (new Date(row.clock_out_at) - new Date(row.clock_in_at)) / 60000) : 0;
      const exception = Boolean(row.clock_in_location_exception);
      const evidence = exception ? t("attendance.exception") : row.clock_in_location_verified ? t("attendance.verified") : t("attendance.locationUnavailable");
      return <article className={`crew-attendance-history-row${exception ? " is-warning" : ""}`} key={row.id}><time className="crew-attendance-date-block"><small>{formatCrewDate(row.clock_in_at, { month: "short" }).toUpperCase()}</small><strong>{formatCrewDate(row.clock_in_at, { day: "2-digit" })}</strong></time><div className="crew-attendance-history-main"><strong>{formatMonthDate(row.clock_in_at)}</strong><small className={`crew-attendance-location-status${exception ? " is-warning" : row.clock_in_location_verified ? " is-verified" : ""}`}><MapPin size={16} aria-hidden="true" />{evidence}</small>{exception && <CrewStatusBadge tone="warning">{t("attendance.requiresReview")}</CrewStatusBadge>}</div><div className="crew-attendance-history-time"><strong>{formatAttendanceTime(row.clock_in_at)} – {completed ? formatAttendanceTime(row.clock_out_at) : t("common.now")}</strong><span>{completed ? <><small>{durationLabel(minutes)}</small><i>·</i><CrewStatusBadge tone="success">{t("status.completed")}</CrewStatusBadge></> : <CrewStatusBadge tone="info">{t("home.onShift")}</CrewStatusBadge>}</span></div></article>;
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

function ClockReasonSheet({ options, selectedReason, onSelect, onClose }) {
  const { t } = useTranslation();
  const reasonIcons = {
    outlet_gps: MapPin,
    off_site: BriefcaseBusiness,
    another_location: Navigation,
    accuracy: TriangleAlert,
    permission: LockKeyhole,
    unavailable: TriangleAlert,
    forgot_clock_out: Clock3,
    other: FileText,
  };
  return <CrewBottomSheet title={t("attendance.selectReasonTitle")} description={t("attendance.selectReasonHelp")} onClose={onClose} className="crew-clock-reason-sheet" contentClassName="crew-clock-reason-sheet-content">
    <div className="crew-clock-reason-options" role="listbox" aria-label={t("attendance.reason")}>
      {options.map((option) => {
        const Icon = reasonIcons[option] || FileText;
        const selected = selectedReason === reasonValues[option];
        return <button key={option} type="button" role="option" aria-selected={selected} className={selected ? "is-selected" : ""} onClick={() => { onSelect(reasonValues[option]); onClose(); }}><Icon size={18} aria-hidden="true" /><span>{t(`attendanceReasons.${option}`)}</span>{selected ? <Check size={18} aria-hidden="true" /> : null}</button>;
      })}
    </div>
  </CrewBottomSheet>;
}

export default function CrewMobileApp({ onNotify }) {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState(readSession);
  const initialRoute = parseCrewRoute() || crewRouteForState({ screen: "home" });
  const [screen, setScreen] = useState(initialRoute.screen);
  const [cashCheckoutFlow, setCashCheckoutFlow] = useState(false);
  const [attendance, setAttendance] = useState([]);
  const [attendanceMonth, setAttendanceMonth] = useState([]);
  const [attendanceMonthLoading, setAttendanceMonthLoading] = useState(false);
  const [selectedAttendanceMonth, setSelectedAttendanceMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [profile, setProfile] = useState(null);
  const [context, setContext] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [growthError, setGrowthError] = useState("");
  const [performance, setPerformance] = useState(null);
  const [growthInitialView, setGrowthInitialView] = useState(initialRoute.growthInitialView || "overview");
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
  const [nowTick, setNowTick] = useState(Date.now());
  const [exception, setException] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [reasonSheetOpen, setReasonSheetOpen] = useState(false);
  const reasonTriggerRef = useRef(null);
  const [meView, setMeView] = useState("main");
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [currentPasscode, setCurrentPasscode] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [passcodeSuccess, setPasscodeSuccess] = useState(false);
  const refreshGeneration = useRef(0);
  const currentSession = useRef(session);
  const routeNeedsNormalization = useRef(Boolean(initialRoute.needsNormalization));
  currentSession.current = session;
  const openShift = useMemo(() => attendance.find((item) => item.status === "open"), [attendance]);
  const employee = session?.employee || {};
  const firstName = employee.nickname || employee.full_name?.split(" ")[0] || t("auth.crew");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("home.morning") : hour < 18 ? t("home.afternoon") : t("home.evening");

  function invalidatePendingCrewData() {
    refreshGeneration.current += 1;
  }

  function clearEmployeeState() {
    setAttendance([]);
    setAttendanceMonth([]);
    setAttendanceMonthLoading(false);
    setProfile(null);
    setContext(null);
    setGrowth(null);
    setGrowthError("");
    setPerformance(null);
    setReward(null);
    setOperations(null);
    setRoster(null);
    setLeave(null);
    setPageLoading(false);
    setLoading(false);
    setError("");
    setClockDraft(null);
    setClockSuccess(null);
    setClockTransition("");
    setOperationTarget(null);
    setCashCheckoutFlow(false);
  }

  function replaceCrewSession(nextSession) {
    invalidatePendingCrewData();
    clearEmployeeState();
    setSession(nextSession);
  }

  async function refresh(token = session?.token) {
    if (!token) return;
    const generation = ++refreshGeneration.current;
    setPageLoading(true);
    const [historyResult, contextResult, growthResult, performanceResult, rewardResult, operationsResult, rosterResult, leaveResult, profileResult] = await Promise.allSettled([
      crewService.myAttendance(token),
      crewService.attendanceContext(token),
      crewService.growthMobile(token),
      crewService.performanceMobile(token),
      crewService.rewardMobile(token),
      crewService.operationsToday(token),
      crewService.myRoster(token),
      crewService.myLeave(token),
      typeof crewService.myProfile === "function" ? crewService.myProfile(token) : Promise.resolve(null),
    ]);
    if (generation !== refreshGeneration.current || currentSession.current?.token !== token) return;
    if ([historyResult, contextResult].some((result) => result.status === "rejected")) {
      const cause = [historyResult, contextResult].find((result) => result.status === "rejected")?.reason;
      localStorage.removeItem(storageKey);
      replaceCrewSession(null);
      setError(cause?.message || t("auth.unable"));
      setPageLoading(false);
      return;
    }
    setAttendance(historyResult.value || []);
    setContext(contextResult.value || null);
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

  useEffect(() => { void refresh(); }, [session?.token]);
  useEffect(() => {
    const syncRoute = () => {
      const next = parseCrewRoute();
      if (!next) return;
      routeNeedsNormalization.current = Boolean(next.needsNormalization);
      setScreen(next.screen);
      setGrowthInitialView(next.growthInitialView || "overview");
      if (next.screen === "me") setMeView(next.meView || "main");
    };
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("hashchange", syncRoute);
    };
  }, []);
  useEffect(() => {
    const route = crewRouteForState({ screen, growthInitialView });
    if (window.location.hash === route.canonicalHash) return;
    const replaceRoute = routeNeedsNormalization.current;
    routeNeedsNormalization.current = false;
    window.history[replaceRoute ? "replaceState" : "pushState"](null, "", route.canonicalHash);
  }, [screen, growthInitialView]);
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
    setReasonSheetOpen(false);
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
      replaceCrewSession(updated);
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
    replaceCrewSession(null);
    setScreen("home");
  }

  if (!session) return <CrewLogin onSignedIn={replaceCrewSession} />;

  const exceptionRequired = Boolean(context?.location_enabled && (!clockDraft?.location || clockDraft?.distance > Number(context.radius_meters)));
  const outside = Boolean(clockDraft?.location && clockDraft?.distance > Number(context?.radius_meters));
  const options = clockDraft?.action === "out" ? clockOutOptions : clockInOptions;
  const todayRoster = roster?.today;
  const upcomingRoster = (roster?.entries || []).filter((entry) => entry.date > (todayRoster?.date || roster?.from)).slice(0, 2);
  const homeTasks = (operations?.tasks || []).map((row) => {
    const progress = row.source === "legacy_daily"
      ? row.description || null
      : t("tasks.completedCount", { completed: row.completed_count || 0, total: row.block_count || 0 });
    const deadline = row.due_at
      ? { time: formatTime(row.due_at), overdue: row.status === "overdue" }
      : null;
    return { kind: row.source === "legacy_daily" ? "legacy_task" : "task", row, id: `${row.source || "task"}-${row.id}`, title: row.name || row.title, progress, deadline, status: row.status || "pending" };
  });
  const homeTaskBadgeState = homeTasks.length === 0 ? "empty" : homeTasks.every((task) => task.status === "completed") ? "complete" : "alert";
  const completedToday = attendance.find((item) => item.clock_out_at && malaysiaDateKey(item.clock_in_at) === malaysiaDateKey());
  const attendanceMode = openShift ? "on" : completedToday ? "completed" : "ready";
  const currentMonthAttendance = attendance.filter((item) => {
    if (!item.clock_in_at) return false;
    const date = new Date(item.clock_in_at);
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const pendingLeaveCount = (leave?.requests || []).filter((item) => item.status === "pending").length;
  const employmentType = profile?.employment_type || employee.employment_type || "";
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
      <header className="crew-v2-home-header"><div><p>{greeting},</p><h1>{firstName} <Clock3 className="crew-home-shift-status-icon" size={18} aria-hidden="true" /></h1><small>{employee.position || t("home.crewMember")} · {context?.outlet_name || employee.workplace || t("home.yourOutlet")}</small></div><div><button type="button" aria-label={t("me.notifications")}><Bell size={18} /></button><span className="crew-v2-avatar">{firstName.slice(0, 1)}</span></div></header>
      <section className={`crew-home-attendance is-${attendanceMode}`} aria-label={t("locationEvidence.attendanceStatus")}>
        <div className="crew-home-attendance-main">
          <img className="crew-home-attendance-art" src={crewHomeAttendanceMintBackground} alt="" aria-hidden="true" />
          <div className="crew-home-attendance-copy">
            <CrewStatusBadge tone={attendanceMode === "completed" ? "neutral" : "success"}>{attendanceMode === "on" ? t("home.onShift") : attendanceMode === "completed" ? t("home.shiftCompleted") : t("home.ready")}</CrewStatusBadge>
            {attendanceMode === "completed" ? <><div className="crew-home-attendance-metric"><strong className="crew-home-worked">{formatDuration(completedToday.clock_in_at, completedToday.clock_out_at)}</strong><small>{t("home.workedDuration")}</small></div><dl><div><dt>{t("home.clockInAt")}</dt><dd>{formatTime(completedToday.clock_in_at)}</dd></div><div><dt>{t("home.clockOutAt")}</dt><dd>{formatTime(completedToday.clock_out_at)}</dd></div></dl></> : attendanceMode === "on" ? <div className="crew-home-attendance-metric"><strong className="crew-home-worked">{formatDuration(openShift.clock_in_at, nowTick)}</strong><small>{t("home.clockedInAt", { time: formatTime(openShift.clock_in_at) })}</small></div> : <div className="crew-home-ready-row"><strong className="crew-home-current-time"><span>{homeClock.time}</span><b>{homeClock.period.toLowerCase()}</b></strong><span className="crew-home-ready-context"><b>{formatHomeDate(nowTick)}</b><small title={attendanceOutlet}><MapPin size={12} /><span>{attendanceOutlet}</span></small></span></div>}
            {attendanceMode !== "ready" && <p title={attendanceOutlet}><MapPin size={15} /> {attendanceOutlet}</p>}
          </div>
          <CrewHomeClockMotion attendanceMode={attendanceMode} transition={clockTransition} loading={loading} hasException={locationEvidence.tone === "is-exception"}>
            {attendanceMode !== "completed" ? <button type="button" className="crew-home-clock-action" onClick={() => prepareClock(attendanceMode === "on" ? "out" : "in")} disabled={loading || Boolean(clockTransition)} aria-label={attendanceMode === "on" ? t("home.clockOut") : t("home.clockIn")}><i className="crew-home-clock-rings" aria-hidden="true"><span /><b /></i><span>{clockTransition === "confirmed" ? <Check size={28} /> : <Fingerprint size={28} />}<small>{clockTransition === "confirmed" ? t("home.attendanceSecured") : attendanceMode === "on" ? t("home.tapToFinish") : t("home.tapTo")}</small><strong>{clockTransition === "confirmed" ? t("home.confirmed") : loading ? t("home.locating") : attendanceMode === "on" ? t("home.clockOut") : t("home.clockIn")}</strong></span></button> : <div className="crew-home-complete-ring" aria-label={t("home.shiftCompleted")}><i className="crew-home-clock-rings" aria-hidden="true"><span /><b /></i><span><Check size={27} /><strong>{t("status.completed")}</strong><small>{formatDuration(completedToday.clock_in_at, completedToday.clock_out_at)}</small></span></div>}
            {attendanceMode !== "completed" && <em className={`crew-home-gps ${locationEvidence.tone}`} title={locationEvidence.title}><ShieldCheck size={13} /><span>{locationEvidence.label}</span></em>}
          </CrewHomeClockMotion>
        </div>
        <button type="button" className="crew-home-attendance-footer" onClick={() => setScreen("attendance")}><i className="crew-ui-icon-container crew-ui-icon-container--compact"><CalendarCheck size={18} /></i><small>{t("home.todayShift")}</small><em>{t("home.viewAttendance")} <ChevronRight size={16} /></em><strong>{shiftLabel}</strong></button>
      </section>
      <section className="crew-v2-home-section crew-home-tasks"><CrewSectionHeader density="operational" title={<>{t("home.todaysTasks")}<span className={`crew-home-task-count is-${homeTaskBadgeState}`}>{homeTasks.length}</span></>} action={t("common.viewAll")} actionLabel={t("tasks.title")} onAction={() => { setOperationTarget(null); setScreen("operations"); }} /><div className="crew-home-list">
        {homeTasks.length ? homeTasks.map((task) => <button type="button" key={task.id} className={`crew-home-task is-${task.status}`} onClick={() => { homeScrollY.current = window.scrollY; setOperationTarget({ kind: task.kind, row: task.row, context: { from: "home", scrollY: homeScrollY.current } }); setScreen("operations"); }} aria-label={t("learn.openSop", { title: task.title })}><i className="crew-ui-icon-container crew-ui-icon-container--compact">{task.status === "completed" ? <Check size={19} /> : <ClipboardCheck size={18} />}</i><span><strong className="crew-list-primary">{task.title}</strong>{(task.progress || task.deadline) && <small className="crew-list-secondary crew-home-task-meta">{task.progress && <span className="crew-home-task-progress">{task.progress}</span>}{task.deadline && <span className={`crew-home-task-due${task.deadline.overdue ? " is-overdue" : ""}`}><Clock3 size={13} /><b>{t("tasks.dueLabel")}</b><span>{task.deadline.time}</span></span>}</small>}</span><CrewStatusBadge tone={task.status === "completed" ? "success" : task.status === "overdue" || task.status === "exception" ? "danger" : task.status === "in_progress" ? "info" : "warning"}>{translateStatus(task.status, t)}</CrewStatusBadge><ChevronRight size={18} /></button>) : <div className="crew-home-empty"><Check size={20} /><span><strong>{t("home.allClear")}</strong><small>{t("home.noTasks")}</small></span></div>}
      </div></section>
      <section className="crew-v2-home-section crew-home-schedule"><CrewSectionHeader density="operational" title={t("home.mySchedule")} action={t("common.viewAll")} onAction={() => setScreen("schedule")} /><div className="crew-home-list">{todayRoster ? <HomeScheduleRow entry={todayRoster} label="today" onClick={() => setScreen("schedule")} /> : <div className="crew-home-empty"><CalendarDays size={20} /><span><strong>{t("home.noPublishedShift")}</strong><small>{t("home.scheduleWillAppear")}</small></span></div>}{upcomingRoster.map((entry) => <HomeScheduleRow key={entry.id} entry={entry} onClick={() => setScreen("schedule")} />)}</div></section>
    </section>}

    {screen === "learn" && <CrewLearningMobile token={session.token} />}
    {screen === "reward" && <CrewRewardMobile data={reward} loading={pageLoading && !reward} onRetry={() => refresh()} onViewPerformance={() => { setGrowthInitialView("performance"); setScreen("growth"); }} />}
    {screen === "growth" && <CrewGrowthMobile initialView={growthInitialView} data={growth} performance={performance} loading={pageLoading && !growth} error={growthError} onRetry={() => refresh()} onViewReward={() => setScreen("reward")} onNavigate={(target) => setScreen(target)} onViewChange={(view) => { if (view === "overview" || view === "performance") setGrowthInitialView(view); }} />}
    {screen === "operations" && <CrewOperationsMobile token={session.token} data={operations} loading={pageLoading && !operations} initialTarget={operationTarget} onRefresh={() => refresh()} onBack={(returnContext) => { setOperationTarget(null); setScreen("home"); requestAnimationFrame(() => window.scrollTo({ top: returnContext?.scrollY || homeScrollY.current || 0 })); }} />}
    {screen === "leave" && <CrewLeaveMobile token={session.token} onBack={() => setScreen("me")} onChanged={() => refresh()} />}
    {screen === "cash-checkout" && <CrewCashCheckoutMobile token={session.token} onBack={() => setScreen("me")} onFlowChange={setCashCheckoutFlow} onNotify={onNotify} />}

    {screen === "schedule" && <CrewScheduleMobile roster={roster} onBack={() => setScreen("home")} />}

    {screen === "attendance" && <AttendanceHistoryScreen
      rows={attendanceMonth} loading={attendanceMonthLoading} selectedMonth={selectedAttendanceMonth}
      onMonthChange={setSelectedAttendanceMonth} onBack={() => setScreen("home")} t={t}
    />}

    {screen === "me" && <section className="crew-v2-me">
      {meView === "settings" ? <><CrewMobileDetailHeader title={t("me.settings")} onBack={() => setMeView("main")} /><section className="crew-me-settings crew-ui-functional-surface"><CrewActionRow icon={Bell} title={t("me.notifications")} /><CrewActionRow icon={Languages} title={t("me.language")} subtitle={t(`languages.${i18n.resolvedLanguage || i18n.language}`)} ariaLabel={t("me.language")} onClick={() => setLanguageOpen(true)} /><CrewActionRow icon={ShieldCheck} title={t("me.privacy")} /><CrewActionRow icon={FileText} title={t("me.terms")} /><CrewActionRow icon={HelpCircle} title={t("me.about")} /></section></> : meView === "profile" ? <ProfileInformation profile={profile || employee} employee={employee} context={context} firstName={firstName} t={t} onBack={() => setMeView("main")} /> : meView === "passcode" ? <section className="crew-me-passcode-page"><CrewMobileDetailHeader title={t("me.changePasscode")} onBack={() => setMeView("main")} /><form className="crew-v2-passcode-form" onSubmit={changePasscode}><label>{t("me.currentPasscode")}<input inputMode="numeric" autoComplete="current-password" maxLength="4" value={currentPasscode} onChange={(event) => setCurrentPasscode(event.target.value.replace(/\D/g, ""))} /></label><label>{t("me.newPasscode")}<input inputMode="numeric" autoComplete="new-password" maxLength="4" value={newPasscode} onChange={(event) => setNewPasscode(event.target.value.replace(/\D/g, ""))} /></label><label>{t("me.confirmNewPasscode")}<input inputMode="numeric" autoComplete="new-password" maxLength="4" value={confirmPasscode} onChange={(event) => setConfirmPasscode(event.target.value.replace(/\D/g, ""))} /></label>{error && <div className="crew-v2-error">{error}</div>}<button className="crew-mobile-primary" disabled={loading}>{t("me.savePasscode")}</button></form></section> : <>
        <CrewMobilePageHeader title={t("me.title")} />{passcodeSuccess && <p className="crew-me-success" role="status"><Check size={16} /> {t("me.passcodeSaved")}</p>}
        <section className="crew-me-profile-hero">
          <img className="crew-me-profile-credential-art" src={crewMeProfileCredentialAsset} alt="" aria-hidden="true" />
          <span className="crew-v2-avatar is-large">{firstName.slice(0, 1)}</span>
          <span className="crew-me-profile-copy"><strong>{employee.full_name || firstName}</strong><small>{employee.position || t("home.crewMember")}</small><small className="crew-me-outlet"><BriefcaseBusiness size={14} />{context?.outlet_name || employee.workplace || t("home.yourOutlet")}</small>{employmentType && <CrewStatusBadge tone="mint">{formatEmploymentType(employmentType)}</CrewStatusBadge>}</span>
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

    {clockDraft && !reasonSheetOpen && <CrewBottomSheet title={t("attendance.confirmClock", { action: clockDraft.action === "out" ? t("home.clockOut") : t("home.clockIn") })} description={context?.outlet_name || t("common.outlet")} headerIcon={<Navigation size={19} />} onClose={() => setClockDraft(null)} closeDisabled={loading} allowBackdropClose={!loading} initialFocusRef={exceptionRequired ? reasonTriggerRef : undefined} className="crew-clock-confirm-sheet" contentClassName="crew-clock-confirm-content" footer={<><button type="button" className="crew-mobile-ghost" onClick={() => setClockDraft(null)} disabled={loading}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" onClick={submitClock} disabled={loading || (exceptionRequired && (!exception || (exception === reasonValues.other && !otherReason.trim())))}>{loading ? t("common.saving") : clockDraft.action === "out" ? t("home.clockOut") : t("common.confirm")}</button></>}>
      {!exceptionRequired && <div className="crew-clock-location-callout is-verified"><Check size={17} /><span>{t("attendance.locationVerified")}</span></div>}
      {outside && <div className="crew-clock-location-callout is-warning"><MapPin size={17} /><span><strong>{t("attendance.locationDistance", { distance: Math.round(clockDraft.distance) })}</strong><small>{t("attendance.locationAllowed", { meters: context.radius_meters })}</small></span></div>}
      {!clockDraft.location && <div className="crew-clock-location-callout is-warning"><TriangleAlert size={17} /><span>{t("attendance.locationUnavailable")}</span></div>}
      {exceptionRequired && <label className="crew-clock-reason-field"><span>{t("attendance.reason")}</span><button ref={reasonTriggerRef} type="button" onClick={() => setReasonSheetOpen(true)} aria-label={exception || t("attendance.selectReason")} aria-haspopup="dialog" aria-expanded={reasonSheetOpen}><strong>{exception || t("attendance.selectReason")}</strong><ChevronRight size={18} /></button></label>}
      {exception === reasonValues.other && <label className="crew-clock-other-reason"><span>{t("attendance.briefReason")}</span><input value={otherReason} maxLength="280" onChange={(event) => setOtherReason(event.target.value)} placeholder={t("attendance.briefReason")} /></label>}
      {error && <div className="crew-v2-error">{error}</div>}
    </CrewBottomSheet>}
    {clockDraft && reasonSheetOpen ? <ClockReasonSheet options={options} selectedReason={exception} onSelect={setException} onClose={() => setReasonSheetOpen(false)} /> : null}
    {clockSuccess && <div className="crew-home-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setClockSuccess(null); }}><section className="crew-home-success-modal" role="dialog" aria-modal="true" aria-labelledby="crew-clock-success-title"><span><Check size={28} /></span><h2 id="crew-clock-success-title">{t("home.clockedInSuccess")}</h2><dl><div><dt>{t("home.clockInTime")}</dt><dd>{formatTime(clockSuccess.time)}</dd></div><div><dt>{t("common.outlet")}</dt><dd>{clockSuccess.outlet}</dd></div><div><dt>{t("common.role")}</dt><dd>{clockSuccess.role}</dd></div></dl><div className="crew-home-modal-actions"><button type="button" className="crew-mobile-primary" onClick={() => { setClockSuccess(null); setScreen("home"); }}>{t("home.goHome")}</button><button type="button" className="crew-mobile-secondary" onClick={() => { setClockSuccess(null); setScreen("attendance"); }}>{t("home.viewAttendance")}</button></div></section></div>}

    {!cashCheckoutFlow && <CrewBottomNav items={navItems} active={["operations", "attendance", "schedule"].includes(screen) ? "home" : ["leave", "cash-checkout"].includes(screen) ? "me" : screen} onChange={(next) => { if (next === "growth") setGrowthInitialView("overview"); setScreen(next); if (next === "me") setMeView("main"); }} />}
  </section></main>;
}
