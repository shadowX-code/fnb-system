import { supabase } from "../lib/supabase";
import { EMPLOYEE_ACCESS_STATE, normalizeEmployeeAccessState } from "../constants/employeeAccessStates";
import { isProtectedRoleName } from "./rbac.js";

const roleSelectWithOutletAccess = "*, role:roles(id,name,description,outlet_access_type)";
const roleSelectFallback = "*, role:roles(id,name,description)";

function isMissingOutletAccessColumnError(error) {
  const message = String(error?.message ?? error?.details ?? "");
  return message.includes("outlet_access_type") || message.includes("Could not find") || error?.code === "PGRST200" || error?.code === "PGRST204";
}

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

  const queryProfile = (select) => supabase
    .from("employees")
    .select(select)
    .or(filters.join(","))
    .maybeSingle();

  let { data, error } = await queryProfile(roleSelectWithOutletAccess);
  if (error && isMissingOutletAccessColumnError(error)) {
    console.warn("[FeedX auth] Falling back to role profile without outlet_access_type. Apply the latest RBAC migration to enable explicit outlet scope.");
    ({ data, error } = await queryProfile(roleSelectFallback));
  }
  if (error) throw error;
  return data ? normalizeContextProfile(data, "employees") : null;
}

async function activateEmployeeProfile(profile, user) {
  if (!profile?.enable_system_login || profile.access_state === EMPLOYEE_ACCESS_STATE.NO_ACCESS) return profile;
  if (profile.access_state === EMPLOYEE_ACCESS_STATE.DISABLED) return profile;

  const queryProfile = (select) => supabase
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
    .select(select)
    .single();

  let { data, error } = await queryProfile(roleSelectWithOutletAccess);
  if (error && isMissingOutletAccessColumnError(error)) {
    console.warn("[FeedX auth] Falling back to activation profile without outlet_access_type.");
    ({ data, error } = await queryProfile(roleSelectFallback));
  }
  if (error) {
    console.error("Unable to activate employee login", error);
    return profile;
  }

  return normalizeContextProfile(data, "employees");
}

async function loadLegacyUserProfile(user) {
  const queryProfile = (select) => supabase
    .from("user_profiles")
    .select(select)
    .eq("id", user.id)
    .maybeSingle();

  let { data, error } = await queryProfile(roleSelectWithOutletAccess);
  if (error && isMissingOutletAccessColumnError(error)) {
    console.warn("[FeedX auth] Falling back to legacy profile without outlet_access_type.");
    ({ data, error } = await queryProfile(roleSelectFallback));
  }
  if (error) throw error;
  return data ? normalizeContextProfile(data, "user_profiles") : null;
}

async function loadRoleOutletIds(roleId) {
  if (!roleId) return [];
  const { data, error } = await supabase
    .from("role_outlets")
    .select("outlet_id")
    .eq("role_id", roleId);

  if (error) {
    console.error("Unable to load role outlet access", error);
    throw new Error("Unable to load outlet access.");
  }

  return (data ?? []).map((row) => row.outlet_id).filter(Boolean);
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
    const roleOutletAccessType = String(profile.role?.outlet_access_type || "").toLowerCase();
    let roleOutletIds = [];
    let outletScopeError = "";
    if (!isProtectedRoleName(roleName) && !["all", "all_outlets"].includes(roleOutletAccessType)) {
      try {
        roleOutletIds = await loadRoleOutletIds(profile.role_id);
      } catch (error) {
        console.error("Unable to load outlet scope. Continuing with no selected outlets.", error);
        outletScopeError = "Unable to load outlet scope.";
      }
    }
    const roleHasAllOutletAccess = isProtectedRoleName(roleName)
      || ["all", "all_outlets"].includes(roleOutletAccessType)
      || (!["selected", "selected_outlets"].includes(roleOutletAccessType) && roleOutletIds.length === 0);
    const profileWithScope = {
      ...profile,
      role_name: roleName,
      role_outlet_access_type: roleHasAllOutletAccess ? "all" : "selected",
      role_outlet_ids: roleOutletIds,
      role_outlet_scope_error: outletScopeError,
      role: profile.role ? { ...profile.role, outlet_access_type: roleHasAllOutletAccess ? "all" : "selected", outlet_ids: roleOutletIds } : profile.role,
    };

    if (isProtectedRoleName(roleName)) {
      return {
        profile: profileWithScope,
        permissions,
        source: "database",
      };
    }

    if (!permissions.length) {
      return {
        profile: profileWithScope,
        permissions: [],
        source: "role-without-permissions",
      };
    }

    return {
      profile: profileWithScope,
      permissions,
      source: "database",
    };
  },
};
