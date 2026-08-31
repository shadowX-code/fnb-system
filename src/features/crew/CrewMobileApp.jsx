import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Gift, Home, Sparkles, UserRound } from "lucide-react";
import useCrewSession from "./hooks/useCrewSession.js";
import useCrewRoute from "./hooks/useCrewRoute.js";
import useCrewAttendance from "./hooks/useCrewAttendance.js";
import CrewLogin from "./components/CrewLogin.jsx";
import CrewHomeMobile from "./components/CrewHomeMobile.jsx";
import CrewMeMobile from "./components/CrewMeMobile.jsx";
import CrewAttendanceMobile, { CrewClockDialogs } from "./components/CrewAttendanceMobile.jsx";
import CrewOperationsMobile from "./components/CrewOperationsMobile.jsx";
import CrewScheduleMobile from "./components/CrewScheduleMobile.jsx";
import { CrewBottomNav, CrewRouteLoading } from "./components/CrewMobileUI.jsx";
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


export default function CrewMobileApp({ onNotify }) {
  const route = useCrewRoute();
  const crew = useCrewSession(route.screen);
  // Replacing a token unmounts every employee-owned view, draft and dialog.
  return crew.session ? <CrewWorkspace key={crew.session.token} {...crew} route={route} onNotify={onNotify} /> : <CrewLogin onSignedIn={crew.replaceSession} />;
}

function CrewWorkspace({ session, replaceSession, changePasscode, data, pageLoading, passcodeSuccess, refresh, route, onNotify }) {
  const { t } = useTranslation();
  const { screen, growthInitialView, entry, navigate } = route;
  const { attendance, context, profile, growth, growthError, performance, reward, operations, roster, leave } = data;
  const clock = useCrewAttendance({ session, attendance, context, roster, refresh, screen });
  const [cashCheckoutFlow, setCashCheckoutFlow] = useState(false);
  const [operationTarget, setOperationTarget] = useState(null);
  const homeScrollY = useRef(0);
  const logout = () => { navigate("home"); replaceSession(null); };
  const openTask = (target) => { homeScrollY.current = window.scrollY; setOperationTarget(target); navigate("operations"); };

  return <main className="crew-v2-shell"><section className="crew-v2-app">
    <Suspense fallback={<CrewRouteLoading />}>
    {screen === "home" && (pageLoading ? <CrewRouteLoading /> : <CrewHomeMobile session={session} attendance={attendance} context={context} roster={roster} operations={operations} clock={clock} navigate={navigate} onOpenTask={openTask} />)}
    {screen === "learn" && <CrewLearningMobile token={session.token} />}
    {screen === "reward" && <CrewRewardMobile data={reward} loading={pageLoading && !reward} onRetry={refresh} onViewPerformance={() => navigate("growth", { growthInitialView: "performance" })} />}
    {screen === "growth" && <CrewGrowthMobile initialView={growthInitialView} data={growth} performance={performance} loading={pageLoading} error={growthError} onRetry={refresh} onNavigate={navigate} onViewChange={(view) => { if (view === "overview" || view === "performance") navigate("growth", { growthInitialView: view }); }} />}
    {screen === "operations" && <CrewOperationsMobile token={session.token} data={operations} loading={pageLoading && !operations} initialTarget={operationTarget} onRefresh={refresh} onBack={(returnContext) => { setOperationTarget(null); navigate("home"); requestAnimationFrame(() => window.scrollTo({ top: returnContext?.scrollY || homeScrollY.current || 0 })); }} />}
    {screen === "leave" && <CrewLeaveMobile token={session.token} onBack={() => navigate("me")} onChanged={refresh} />}
    {screen === "cash-checkout" && <CrewCashCheckoutMobile token={session.token} onBack={() => navigate("me")} onFlowChange={setCashCheckoutFlow} onNotify={onNotify} />}
    {screen === "schedule" && <CrewScheduleMobile roster={roster} onBack={() => navigate("home")} />}
    {screen === "attendance" && <CrewAttendanceMobile rows={clock.attendanceMonth} loading={clock.attendanceMonthLoading} selectedMonth={clock.selectedAttendanceMonth} onMonthChange={clock.setSelectedAttendanceMonth} onBack={() => navigate("home")} t={t} />}
    {screen === "me" && <CrewMeMobile key={entry} session={session} context={context} profile={profile} attendance={attendance} leave={leave} onChangePasscode={changePasscode} passcodeSuccess={passcodeSuccess} navigate={navigate} onLogout={logout} />}
    </Suspense>
    <CrewClockDialogs clock={clock} context={context} navigate={navigate} />
    {!cashCheckoutFlow && <CrewBottomNav items={navItems} active={["operations", "attendance", "schedule"].includes(screen) ? "home" : ["leave", "cash-checkout"].includes(screen) ? "me" : screen} onChange={navigate} />}
  </section></main>;
}
