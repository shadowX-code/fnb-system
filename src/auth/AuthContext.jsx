import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authService } from "./authService.js";
import { allPermissionCodes, rolePermissionMatrix } from "../features/company-users/data/rbacDefaults.js";
import { EMPLOYEE_ACCESS_STATE, normalizeEmployeeAccessState } from "../constants/employeeAccessStates.js";

const AuthContext = createContext(null);
const DEV_BYPASS_AUTH = import.meta.env.DEV === true && import.meta.env.VITE_DEV_BYPASS_AUTH === "true";
const TEMP_AUTH_KEY = "feedx.temp_auth_accounts";
const TEMP_SESSION_KEY = "feedx.temp_auth_session";
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

function readTempAccounts() {
  try {
    return JSON.parse(localStorage.getItem(TEMP_AUTH_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeTempAccounts(accounts) {
  localStorage.setItem(TEMP_AUTH_KEY, JSON.stringify(accounts));
}

function getTempPermissions(roleName) {
  return rolePermissionMatrix[roleName] ?? rolePermissionMatrix.staff ?? [];
}

function tempAccountToContext(account) {
  const user = {
    id: account.id,
    email: account.email,
    user_metadata: { full_name: account.full_name },
    email_confirmed_at: new Date().toISOString(),
  };
  return {
    session: { user, access_token: "temporary-development-login" },
    user,
    profile: {
      id: account.id,
      full_name: account.full_name,
      nickname: account.nickname,
      email: account.email,
      role_name: account.role_name,
      is_active: normalizeEmployeeAccessState(account.access_state, true) !== EMPLOYEE_ACCESS_STATE.DISABLED,
      email_verified: true,
      temporary_password_active: Boolean(account.must_reset_password),
    },
    permissions: getTempPermissions(account.role_name),
    source: "temporary-password",
  };
}

function findTempAccount(email) {
  return readTempAccounts().find((account) => account.email.toLowerCase() === String(email).trim().toLowerCase());
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [source, setSource] = useState("loading");
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(false);
  const [error, setError] = useState("");
  const [requiresPasswordReset, setRequiresPasswordReset] = useState(false);

  function loadTempContext(account) {
    const context = tempAccountToContext(account);
    setSession(context.session);
    setUser(context.user);
    setProfile(context.profile);
    setPermissions(context.permissions);
    setSource(context.source);
    setRequiresPasswordReset(Boolean(account.must_reset_password));
    setError("");
    setLoading(false);
    setContextLoading(false);
  }

  async function loadContext(nextSession) {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setError("");

    if (!nextSession?.user) {
      setProfile(null);
      setPermissions([]);
      setSource("anonymous");
      setRequiresPasswordReset(false);
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
      setRequiresPasswordReset(false);
    } catch (loadError) {
      console.error("Unable to load user context", loadError);
      setError("Unable to load your access permissions. Please contact admin.");
      setProfile(null);
      setPermissions([]);
      setSource("error");
      setRequiresPasswordReset(false);
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
      setRequiresPasswordReset(false);
      setLoading(false);
      setContextLoading(false);
      return undefined;
    }

    const tempSessionEmail = localStorage.getItem(TEMP_SESSION_KEY);
    const tempAccount = tempSessionEmail ? findTempAccount(tempSessionEmail) : null;
    if (tempAccount) {
      loadTempContext(tempAccount);
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
    const tempAccount = findTempAccount(email);
    if (tempAccount && tempAccount.password === password) {
      if (normalizeEmployeeAccessState(tempAccount.access_state, true) === EMPLOYEE_ACCESS_STATE.DISABLED) {
        throw new Error("System access is disabled for this employee.");
      }
      localStorage.setItem(TEMP_SESSION_KEY, tempAccount.email);
      loadTempContext(tempAccount);
      return { session: tempAccountToContext(tempAccount).session };
    }
    try {
      const result = await authService.signInWithPassword({ email, password });
      await loadContext(result.session);
      return result;
    } catch (signInError) {
      if (tempAccount) throw new Error("Temporary password is incorrect.");
      throw signInError;
    }
  }

  async function signOut() {
    if (DEV_BYPASS_AUTH) return;
    localStorage.removeItem(TEMP_SESSION_KEY);
    setRequiresPasswordReset(false);
    await authService.signOut();
    await loadContext(null);
  }

  function createTemporaryLogin(employee, temporaryPassword) {
    // TODO: Production mode will use Supabase inviteUserByEmail, SMTP,
    // branded invitation email, and password setup links instead of this
    // local development credential store.
    const email = String(employee.email || "").trim().toLowerCase();
    if (!email) throw new Error("Email is required to create temporary login.");
    const accounts = readTempAccounts();
    const nextAccount = {
      id: employee.id || crypto.randomUUID(),
      email,
      password: temporaryPassword,
      full_name: employee.full_name,
      nickname: employee.nickname,
      role_name: employee.role || employee.role_name || "staff",
      access_state: EMPLOYEE_ACCESS_STATE.INVITED,
      must_reset_password: true,
      created_at: new Date().toISOString(),
    };
    writeTempAccounts([nextAccount, ...accounts.filter((account) => account.email.toLowerCase() !== email)]);
    return nextAccount;
  }

  function completeTemporaryPasswordReset(newPassword) {
    const email = user?.email;
    if (!email) throw new Error("No temporary login session found.");
    const accounts = readTempAccounts();
    const account = accounts.find((item) => item.email.toLowerCase() === email.toLowerCase());
    if (!account) throw new Error("Temporary account was not found.");
    const updated = { ...account, password: newPassword, must_reset_password: false, access_state: EMPLOYEE_ACCESS_STATE.ACTIVE, updated_at: new Date().toISOString() };
    writeTempAccounts([updated, ...accounts.filter((item) => item.email.toLowerCase() !== email.toLowerCase())]);
    localStorage.setItem(TEMP_SESSION_KEY, updated.email);
    loadTempContext(updated);
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
      requiresPasswordReset,
      signIn,
      signOut,
      createTemporaryLogin,
      completeTemporaryPasswordReset,
      resetPassword: authService.resetPassword,
      hasPermission: (permissionCode) => permissionSet.has(permissionCode),
      hasAnyPermission: (permissionCodes = []) => permissionCodes.some((code) => permissionSet.has(code)),
    }),
    [contextLoading, error, loading, permissionSet, permissions, profile, requiresPasswordReset, session, source, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
