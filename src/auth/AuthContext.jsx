import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authService } from "./authService.js";

const AuthContext = createContext(null);

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

  useEffect(() => {
    if (!import.meta.env.DEV || loading || contextLoading || !user) return;
    console.info("[FeedX RBAC]", {
      auth_uid: user.id,
      profile_id: profile?.id ?? null,
      role_name: profile?.role_name ?? null,
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
      await loadContext(result.session);
      return result;
    } catch (signInError) {
      throw signInError;
    }
  }

  async function signOut() {
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
