import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Gift, Home, Sparkles, UserRound } from "lucide-react";
import useCrewSession from "./hooks/useCrewSession.js";
import useCrewRoute from "./hooks/useCrewRoute.js";
import useCrewAttendance from "./hooks/useCrewAttendance.js";
import useCrewTheme from "./hooks/useCrewTheme.js";
import useCrewVisualViewport from "./hooks/useCrewVisualViewport.js";
import useCrewNotifications from "./hooks/useCrewNotifications.js";
import CrewLogin from "./components/CrewLogin.jsx";
import CrewHomeMobile from "./components/CrewHomeMobile.jsx";
import CrewMeMobile from "./components/CrewMeMobile.jsx";
import CrewAttendanceMobile, { CrewClockDialogs } from "./components/CrewAttendanceMobile.jsx";
import CrewOperationsMobile from "./components/CrewOperationsMobile.jsx";
import CrewManagementTasksMobile from "./components/CrewManagementTasksMobile.jsx";
import CrewRecoverySurface from "./components/CrewRecoverySurface.jsx";
import CrewChoicePicker from "./components/CrewChoicePicker.jsx";
import CrewScheduleMobile from "./components/CrewScheduleMobile.jsx";
import { CrewBottomNav, CrewRouteLoading } from "./components/CrewMobileUI.jsx";
import { crewService } from "../../services/crewService.js";
import "./CrewMobileSystem.css";
import "./CrewAuthMobile.css";
import "./CrewMobileTypography.css";
import "./CrewMobileApp.css";
import "./CrewHome.css";
import "./components/CrewAttendanceMobile.css";
import "./components/CrewScheduleMobile.css";
import "./components/CrewLearningMobile.css";
import "./components/CrewOperationsMobile.css";
import "./components/CrewMeMobile.css";

const navItems = [
  { id: "home", label: "Home", icon: Home },
  { id: "learn", label: "Learn", icon: BookOpen },
  { id: "reward", label: "Reward", icon: Gift },
  { id: "growth", label: "Growth", icon: Sparkles },
  { id: "me", label: "Me", icon: UserRound },
];

const CrewGrowthMobile = lazy(() => import("./components/CrewGrowthMobile.jsx"));
const CrewRewardMobile = lazy(() => import("./components/CrewRewardMobile.jsx"));
const CrewLearningMobile = lazy(() => import("./components/CrewLearningMobile.jsx"));
const CrewCashCheckoutMobile = lazy(() => import("./components/CrewCashCheckoutMobile.jsx"));
const CrewLeaveMobile = lazy(() => import("./components/CrewLeaveMobile.jsx"));
const CrewAssetsMobile = lazy(() => import("./components/CrewAssetsMobile.jsx"));
const CrewComplianceMobile = lazy(() => import("./components/CrewComplianceMobile.jsx"));
const CrewDisciplinaryMobile = lazy(() => import("./components/CrewDisciplinaryMobile.jsx"));
const CrewEmploymentRecordsMobile = lazy(() => import("./components/CrewEmploymentRecordsMobile.jsx"));
const CrewEmploymentDocumentsMobile = lazy(() => import("./components/CrewEmploymentDocumentsMobile.jsx"));
const CrewNotificationsMobile = lazy(() => import("./components/CrewNotificationsMobile.jsx"));


export default function CrewMobileApp({ onNotify }) {
  const route = useCrewRoute();
  const crew = useCrewSession(route.screen);
  const crewTheme = useCrewTheme();
  // Replacing a token unmounts every employee-owned view, draft and dialog.
  return crew.session ? <CrewWorkspace key={crew.session.token} {...crew} route={route} onNotify={onNotify} crewTheme={crewTheme} /> : <CrewLogin onSignedIn={crew.replaceSession} />;
}

