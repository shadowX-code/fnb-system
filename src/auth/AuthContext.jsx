import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { authService } from "./authService.js";
import { isProtectedRoleProfile } from "./rbac.js";

const AuthContext = createContext(null);

function readRecoveryCallback() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const type = hashParams.get("type") || queryParams.get("type");
  const accessToken = hashParams.get("access_token") || queryParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token") || queryParams.get("refresh_token");
  if (type !== "recovery" || !accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

function clearAuthCallbackUrl() {
  window.history.replaceState(null, "", `${window.location.pathname}#dashboard`);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [source, setSource] = useState("loading");
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const passwordRecoveryRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadContext(nextSession) {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setError("");

    if (!nextSession?.user) {
      setProfile(null);
      setPermissions([]);
      setSource("anonymous");
      setLoading(false);
      setContextLoading(false);
      return;
    }

    setContextLoading(true);
    try {
      const context = await authService.getUserContext(nextSession.user);
      setProfile(context.profile);
      setPermissions(context.permissions);
      setSource(context.source);
    } catch (loadError) {
      console.error("Unable to load user context", loadError);
      setError(loadError.message === "Unable to load role permissions." ? loadError.message : "Unable to load your access permissions. Please contact admin.");
      setProfile(null);
      setPermissions([]);
      setSource("error");
    } finally {
      setLoading(false);
      setContextLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    const recoveryCallback = readRecoveryCallback();
    if (recoveryCallback) passwordRecoveryRef.current = true;
    const initialLoad = recoveryCallback
      ? authService.setSessionFromRecoveryTokens(recoveryCallback).then((recoverySession) => {
          if (ignore) return;
          setSession(recoverySession);
          setUser(recoverySession?.user ?? null);
          passwordRecoveryRef.current = true;
          setPasswordRecovery(true);
          setProfile(null);
          setPermissions([]);
          setSource("password-recovery");
          setLoading(false);
          setContextLoading(false);
        })
      : authService.getSession().then((initialSession) => {
          if (!ignore) loadContext(initialSession);
        });

    initialLoad
      .catch((sessionError) => {
        console.error("Unable to load auth session", sessionError);
        if (!ignore) {
          setError("Unable to load login session.");
          setLoading(false);
        }
      });

    const { data } = authService.onAuthStateChange((event, nextSession) => {
      if (ignore) return;
      if (event === "PASSWORD_RECOVERY") {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        passwordRecoveryRef.current = true;
        setPasswordRecovery(true);
        setProfile(null);
        setPermissions([]);
        setSource("password-recovery");
        setLoading(false);
        setContextLoading(false);
        return;
      }
      if (!passwordRecoveryRef.current) loadContext(nextSession);
    });

    return () => {
      ignore = true;
      data.subscription.unsubscribe();
    };
  }, []);

  async function completePasswordSetup(newPassword) {
    setError("");
    await authService.updatePassword(newPassword);
    clearAuthCallbackUrl();
    passwordRecoveryRef.current = false;
    setPasswordRecovery(false);
    const initialSession = await authService.getSession();
    await loadContext(initialSession);
  }

  async function cancelPasswordSetup() {
    clearAuthCallbackUrl();
    passwordRecoveryRef.current = false;
    setPasswordRecovery(false);
    await signOut();
  }

  useEffect(() => {
    if (!import.meta.env.DEV || loading || contextLoading || !user) return;
    console.info("[FeedX RBAC]", {
      auth_uid: user.id,
      profile_id: profile?.id ?? null,
      role_name: profile?.role_name ?? null,
      role_outlet_ids: profile?.role_outlet_ids ?? [],
      access_state: profile?.access_state ?? null,
      source,
      permission_count: permissions.length,
      permission_sample: permissions.slice(0, 20),
    });
  }, [contextLoading, loading, permissions, profile, source, user]);

  async function signIn(email, password) {
    setError("");
    try {
      const result = await authService.signInWithPassword({ email, password });
      passwordRecoveryRef.current = false;
      setPasswordRecovery(false);
      await loadContext(result.session);
      return result;
    } catch (signInError) {
      throw signInError;
    }
  }

  async function signOut() {
    passwordRecoveryRef.current = false;
    setPasswordRecovery(false);
    await authService.signOut();
    await loadContext(null);
  }

  async function changePassword({ currentPassword, newPassword }) {
    if (!user?.email) throw new Error("Current login email is not available.");
    setError("");
    await authService.signInWithPassword({ email: user.email, password: currentPassword });
    await authService.updatePassword(newPassword);
    const nextSession = await authService.getSession();
    await loadContext(nextSession);
  }

  const permissionSet = useMemo(() => new Set(permissions), [permissions]);
  const protectedRole = useMemo(() => isProtectedRoleProfile(profile), [profile]);

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      permissions,
      source,
      passwordRecovery,
      loading,
      contextLoading,
      error,
      signIn,
      signOut,
      changePassword,
      resetPassword: authService.resetPassword,
      completePasswordSetup,
      cancelPasswordSetup,
      isProtectedRole: protectedRole,
      hasPermission: (permissionCode) => protectedRole || permissionSet.has(permissionCode),
      hasAnyPermission: (permissionCodes = []) => protectedRole || permissionCodes.some((code) => permissionSet.has(code)),
    }),
    [contextLoading, error, loading, passwordRecovery, permissionSet, permissions, profile, protectedRole, session, source, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
