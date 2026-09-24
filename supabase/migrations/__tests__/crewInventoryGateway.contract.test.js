import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924004820_crew_inventory_gateway.sql"), "utf8").toLowerCase();

describe("Crew Inventory Gateway authority contract", () => {
  it("adds four independent fixed and Management outlet grants, default denied", () => {
    for (const capability of ["can_perform_stock_check", "can_create_audit_stock_check", "can_manage_purchase_orders", "can_receive_purchase_orders"]) {
      expect(sql.match(new RegExp(`add column ${capability} boolean not null default false`, "g"))).toHaveLength(2);
      expect(sql).toContain(`'${capability}'`);
    }
    expect(sql).toContain("crew_authorized_outlet_ids(p_employee_id)");
    expect(sql).toContain("crew_selected_outlet(p_token,p_outlet_id)");
    expect(sql).toContain("crew_resolve_employee_outlet(p_employee_id)");
  });

  it("uses opaque Crew session and a private outlet gate for every read and command", () => {
    expect(sql).toContain("v_employee uuid:=public.crew_session_employee(p_token)");
    for (const name of ["crew_inventory_stock_checks", "crew_inventory_purchase_orders", "crew_inventory_attention",
      "crew_inventory_save_stock_check", "crew_inventory_delete_audit_draft", "crew_inventory_save_purchase_order",
      "crew_inventory_create_stock_check_purchase_orders", "crew_inventory_transition_purchase_order",
      "crew_inventory_receive_purchase_order"]) {
      expect(sql).toContain(`function public.${name}(`);
    }
    expect(sql).toContain("grant execute on function public.crew_inventory_stock_checks");
    expect(sql).toContain("to anon,authenticated");
    expect(sql).toContain("revoke all on function inventory_authority.stock_group_due");
  });

  it("delegates all mutations to foundation cores with Crew employee attribution", () => {
    for (const core of ["save_stock_check", "delete_stock_check_draft", "save_purchase_order",
      "create_stock_check_purchase_orders", "transition_purchase_order", "receive_purchase_order"]) {
      expect(sql).toContain(`inventory_authority.${core}(`);
    }
    expect(sql).toContain("(v_context->>'employee_id')::uuid,'crew'");
    expect(sql).toContain("p_action not in ('submit','confirm')");
    expect(sql).not.toContain("'cancel','complete') then");
  });
});
