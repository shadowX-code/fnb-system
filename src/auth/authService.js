import { supabase } from "../lib/supabase";
import { EMPLOYEE_ACCESS_STATE, normalizeEmployeeAccessState } from "../constants/employeeAccessStates";
import { isProtectedRoleName } from "./rbac.js";

function normalizeContextProfile(profile, source) {
  const enableSystemLogin = Boolean(profile.enable_system_login ?? profile.email ?? profile.role_id);
  const accessState = normalizeEmployeeAccessState(profile.access_state, enableSystemLogin);
  return {
    ...profile,
    source,
    access_state: accessState,
    role_name: profile.role?.name ?? profile.role_name ?? "unassigned",
  };
}

async function loadEmployeeProfile(user) {
  const email = String(user.email ?? "").trim().toLowerCase();
  const filters = [`auth_user_id.eq.${user.id}`, `id.eq.${user.id}`];
  if (email) filters.push(`email.eq.${email}`);

  const { data, error } = await supabase
    .from("employees")
    .select("*, role:roles(id,name,description)")
    .or(filters.join(","))
    .maybeSingle();

  if (error) throw error;
  return data ? normalizeContextProfile(data, "employees") : null;
}

async function activateEmployeeProfile(profile, user) {
  if (!profile?.enable_system_login || profile.access_state === EMPLOYEE_ACCESS_STATE.NO_ACCESS) return profile;
  if (profile.access_state === EMPLOYEE_ACCESS_STATE.DISABLED) return profile;

  const { data, error } = await supabase
    .from("employees")
    .update({
      auth_user_id: user.id,
      access_state: EMPLOYEE_ACCESS_STATE.ACTIVE,
      email_verified: true,
      is_active: true,
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id)
    .select("*, role:roles(id,name,description)")
    .single();

  if (error) {
    console.error("Unable to activate employee login", error);
    return profile;
  }

  return normalizeContextProfile(data, "employees");
}

async function loadLegacyUserProfile(user) {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*, role:roles(id,name,description)")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizeContextProfile(data, "user_profiles") : null;
}

export const authService = {
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  async setSessionFromRecoveryTokens({ accessToken, refreshToken }) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return data.session;
  },

  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
  },

  async signInWithPassword({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  },

  async updatePassword(password) {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    return data;
  },

  async getUserContext(user) {
    let profile = await loadEmployeeProfile(user) ?? await loadLegacyUserProfile(user);

    if (!profile) {
      throw new Error("No employee profile is linked to this login.");
    }

    if (profile.source === "employees") {
      profile = await activateEmployeeProfile(profile, user);
    }

    if (profile.is_active === false || profile.access_state === EMPLOYEE_ACCESS_STATE.DISABLED) {
      throw new Error("Employee profile is inactive.");
    }

    if (profile.access_state !== EMPLOYEE_ACCESS_STATE.ACTIVE) {
      throw new Error("Employee system access is not active.");
    }

    if (!profile.role_id) {
      return {
        profile: { ...profile, role_name: "unassigned" },
        permissions: [],
        source: "profile-without-role",
      };
    }

    const { data: rows, error: permissionsError } = await supabase
      .from("role_permissions")
      .select("permission:permissions(code,module,description)")
      .eq("role_id", profile.role_id);

    if (permissionsError) {
      console.error("Unable to load role permissions", permissionsError);
      throw new Error("Unable to load role permissions.");
    }

    const permissions = (rows ?? []).map((row) => row.permission?.code).filter(Boolean);
    const roleName = profile.role?.name ?? "unassigned";

    if (isProtectedRoleName(roleName)) {
      return {
        profile: { ...profile, role_name: roleName },
        permissions,
        source: "database",
      };
    }

    if (!permissions.length) {
      return {
        profile: { ...profile, role_name: roleName },
        permissions: [],
        source: "role-without-permissions",
      };
    }

    return {
      profile: { ...profile, role_name: roleName },
      permissions,
      source: "database",
    };
  },
};
