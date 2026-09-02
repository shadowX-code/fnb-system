import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903110000_factory_mesti_calibration.sql"), "utf8");
const scheduleProjectionFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903113000_factory_mesti_calibration_schedule_projection_fix.sql"), "utf8");
const verificationOrderFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903114000_factory_mesti_calibration_verification_order_fix.sql"), "utf8");
const stagingLifecycle = readFileSync(resolve(process.cwd(), "scripts/verifyFactoryMestiCalibrationLifecycleStaging.sql"), "utf8");

describe("Factory MeSTI Calibration migration contract", () => {
  it("keeps one logical requirement version current and blocks duplicate active equipment/type", () => {
    expect(migration).toContain("logical_requirement_id uuid not null default gen_random_uuid()");
    expect(migration).toContain("factory_mesti_calibration_current_requirement_key");
    expect(migration).toContain("factory_mesti_calibration_requirement_effective_range_no_overlap");
    expect(migration).toContain("factory_mesti_calibration_current_equipment_type_key");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'version_created',false");
  });

  it("makes verified Pass the only calibration result that renews validity", () => {
    expect(migration).toContain("and result='pass'");
    expect(migration).toContain("latest_pass.calibrated_date last_calibration");
    expect(migration).toContain("when last_result='fail' then 'failed'");
    expect(migration).toContain("Scheduled Due no longer matches the canonical calibration schedule.");
    expect(migration).toContain("unique(requirement_id,scheduled_due_date,calibrated_date)");
    expect(scheduleProjectionFix).toContain("select r.*,e.equipment_code");
    expect(verificationOrderFix).toContain("clock_timestamp()");
  });

  it("enforces trusted role-aware record and verification flows with immutable snapshots", () => {
    expect(migration).toContain("equipment_snapshot jsonb not null");
    expect(migration).toContain("Your role is not authorized to record calibration.");
    expect(migration).toContain("Your role is not authorized to verify calibration.");
    expect(migration).toContain("Self-verification is not allowed.");
    expect(migration).toContain("Missing calibration view permission.");
    expect(migration).toContain("grant execute on function public.factory_mesti_calibration_schedule() to authenticated");
  });

  it("keeps rollback-only Staging lifecycle QA over authenticated RPC and RLS paths", () => {
    expect(stagingLifecycle).toContain("begin;");
    expect(stagingLifecycle).toContain("set local role authenticated");
    expect(stagingLifecycle).toContain("factory_save_mesti_calibration_requirement");
    expect(stagingLifecycle).toContain("factory_mesti_record_calibration");
    expect(stagingLifecycle).toContain("factory_mesti_verify_calibration");
    expect(stagingLifecycle).toContain("month-end or leap-year due calculation");
    expect(stagingLifecycle).toContain("rollback;");
  });
});
