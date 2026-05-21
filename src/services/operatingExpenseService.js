import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

const selectFields = "id,outlet_id,year,month,amount,remark,created_by,updated_by,created_at,updated_at";

function logOperatingExpenseQuery(operation, permission, context = {}) {
  if (!import.meta.env.DEV) return;
  console.info("[Supabase:operating_expenses.query]", { operation, permission, ...context });
}

export const operatingExpenseService = {
  async listOperatingExpenses() {
    logOperatingExpenseQuery("select:list_all", "operating_expenses.view");
    const { data, error } = await supabase
      .from("operating_expenses")
      .select(selectFields)
      .order("year", { ascending: true })
      .order("month", { ascending: true });

    throwSupabaseError("operating_expenses.list_all", error);
    return data ?? [];
  },

  async getOperatingExpense(outletId, year, month) {
    logOperatingExpenseQuery("select:period", "operating_expenses.view", { outletId, year, month });
    const { data, error } = await supabase
      .from("operating_expenses")
      .select(selectFields)
      .eq("outlet_id", outletId)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    throwSupabaseError("operating_expenses.get_period", error);
    return data ?? null;
  },

  async saveOperatingExpense({ outletId, year, month, amount, remark = "" }) {
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      outlet_id: outletId,
      year: Number(year),
      month: Number(month),
      amount: Number(amount) || 0,
      remark,
      updated_by: userData?.user?.id ?? null,
      updated_at: new Date().toISOString(),
    };

    logOperatingExpenseQuery("upsert:period", "operating_expenses.create/edit", { outletId, year, month });
    const { data, error } = await supabase
      .from("operating_expenses")
      .upsert(payload, { onConflict: "outlet_id,year,month" })
      .select(selectFields)
      .single();

    throwSupabaseError("operating_expenses.upsert_period", error);

    await auditLogService.createAuditLog({
      action: "operating_expense_updated",
      module: "operating_expenses",
      target: `${month}/${year} operating expense`,
      description: "Monthly operating expense saved.",
      outlet: outletId,
      after: { amount: data.amount, remark: data.remark },
    }).catch(() => {});

    return data;
  },

  async deleteOperatingExpense(id) {
    logOperatingExpenseQuery("delete:row", "operating_expenses.delete", { id });
    const { error } = await supabase
      .from("operating_expenses")
      .delete()
      .eq("id", id);

    throwSupabaseError("operating_expenses.delete", error);

    await auditLogService.createAuditLog({
      action: "operating_expense_deleted",
      module: "operating_expenses",
      target: id,
      description: "Monthly operating expense deleted.",
    }).catch(() => {});
  },
};
