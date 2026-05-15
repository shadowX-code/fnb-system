import { supabase } from "../lib/supabase";

export const authService = {
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
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

  async getUserContext(user) {
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("*, role:roles(id,name,description)")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      throw new Error("No employee profile is linked to this login.");
    }

    if (profile.is_active === false) {
      throw new Error("Employee profile is inactive.");
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

    if (permissionsError) throw permissionsError;

    const permissions = (rows ?? []).map((row) => row.permission?.code).filter(Boolean);

    if (!permissions.length) {
      return {
        profile: { ...profile, role_name: profile.role?.name ?? "unassigned" },
        permissions: [],
        source: "role-without-permissions",
      };
    }

    return {
      profile: { ...profile, role_name: profile.role?.name ?? "unassigned" },
      permissions,
      source: "database",
    };
  },
};
