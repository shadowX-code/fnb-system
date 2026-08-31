import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { crewService } from "../../../services/crewService.js";

const storageKey = "feedx.crew.session";
const emptyData = () => ({ attendance: [], context: null, growth: null, performance: null, reward: null, operations: null, roster: null, leave: null, profile: null, growthError: "" });
const readSession = () => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "null");
    return value?.token && new Date(value.expires_at) > new Date() ? value : null;
  } catch { return null; }
};

export default function useCrewSession() {
  const { t } = useTranslation();
  const translate = useRef(t);
  translate.current = t;
  const [session, setSession] = useState(readSession);
  const currentSession = useRef(session);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const generation = useRef(0);
  const [data, setData] = useState(emptyData);
  const [pageLoading, setPageLoading] = useState(Boolean(session));
  const [passcodeSuccess, setPasscodeSuccess] = useState(false);

  const replaceSession = useCallback((nextSession, { passcodeChanged = false } = {}) => {
    generation.current += 1;
    currentSession.current = nextSession;
    if (nextSession) localStorage.setItem(storageKey, JSON.stringify(nextSession));
    else localStorage.removeItem(storageKey);
    setData(emptyData());
    setPageLoading(Boolean(nextSession));
    setPasscodeSuccess(passcodeChanged);
    setSession(nextSession);
  }, []);

  const changePasscode = useCallback(async (currentPasscode, newPasscode) => {
    const original = currentSession.current;
    if (!original || original.token !== session?.token || !mounted.current) return false;
    const next = await crewService.changePasscode(original.token, currentPasscode, newPasscode);
    // Route changes may unmount Me, but only this still-current session may rotate.
    if (!mounted.current || currentSession.current !== original) return false;
    replaceSession({ ...original, token: next.token, expires_at: next.expires_at }, { passcodeChanged: true });
    return true;
  }, [session?.token, replaceSession]);

  const refresh = useCallback(async () => {
    const token = session?.token;
    // An obsolete child's callback must not supersede the new session's request.
    if (!token || currentSession.current?.token !== token) return false;
    const request = ++generation.current;
    setPageLoading(true);
    const [history, context, growth, performance, reward, operations, roster, leave, profile] = await Promise.allSettled([
      crewService.myAttendance(token), crewService.attendanceContext(token), crewService.growthMobile(token),
      crewService.performanceMobile(token), crewService.rewardMobile(token), crewService.operationsToday(token),
      crewService.myRoster(token), crewService.myLeave(token),
      typeof crewService.myProfile === "function" ? crewService.myProfile(token) : Promise.resolve(null),
    ]);
    if (request !== generation.current || currentSession.current?.token !== token) return false;
    if (history.status === "rejected" || context.status === "rejected") {
      replaceSession(null);
      return false;
    }
    const value = (result, fallback = null) => result.status === "fulfilled" ? result.value : fallback;
    setData((previous) => ({
      attendance: history.value || [], context: context.value || null,
      growth: value(growth, previous.growth), growthError: growth.status === "rejected" ? growth.reason?.message || translate.current("growth.unavailable") : "",
      performance: value(performance), reward: value(reward), operations: value(operations, { tasks: [] }),
      roster: value(roster, { today: null, entries: [] }), leave: value(leave, { requests: [], upcoming: [] }), profile: value(profile),
    }));
    setPageLoading(false);
    return true;
  }, [session?.token, replaceSession]);

  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  return { session, replaceSession, changePasscode, refresh, data, pageLoading, passcodeSuccess };
}
