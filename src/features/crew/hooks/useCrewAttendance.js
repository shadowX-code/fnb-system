import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { crewService } from "../../../services/crewService.js";
import { distanceMeters, getLocation } from "../utils/crewMobile.js";
import { reasonValues } from "../utils/crewClockReasons.js";

export default function useCrewAttendance({ session, attendance, context, roster, refresh, screen }) {
  const { t } = useTranslation();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [attendanceMonth, setAttendanceMonth] = useState([]);
  const [attendanceMonthLoading, setAttendanceMonthLoading] = useState(false);
  const [selectedAttendanceMonth, setSelectedAttendanceMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clockDraft, setClockDraft] = useState(null);
  const [clockSuccess, setClockSuccess] = useState(null);
  const [clockTransition, setClockTransition] = useState("");
  const [exception, setException] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [reasonSheetOpen, setReasonSheetOpen] = useState(false);
  const reasonTriggerRef = useRef(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const openShift = useMemo(() => attendance.find((item) => item.status === "open"), [attendance]);
  const todayRoster = roster?.today;
  const employee = session.employee || {};
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
      if (!active.current) return;
      const distance = context?.location_enabled ? distanceMeters(location.latitude, location.longitude, Number(context.latitude), Number(context.longitude)) : null;
      setClockDraft({ action, location, distance });
    } catch (cause) {
      if (active.current) setClockDraft({ action, location: null, locationError: cause.message });
    } finally {
      if (active.current) { setLoading(false); setClockTransition(""); }
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
      if (!active.current) return;
      setClockDraft(null);
      setClockTransition("confirmed");
      await refresh();
      if (!active.current) return;
      const transitionDelay = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 0 : 520;
      await new Promise((resolve) => window.setTimeout(resolve, transitionDelay));
      if (!active.current) return;
      setClockTransition("");
      if (action === "in") {
        setClockSuccess({
          time: result?.record?.clock_in_at || new Date().toISOString(),
          outlet: result?.outlet?.name || context?.outlet_name || t("home.yourOutlet"),
          role: todayRoster?.position || employee.position || t("home.crewMember"),
        });
      }
    } catch (cause) {
      if (!active.current) return;
      setClockTransition("");
      setError(cause.message || t("attendance.unableUpdate"));
    } finally {
      if (active.current) setLoading(false);
    }
  }

  return { attendanceMonth, attendanceMonthLoading, selectedAttendanceMonth, setSelectedAttendanceMonth, loading, error, clockDraft, setClockDraft, clockSuccess, setClockSuccess, clockTransition, exception, setException, otherReason, setOtherReason, reasonSheetOpen, setReasonSheetOpen, reasonTriggerRef, nowTick, openShift, prepareClock, submitClock };
}
