import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authService } from "./authService.js";
import { allPermissionCodes } from "../features/company-users/data/rbacDefaults.js";

const AuthContext = createContext(null);
const DEV_BYPASS_AUTH = import.meta.env.DEV === true && import.meta.env.VITE_DEV_BYPASS_AUTH === "true";
const DEV_USER = {
  id: "dev-user",
  email: "dev@feedx.local",
  user_metadata: { full_name: "Development Owner" },
  email_confirmed_at: new Date().toISOString(),
};
const DEV_PROFILE = {
  id: DEV_USER.id,
  full_name: "Development Owner",
  email: DEV_USER.email,
  role_name: "owner",
  is_active: true,
  email_verified: true,
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [source, setSource] = useState("loading");
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
      setError("Unable to load your access permissions. Please contact admin.");
      setProfile(null);
      setPermissions([]);
      setSource("error");
    } finally {
      setLoading(false);
      setContextLoading(false);
    }
  }

  useEffect(() => {
    if (DEV_BYPASS_AUTH) {
      setSession({ user: DEV_USER, access_token: "dev-bypass" });
      setUser(DEV_USER);
      setProfile(DEV_PROFILE);
      setPermissions(allPermissionCodes);
      setSource("dev-bypass");
      setLoading(false);
      setContextLoading(false);
      return undefined;
    }

    let ignore = false;
    authService.getSession()
      .then((initialSession) => {
        if (!ignore) loadContext(initialSession);
      })
      .catch((sessionError) => {
        console.error("Unable to load auth session", sessionError);
        if (!ignore) {
          setError("Unable to load login session.");
          setLoading(false);
        }
      });

    const { data } = authService.onAuthStateChange((_event, nextSession) => {
      if (!ignore) loadContext(nextSession);
    });

    return () => {
      ignore = true;
      data.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email, password) {
    setError("");
    const result = await authService.signInWithPassword({ email, password });
    await loadContext(result.session);
    return result;
  }

  async function signOut() {
    if (DEV_BYPASS_AUTH) return;
    await authService.signOut();
    await loadContext(null);
  }

  const permissionSet = useMemo(() => new Set(permissions), [permissions]);

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      permissions,
      source,
      loading,
      contextLoading,
      error,
      signIn,
      signOut,
      resetPassword: authService.resetPassword,
      hasPermission: (permissionCode) => permissionSet.has(permissionCode),
      hasAnyPermission: (permissionCodes = []) => permissionCodes.some((code) => permissionSet.has(code)),
    }),
    [contextLoading, error, loading, permissionSet, permissions, profile, session, source, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
