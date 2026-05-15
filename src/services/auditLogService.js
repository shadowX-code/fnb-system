import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

function mapAudit(row) {
  return {
    id: row.id,
    actor: row.user_name || row.actor || "System",
    actorRole: row.metadata?.actor_role || row.actor_role || "",
    action: row.action,
    module: row.module,
    target: row.metadata?.target || row.target || row.description || "-",
    outlet: row.metadata?.outlet || row.outlet || "-",
    before: row.metadata?.before ?? row.before ?? null,
    after: row.metadata?.after ?? row.after ?? null,
    timestamp: row.created_at || row.timestamp,
    ip: row.metadata?.ip || row.ip || "-",
    device: row.metadata?.device || row.device || "-",
    metadata: row.description || row.metadata?.message || "",
  };
}

export const auditLogService = {
  async listAuditLogs() {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id,action,module,user_id,user_name,description,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(250);

    throwSupabaseError("audit_logs.list", error);
    return (data ?? []).map(mapAudit);
  },

  async createAuditLog({ action, module, target, description, before = null, after = null, outlet = "-", metadata = {} }) {
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      action,
      module,
      user_id: userData?.user?.id ?? null,
      user_name: userData?.user?.user_metadata?.full_name || userData?.user?.email || "System",
      description: description || target || action,
      metadata: { ...metadata, target, outlet, before, after },
    };
    const { data, error } = await supabase
      .from("audit_logs")
      .insert(payload)
      .select("id,action,module,user_id,user_name,description,metadata,created_at")
      .single();

    throwSupabaseError("audit_logs.insert", error);
    return mapAudit(data);
  },
};
