import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924070000_crew_purchase_order_reopen_draft.sql"), "utf8").toLowerCase();

describe("Submitted PO return-to-Draft authority", () => {
  it("uses the existing transaction, request identity and row lock before state validation", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("payload_fingerprint=v_fingerprint");
    expect(sql).toContain("from public.inventory_purchase_orders where id=p_order_id for update");
    expect(sql).toContain("v_order.outlet_id is distinct from p_scope_outlet");
    expect(sql).toContain("operation='purchase_order_transition'");
  });

  it("allows only unconfirmed, unreceived Submitted orders and preserves their identity", () => {
    expect(sql).toContain("if v_order.status<>'submitted'");
    expect(sql).toContain("v_order.confirmed_at is not null");
    expect(sql).toContain("from public.inventory_purchase_receipts where purchase_order_id=p_order_id");
    expect(sql).toContain("received_qty>0");
    expect(sql).toContain("set status='draft',submitted_at=null,updated_at=v_now");
    expect(sql).toContain("where id=p_order_id returning * into v_order");
  });

  it("uses existing Admin edit and Crew manage authority and appends truthful audit", () => {
    expect(sql).toContain("current_user_has_permission('inventory_orders.edit')");
    expect(sql).toContain("crew_scope(p_token,p_outlet_id,'can_manage_purchase_orders')");
    expect(sql).toContain("p_action not in ('submit','confirm','reopen_draft')");
    expect(sql).toContain("'previous_status',v_previous_status");
    expect(sql).toContain("'previous_submitted_at',v_previous_submitted_at");
    expect(sql).toContain("'actor_employee_id',p_actor_employee");
    expect(sql).toContain("insert into public.audit_logs");
  });
});
