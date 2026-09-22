import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { crewService } from "../../../services/crewService.js";

const storageKey = "feedx.crew.session";
const outletStorageKey = (employeeId) => `feedx.crew.outlet.${employeeId}`;
const methods = { attendance: "myAttendance", context: "attendanceContext", operations: "operationsToday", roster: "myRoster", growth: "growthMobile", performance: "performanceMobile", reward: "rewardMobile", leave: "myLeave", profile: "myProfile", assets: "assetsMobile", disciplinary: "myDisciplinary" };
const routeReads = { home: ["operations", "roster"], operations: ["operations"], schedule: ["roster"], growth: ["growth", "performance"], reward: ["reward"], me: ["profile", "leave", "assets", "disciplinary"], assets: ["assets"], "employment-records": ["disciplinary"], disciplinary: ["disciplinary"] };
const cacheLifetime = 60_000;
const autoRetryDelay = 900;
const fallback = (key) => key === "attendance" ? [] : key === "operations" ? { tasks: [] } : key === "roster" ? { today: null, entries: [] } : null;
const emptyData = () => ({ attendance: [], context: null, growth: null, performance: null, reward: null, operations: null, roster: null, leave: null, profile: null, assets: null, disciplinary: null, growthError: "" });
const errorMessage = (error) => [error?.message, error?.cause?.message].filter(Boolean).join(" ");
const isInvalidCrewSession = (error) => error?.code === "42501" || error?.cause?.code === "42501"
  ? /crew session has expired|crew access is no longer active/i.test(errorMessage(error))
  : false;
const browserOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
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
  const [outletScope, setOutletScope] = useState(null);
  const [selectedOutletId, setSelectedOutletId] = useState(null);
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
  const [bootstrapFailure, setBootstrapFailure] = useState(null);
  const [bootstrapRetrying, setBootstrapRetrying] = useState(false);
  const bootstrapAttempt = useRef(0);
  const reportedBootstrapFailure = useRef(-1);
  const bootstrapRetry = useRef(null);

  const replaceSession = useCallback((nextSession, { passcodeChanged = false } = {}) => {
    generation.current += 1;
    currentSession.current = nextSession;
    cache.current = {};
    setLoaded({});
    if (nextSession) localStorage.setItem(storageKey, JSON.stringify(nextSession));
    else localStorage.removeItem(storageKey);
    setData(emptyData());
    setOutletScope(null);
    setSelectedOutletId(null);
    setPasscodeSuccess(passcodeChanged);
    setBootstrapFailure(null);
    setSession(nextSession);
  }, []);

  const reportBootstrapFailure = useCallback(() => {
    if (reportedBootstrapFailure.current === bootstrapAttempt.current) return;
    reportedBootstrapFailure.current = bootstrapAttempt.current;
    setBootstrapFailure({ mode: browserOffline() ? "offline" : "connection", attempts: bootstrapAttempt.current + 1 });
  }, []);

  const refreshOutletScope = useCallback(async () => {
    const token = currentSession.current?.token;
    if (!token) return null;
    try {
      const next = await crewService.outletScope(token);
      if (!mounted.current || currentSession.current?.token !== token) return null;
      const allowed = next.outlets || [];
      if (!allowed.length) throw Object.assign(new Error("Crew Access is no longer active."), { code: "42501" });
      const remembered = localStorage.getItem(outletStorageKey(next.employee_id));
      const previous = selectedOutletId;
      const selected = allowed.find((item) => item.id === previous)?.id
        || allowed.find((item) => item.id === remembered)?.id
        || next.default_outlet_id;
      if (next.management !== outletScope?.management || (next.management && previous && selected !== previous)) {
        delete cache.current.operations;
        delete cache.current.assets;
        setLoaded((state) => ({ ...state, operations: false, assets: false }));
        setData((state) => ({ ...state, operations: null, assets: null }));
      }
      setOutletScope(next);
      setSelectedOutletId(selected);
      if (next.management) localStorage.setItem(outletStorageKey(next.employee_id), selected);
      return next;
    } catch (cause) {
      if (!mounted.current || currentSession.current?.token !== token) return null;
      if (isInvalidCrewSession(cause)) replaceSession(null);
      else reportBootstrapFailure();
      return null;
    }
  }, [selectedOutletId, outletScope?.management, replaceSession, reportBootstrapFailure]);

  const selectOutlet = useCallback(async (outletId) => {
    const next = await refreshOutletScope();
    if (!next?.management || !next.outlets?.some((item) => item.id === outletId)) return false;
    if (outletId === selectedOutletId) return true;
    delete cache.current.operations;
    delete cache.current.assets;
    setLoaded((state) => ({ ...state, operations: false, assets: false }));
    setData((state) => ({ ...state, operations: null, assets: null }));
    setSelectedOutletId(outletId);
    localStorage.setItem(outletStorageKey(next.employee_id), outletId);
    return true;
  }, [refreshOutletScope, selectedOutletId]);

  const changePasscode = useCallback(async (currentPasscode, newPasscode) => {
    const original = currentSession.current;
    if (!original || original.token !== session?.token || !mounted.current) return false;
    const next = await crewService.changePasscode(original.token, currentPasscode, newPasscode);
    // Route changes may unmount Me, but only this still-current session may rotate.
    if (!mounted.current || currentSession.current !== original) return false;
    replaceSession({ ...original, token: next.token, expires_at: next.expires_at }, { passcodeChanged: true });
    return true;
  }, [session?.token, replaceSession]);

  const updateProfilePhoto = useCallback(async (file) => {
    const original = currentSession.current;
    if (!original || original.token !== session?.token || !mounted.current) return false;
    const updated = await crewService.updateMyProfilePhoto(original.token, file);
    if (!mounted.current || currentSession.current !== original) return false;
    setData((previous) => ({ ...previous, profile: { ...(previous.profile || {}), profile_photo_path: updated?.profile_photo_path || null, profile_photo_url: updated?.profile_photo_url || null } }));
    setLoaded((previous) => ({ ...previous, profile: true }));
    return updated;
  }, [session?.token]);

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
    request.promise = Promise.resolve().then(() => {
      if (!current()) return undefined;
      if (outletScope?.management && key === "operations") return crewService.managementTasks(token, selectedOutletId);
      if (outletScope?.management && key === "assets") return crewService.managementAssets(token, selectedOutletId);
      return crewService[methods[key]](token);
    }).then((value) => {
      if (!current()) return false;
      request.at = Date.now();
      setData((previous) => ({ ...previous, [key]: value ?? fallback(key), ...(key === "growth" ? { growthError: "" } : {}) }));
      setLoaded((previous) => ({ ...previous, [key]: true }));
      return true;
    }).catch((cause) => {
      if (!current()) return false;
      if (key === "attendance" || key === "context") {
        if (isInvalidCrewSession(cause)) replaceSession(null);
        else reportBootstrapFailure();
        return false;
      }
      setData((previous) => ({ ...previous, [key]: key === "growth" ? previous.growth : fallback(key), ...(key === "growth" ? { growthError: cause?.message || translate.current("growth.unavailable") } : {}) }));
      setLoaded((previous) => ({ ...previous, [key]: true }));
      return false;
    }).finally(() => { if (current()) request.promise = null; });
    return request.promise;
  }, [session?.token, outletScope?.management, selectedOutletId, replaceSession, reportBootstrapFailure]);

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

  const retryBootstrap = useCallback(() => {
    if (!session?.token || currentSession.current?.token !== session.token) return Promise.resolve(false);
    if (bootstrapRetry.current) return bootstrapRetry.current;
    if (browserOffline()) {
      setBootstrapFailure((previous) => previous ? { ...previous, mode: "offline" } : { mode: "offline", attempts: bootstrapAttempt.current + 1 });
      return Promise.resolve(false);
    }
    bootstrapAttempt.current += 1;
    reportedBootstrapFailure.current = -1;
    setBootstrapFailure(null);
    setBootstrapRetrying(true);
    bootstrapRetry.current = (outletScope ? Promise.all(requiredRef.current.map((key) => load(key, true)))
      : refreshOutletScope().then((scope) => [Boolean(scope)]))
      .then((results) => results.every(Boolean))
      .finally(() => {
        bootstrapRetry.current = null;
        if (mounted.current) setBootstrapRetrying(false);
      });
    return bootstrapRetry.current;
  }, [session?.token, load, outletScope, refreshOutletScope]);

  useEffect(() => {
    if (!session?.token) return;
    void refreshOutletScope();
  }, [session?.token]);
  useEffect(() => {
    if (!session?.token || !outletScope) return undefined;
    const onFocus = () => { void refreshOutletScope(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [session?.token, outletScope, refreshOutletScope]);
  useEffect(() => {
    if (!outletScope || !selectedOutletId) return;
    for (const key of requiredRef.current) void load(key);
  }, [load, screen, outletScope, selectedOutletId]);
  useEffect(() => {
    if (!session || !bootstrapFailure) return undefined;
    const onOnline = () => { void retryBootstrap(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [session, bootstrapFailure, retryBootstrap]);
  useEffect(() => {
    if (!bootstrapFailure || bootstrapFailure.mode === "offline" || bootstrapFailure.attempts !== 1) return undefined;
    const timeout = window.setTimeout(() => { void retryBootstrap(); }, autoRetryDelay);
    return () => window.clearTimeout(timeout);
  }, [bootstrapFailure, retryBootstrap]);
  useEffect(() => {
    return () => { generation.current += 1; cache.current = {}; };
  }, []);

  const pageLoading = Boolean(session) && (!outletScope || required.some((key) => !loaded[key]));
  return { session, replaceSession, changePasscode, updateProfilePhoto, refresh, retryBootstrap, bootstrapFailure, bootstrapRetrying, data, pageLoading, passcodeSuccess, outletScope, selectedOutletId, selectOutlet, refreshOutletScope };
}
