import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function mapTaxConfig(row) {
  return {
    id: row.id,
    outlet_id: row.outlet_id,
    tax_type: row.tax_type || "SST",
    enabled: Boolean(row.enabled),
    rate: Number(row.rate) || 0,
    effective_from: row.effective_from,
    effective_until: row.effective_until ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function previousMonthKey(value) {
  const date = new Date(`${value}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const outletTaxConfigService = {
  async listOutletTaxConfigs() {
    const { data, error } = await supabase
      .from("outlet_tax_configs")
      .select("id,outlet_id,tax_type,enabled,rate,effective_from,effective_until,created_at,updated_at")
      .order("outlet_id", { ascending: true })
      .order("tax_type", { ascending: true })
      .order("effective_from", { ascending: true });

    throwSupabaseError("outlet_tax_configs.list", error);
    return (data ?? []).map(mapTaxConfig);
  },

  async saveOutletTaxConfig(values) {
    const payload = {
      outlet_id: values.outlet_id,
      tax_type: values.tax_type || "SST",
      enabled: Boolean(values.enabled),
      rate: Boolean(values.enabled) ? Number(values.rate) || 0 : 0,
      effective_from: values.effective_from,
      effective_until: values.effective_until || null,
      updated_at: new Date().toISOString(),
    };

    if (!values.id && !values.sourceId) {
      const scoped = await this.listOutletTaxConfigs();
      const latest = scoped
        .filter((config) => config.outlet_id === payload.outlet_id && config.tax_type === payload.tax_type)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];

      if (latest && payload.effective_from > latest.effective_from && !latest.effective_until) {
        const { error: closeError } = await supabase
          .from("outlet_tax_configs")
          .update({ effective_until: previousMonthKey(payload.effective_from), updated_at: new Date().toISOString() })
          .eq("id", latest.id);
        throwSupabaseError("outlet_tax_configs.close_previous", closeError);
      }
    }

    const id = values.sourceId || values.id;
    const query = id
      ? supabase.from("outlet_tax_configs").update(payload).eq("id", id)
      : supabase.from("outlet_tax_configs").insert(payload);

    const { data, error } = await query
      .select("id,outlet_id,tax_type,enabled,rate,effective_from,effective_until,created_at,updated_at")
      .single();

    throwSupabaseError("outlet_tax_configs.save", error);

    await auditLogService.createAuditLog({
      action: id ? "tax_setting_updated" : "tax_setting_created",
      module: "tax-settings",
      target: `${data.tax_type} ${data.effective_from}`,
      description: id ? "Tax setting updated." : "Tax setting created.",
      outlet: data.outlet_id,
      after: data,
    }).catch(() => {});

    return mapTaxConfig(data);
  },

  async endOutletTaxConfig(configId, effectiveUntil) {
    const { data, error } = await supabase
      .from("outlet_tax_configs")
      .update({ effective_until: effectiveUntil, updated_at: new Date().toISOString() })
      .eq("id", configId)
      .select("id,outlet_id,tax_type,enabled,rate,effective_from,effective_until,created_at,updated_at")
      .single();

    throwSupabaseError("outlet_tax_configs.end", error);

    await auditLogService.createAuditLog({
      action: "tax_setting_ended",
      module: "tax-settings",
      target: `${data.tax_type} ${data.effective_from}`,
      description: "Tax setting ended.",
      outlet: data.outlet_id,
      after: data,
    }).catch(() => {});

    return mapTaxConfig(data);
  },
};