function CrewWorkspace({ session, replaceSession, changePasscode, updateProfilePhoto, data, pageLoading, passcodeSuccess, refresh, retryBootstrap, bootstrapFailure, bootstrapRetrying, outletScope, selectedOutletId, selectOutlet, route, onNotify, crewTheme }) {
  const { t } = useTranslation();
  useCrewVisualViewport();
  const { screen, growthInitialView, entry, navigate } = route;
  const { theme, toggleTheme } = crewTheme;
  const { unreadCount, refreshUnreadCount } = useCrewNotifications(session.token, screen);
  const { attendance, context, profile, growth, growthError, performance, reward, operations, roster, leave, assets, disciplinary } = data;
  const clock = useCrewAttendance({ session, attendance, context, roster, refresh, screen });
  const [cashCheckoutFlow, setCashCheckoutFlow] = useState(false);
  const [assetInspectionFlow, setAssetInspectionFlow] = useState(false);
  const [operationTarget, setOperationTarget] = useState(null);
  const homeScrollY = useRef(0);
  const logout = () => { navigate("home"); replaceSession(null); };
  const openTask = (target) => { homeScrollY.current = window.scrollY; setOperationTarget(target); navigate("operations"); };
  const openNotification = async (descriptor, notificationId) => {
    const type = descriptor?.type;
    if (outletScope?.management && (type === "task_occurrence" || type === "roster_publication")) {
      const destination = await crewService.notificationDestinationOutlet(session.token, notificationId);
      if (!destination?.available || !destination.outlet_id || !await selectOutlet(destination.outlet_id)) return false;
    }
    if (type === "task_occurrence" && descriptor?.occurrence_id) {
      setOperationTarget(outletScope?.management ? null : { row: { id: descriptor.occurrence_id, name: "Task" }, context: { from: "notification" } });
      navigate("operations");
      return true;
    }
    if (type === "roster_publication") { navigate("schedule"); return true; }
    if (type === "leave_request") { navigate("leave"); return true; }
    if (type === "disciplinary_warning") { navigate("disciplinary"); return true; }
    if (type === "employment_document") { navigate("employment-documents"); return true; }
    if (type === "compliance_submission" || type === "compliance_requirement") { navigate("compliance"); return true; }
    return false;
  };

  if (bootstrapFailure) return <CrewRecoverySurface {...bootstrapFailure} onRetry={retryBootstrap} retrying={bootstrapRetrying} onReload={() => window.location.reload()} />;
  if (!outletScope) return <CrewRouteLoading />;
  return <main className="crew-v2-shell"><section className="crew-v2-app">
    {outletScope.management && outletScope.outlets.length > 1 && <CrewOutletSwitcher outlets={outletScope.outlets} selectedOutletId={selectedOutletId} onSelect={selectOutlet} />}
    <Suspense fallback={<CrewRouteLoading />}>
    {screen === "home" && (pageLoading ? <CrewRouteLoading /> : <CrewHomeMobile session={session} attendance={attendance} context={context} roster={roster} operations={operations} clock={clock} navigate={navigate} onOpenTask={openTask} theme={theme} onToggleTheme={toggleTheme} notificationUnreadCount={unreadCount} management={outletScope.management} />)}
    {screen === "notifications" && <CrewNotificationsMobile token={session.token} onBack={() => navigate("home")} onOpenNotification={openNotification} onUnreadChanged={refreshUnreadCount} />}
    {screen === "learn" && <CrewLearningMobile key={outletScope.management ? selectedOutletId : "fixed"} token={session.token} management={outletScope.management} outletId={selectedOutletId} />}
    {screen === "reward" && <CrewRewardMobile data={reward} loading={pageLoading && !reward} onRetry={refresh} onViewPerformance={() => navigate("growth", { growthInitialView: "performance" })} />}
    {screen === "growth" && <CrewGrowthMobile initialView={growthInitialView} data={growth} performance={performance} loading={pageLoading} error={growthError} onRetry={refresh} onNavigate={navigate} onViewChange={(view) => { if (view === "overview" || view === "performance") navigate("growth", { growthInitialView: view }); }} />}
    {screen === "operations" && (outletScope.management ? <CrewManagementTasksMobile data={operations} onBack={() => navigate("home")} /> : <CrewOperationsMobile token={session.token} data={operations} loading={pageLoading && !operations} initialTarget={operationTarget} onRefresh={refresh} onBack={(returnContext) => { setOperationTarget(null); navigate("home"); requestAnimationFrame(() => window.scrollTo({ top: returnContext?.scrollY || homeScrollY.current || 0 })); }} />)}
    {screen === "leave" && <CrewLeaveMobile token={session.token} onBack={() => navigate("me")} onChanged={refresh} />}
    {screen === "cash-checkout" && <CrewCashCheckoutMobile key={outletScope.management ? selectedOutletId : "fixed"} token={session.token} management={outletScope.management} outletId={selectedOutletId} onBack={() => navigate("me")} onFlowChange={setCashCheckoutFlow} onNotify={onNotify} />}
    {screen === "assets" && <CrewAssetsMobile key={outletScope.management ? selectedOutletId : "fixed"} token={session.token} management={outletScope.management} outletId={selectedOutletId} onBack={() => navigate("me")} onFlowChange={setAssetInspectionFlow} />}
    {screen === "employment-records" && <CrewEmploymentRecordsMobile onBack={() => navigate("me")} navigate={navigate} disciplinary={disciplinary} />}
    {screen === "employment-documents" && <CrewEmploymentDocumentsMobile token={session.token} onBack={() => navigate("employment-records")} />}
    {screen === "compliance" && <CrewComplianceMobile token={session.token} onBack={() => navigate("employment-records")} />}
    {screen === "disciplinary" && <CrewDisciplinaryMobile token={session.token} onBack={() => navigate("employment-records")} onViewed={refresh} />}
    {screen === "schedule" && <CrewScheduleMobile roster={roster} onBack={() => navigate("home")} />}
    {screen === "attendance" && <CrewAttendanceMobile rows={clock.attendanceMonth} loading={clock.attendanceMonthLoading} selectedMonth={clock.selectedAttendanceMonth} onMonthChange={clock.setSelectedAttendanceMonth} onBack={() => navigate("home")} t={t} />}
    {screen === "me" && <CrewMeMobile key={entry} session={session} context={context} profile={profile} attendance={attendance} leave={leave} assetAccess={assets} cashAvailable={!outletScope.management || Boolean(outletScope.outlets.find((outlet) => outlet.id === selectedOutletId)?.special_access?.can_initiate_handover)} management={outletScope.management} disciplinary={disciplinary} onChangePasscode={changePasscode} onUpdateProfilePhoto={updateProfilePhoto} passcodeSuccess={passcodeSuccess} navigate={navigate} onLogout={logout} />}
    </Suspense>
    <CrewClockDialogs clock={clock} context={context} navigate={navigate} />
    {!cashCheckoutFlow && !assetInspectionFlow && <CrewBottomNav items={navItems} active={["operations", "attendance", "schedule", "notifications"].includes(screen) ? "home" : ["leave", "cash-checkout", "assets", "employment-records", "employment-documents", "compliance", "disciplinary"].includes(screen) ? "me" : screen} onChange={navigate} />}
  </section></main>;
}

function CrewOutletSwitcher({ outlets, selectedOutletId, onSelect }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return <div className="crew-outlet-context">
    <CrewChoicePicker label={t("common.outlet")} value={selectedOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} disabled={busy} variant="context" onChange={async (outletId) => {
      setBusy(true);
      try { await onSelect(outletId); } finally { setBusy(false); }
    }} />
  </div>;
}
