import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name) => readFileSync(resolve(process.cwd(), `supabase/migrations/${name}`), "utf8");
const scopeSql = read("20260922192301_crew_management_operational_scope.sql");
const accessSql = read("20260923152133_crew_management_special_access_outlets.sql");
const roleScopeSql = read("20260921180000_factory_employee_workplace_role_outlet_scope.sql");
const assetCreateSql = read("20260917124812_crew_asset_creation_special_access.sql");
const assetDetailsSql = read("20260919143000_crew_asset_manage_details.sql");
const inspectionSql = read("20260917211500_crew_asset_inspection_result_updates.sql");
const cashSql = read("20260826130618_crew_access_cash_handover_capability.sql");

const functionBody = (sql, name) => {
  const signatureIndex = sql.toLowerCase().indexOf(`function public.${name.toLowerCase()}(`);
  if (signatureIndex < 0) return "";
  const start = sql.toLowerCase().lastIndexOf("create", signatureIndex);
  const next = sql.toLowerCase().indexOf("\ncreate ", signatureIndex);
  return sql.slice(start, next < 0 ? undefined : next);
};

describe("Management Crew outlet and Special Access enforcement", () => {
  it("derives all/selected/none from the current Role and rejects stale or unauthorized outlet IDs", () => {
    const authorized = functionBody(scopeSql, "crew_authorized_outlet_ids");
    const selected = functionBody(scopeSql, "crew_selected_outlet");

    expect(roleScopeSql).toContain("check (outlet_access_type in ('all', 'selected', 'none'))");
    expect(authorized).toContain("v_role.outlet_access_type='all'");
    expect(authorized).toContain("where o.is_active order by o.name,o.id");
    expect(authorized).toContain("v_role.outlet_access_type='none'");
    expect(authorized).toContain("where ro.role_id=v_role.id and o.is_active");
    expect(authorized).toContain("return array(select o.id from public.role_outlets ro join public.outlets o on o.id=ro.outlet_id");
    expect(authorized).toContain("select * into v_employee from public.employees where id=p_employee_id");
    expect(authorized).toContain("select * into v_role from public.roles where id=v_employee.role_id and is_active");
    expect(selected).toContain("p_outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id))");
    expect(selected).toContain("raise exception using errcode='42501'");
  });

  it("scopes Management Special Access rows to currently authorized employee/outlet pairs while preserving fixed-outlet flags", () => {
    expect(accessSql).toContain("primary key (employee_id, outlet_id)");
    expect(accessSql).toContain("where employee_id=p_employee_id and outlet_id=p_outlet_id");
    expect(accessSql).toContain("if v_access.primary_outlet_id is distinct from p_outlet_id");
    expect(accessSql).toContain("v_access.can_initiate_handover");
    expect(accessSql).toContain("v_access.can_add_assets");
    expect(accessSql).toContain("v_access.can_manage_asset_details");
    expect(accessSql).toContain("v_access.can_adjust_assets");
    expect(accessSql).toContain("v_access.can_perform_asset_inspections");

    const adminRead = functionBody(accessSql, "crew_management_special_access_admin");
    const adminWrite = functionBody(accessSql, "crew_update_management_special_access");
    expect(adminRead).toContain("o.id=any(public.crew_authorized_outlet_ids(p_employee_id))");
    expect(adminRead).toContain("public.current_user_can_access_outlet(o.id)");
    expect(adminWrite).toContain("p_outlet_id=any(public.crew_authorized_outlet_ids(p_employee_id))");
    expect(adminWrite).toContain("not public.current_user_can_access_outlet(p_outlet_id)");
  });

  it("revalidates Role scope at each Asset action and delegates each distinct grant to its canonical authority", () => {
    const actions = [
      ["crew_management_asset_create", "crew_asset_create"],
      ["crew_management_asset_update_details", "crew_asset_update_details"],
      ["crew_management_asset_adjust", "crew_asset_adjust"],
      ["crew_management_asset_submit_inspection", "crew_asset_submit_inspection"],
    ];
    for (const [managementName, canonicalName] of actions) {
      const wrapper = functionBody(accessSql, managementName);
      expect(wrapper, `${managementName} wrapper`).toContain("crew_management_asset_scope(p_token,p_outlet_id)");
      expect(wrapper, `${managementName} delegates`).toContain(`public.${canonicalName}(p_token`);
    }

    expect(assetCreateSql).toContain("if not coalesce((v_context->>'can_add_assets')::boolean,false) then raise exception");
    expect(assetDetailsSql).toContain("if not coalesce((v_context->>'can_manage_asset_details')::boolean,false) then raise exception");
    expect(assetCreateSql).toContain("if not coalesce((v_context->>'can_adjust_assets')::boolean,false) then raise exception");
    expect(inspectionSql).toContain("if not coalesce((v_context->>'can_perform_asset_inspections')::boolean,false) then");
    expect(accessSql).toContain("perform public.crew_special_access_for_outlet(v_employee_id,p_outlet_id)");
  });

  it("requires both current Role membership and the outlet Cash grant without changing deposit authority", () => {
    const canHandover = functionBody(accessSql, "crew_can_initiate_cash_handover");
    const cashScope = functionBody(accessSql, "crew_management_cash_scope");
    const managementCollection = functionBody(accessSql, "crew_management_cash_record_collection");
    const collection = functionBody(cashSql, "crew_cash_record_collection");

    expect(canHandover).toContain("p_outlet_id=any(public.crew_authorized_outlet_ids(e.id))");
    expect(canHandover).toContain("g.employee_id=e.id and g.outlet_id=p_outlet_id and g.can_initiate_handover");
    expect(cashScope).toContain("public.crew_can_initiate_cash_handover(v_employee_id,p_outlet_id)");
    expect(cashScope).toContain("perform public.crew_selected_outlet(p_token,p_outlet_id)");
    expect(managementCollection).toContain("crew_management_cash_scope(p_token,p_outlet_id)");
    expect(managementCollection).toContain("public.crew_cash_record_collection(p_token,p_payload)");
    expect(collection).toContain("crew_can_initiate_cash_handover(employee,outlet)");
    expect(collection).toContain("crew_cash_balance(outlet)");
    expect(collection).toContain("crew_cash_receiver_is_eligible(outlet,receiver)");
  });
});
