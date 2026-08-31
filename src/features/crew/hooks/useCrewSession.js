import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { crewService } from "../../../services/crewService.js";

const storageKey = "feedx.crew.session";
const methods = { attendance: "myAttendance", context: "attendanceContext", operations: "operationsToday", roster: "myRoster", growth: "growthMobile", performance: "performanceMobile", reward: "rewardMobile", leave: "myLeave", profile: "myProfile" };
const routeReads = { home: ["operations", "roster"], operations: ["operations"], schedule: ["roster"], growth: ["growth", "performance"], reward: ["reward"], me: ["profile", "leave"] };
const cacheLifetime = 60_000;
const fallback = (key) => key === "attendance" ? [] : key === "operations" ? { tasks: [] } : key === "roster" ? { today: null, entries: [] } : null;
const emptyData = () => ({ attendance: [], context: null, growth: null, performance: null, reward: null, operations: null, roster: null, leave: null, profile: null, growthError: "" });
const readSession = () => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "null");
    return value?.token && new Date(value.expires_at) > new Date() ? value : null;
  } catch { return null; }
};

export default function useCrewSession(screen = "home") {
  const { t } = useTranslation();
  const translate = useRef(t);
  translate.current = t;
  const [session, setSession] = useState(readSession);
  const currentSession = useRef(session);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const generation = useRef(0);
  const cache = useRef({});
  const [loaded, setLoaded] = useState({});
  const required = ["attendance", "context", ...(routeReads[screen] || [])];
  const requiredRef = useRef(required);
  requiredRef.current = required;
  const [data, setData] = useState(emptyData);
  const [passcodeSuccess, setPasscodeSuccess] = useState(false);

  const replaceSession = useCallback((nextSession, { passcodeChanged = false } = {}) => {
    generation.current += 1;
    currentSession.current = nextSession;
    cache.current = {};
    setLoaded({});
    if (nextSession) localStorage.setItem(storageKey, JSON.stringify(nextSession));
    else localStorage.removeItem(storageKey);
    setData(emptyData());
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

  const load = useCallback((key, force = false) => {
    const token = session?.token;
    if (!token || currentSession.current?.token !== token || !mounted.current) return Promise.resolve(false);
    const existing = cache.current[key];
    if (!force && existing?.promise) return existing.promise;
    if (!force && existing?.at && Date.now() - existing.at < cacheLifetime) return Promise.resolve(true);
    const epoch = generation.current;
    const request = { at: 0, promise: null };
    cache.current[key] = request;
    const current = () => mounted.current && epoch === generation.current && currentSession.current?.token === token && cache.current[key] === request;
    request.promise = Promise.resolve().then(() => current() ? crewService[methods[key]](token) : undefined).then((value) => {
      if (!current()) return false;
      request.at = Date.now();
      setData((previous) => ({ ...previous, [key]: value ?? fallback(key), ...(key === "growth" ? { growthError: "" } : {}) }));
      setLoaded((previous) => ({ ...previous, [key]: true }));
      return true;
    }).catch((cause) => {
      if (!current()) return false;
      if (key === "attendance" || key === "context") { replaceSession(null); return false; }
      setData((previous) => ({ ...previous, [key]: key === "growth" ? previous.growth : fallback(key), ...(key === "growth" ? { growthError: cause?.message || translate.current("growth.unavailable") } : {}) }));
      setLoaded((previous) => ({ ...previous, [key]: true }));
      return false;
    }).finally(() => { if (current()) request.promise = null; });
    return request.promise;
  }, [session?.token, replaceSession]);

  const refresh = useCallback(async () => {
    if (!session?.token || currentSession.current?.token !== session.token) return false;
    // Mutations can affect other route projections: revalidate those on next entry.
    for (const [key, entry] of Object.entries(cache.current)) {
      entry.at = 0;
      if (entry.promise && !requiredRef.current.includes(key)) delete cache.current[key];
    }
    const results = await Promise.all(requiredRef.current.map((key) => load(key, true)));
    return results.every(Boolean);
  }, [session?.token, load]);

  useEffect(() => {
    for (const key of requiredRef.current) void load(key);
  }, [load, screen]);
  useEffect(() => {
    return () => { generation.current += 1; cache.current = {}; };
  }, []);

  const pageLoading = Boolean(session) && required.some((key) => !loaded[key]);
  return { session, replaceSession, changePasscode, refresh, data, pageLoading, passcodeSuccess };
}
