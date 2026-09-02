import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260902090000_factory_mesti_cleaning_of_area.sql"), "utf8");
const locationDirectMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260902132726_factory_mesti_cleaning_location_direct.sql"), "utf8");
const versionIdentityMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260902142206_factory_mesti_cleaning_requirement_version_identity.sql"), "utf8");

describe("Factory MeSTI Cleaning migration contract", () => {
  it("canonicalizes Factory Location storage eligibility without replacing the location master", () => {
    expect(migration).toContain("alter table public.factory_storage_locations");
    expect(migration).toContain("add column if not exists is_storage_location boolean not null default true");
    expect(migration).toContain("update public.factory_storage_locations");
    expect(migration).not.toContain("create table if not exists public.factory_locations");
  });

  it("stores structured requirements and immutable due occurrences", () => {
    expect(migration).toContain("create table if not exists public.factory_mesti_cleaning_requirements");
    expect(migration).toContain("recurrence_type text not null check (recurrence_type in ('daily','weekly'))");
    expect(migration).toContain("recurrence_weekdays integer[]");
    expect(migration).toContain("effective_from date not null");
    expect(migration).toContain("requirement_snapshot jsonb not null");
    expect(locationDirectMigration).toContain("create table if not exists public.factory_mesti_cleaning_requirement_locations");
    expect(locationDirectMigration).toContain("add column if not exists location_id uuid references public.factory_storage_locations");
    expect(versionIdentityMigration).toContain("logical_requirement_id uuid");
    expect(versionIdentityMigration).toContain("effective_until date");
    expect(versionIdentityMigration).toContain("factory_mesti_cleaning_occurrences_logical_location_due_key");
  });

  it("enforces completion, verification, duplicate scheduling, and self-verification boundaries in trusted RPCs", () => {
    expect(locationDirectMigration).toContain("factory_mesti_materialize_cleaning_occurrences");
    expect(versionIdentityMigration).toContain("on conflict (logical_requirement_id, location_id, due_date) do nothing");
    expect(migration).toContain("v_employee.role_id::text <> v_occurrence.requirement_snapshot->>'responsible_role_id'");
    expect(migration).toContain("v_employee.role_id::text <> v_occurrence.requirement_snapshot->>'verifier_role_id'");
    expect(migration).toContain("Self-verification is not allowed.");
    expect(migration).toContain("grant execute on function public.factory_mesti_complete_cleaning_occurrence");
    expect(migration).toContain("grant execute on function public.factory_mesti_verify_cleaning_occurrence");
  });

  it("removes the redundant Cleaning Area layer in favor of canonical Locations", () => {
    expect(locationDirectMigration).toContain("insert into public.factory_mesti_cleaning_requirement_locations");
    expect(locationDirectMigration).toContain("drop function if exists public.factory_save_mesti_cleaning_area(jsonb)");
    expect(locationDirectMigration).toContain("drop table if exists public.factory_mesti_cleaning_requirement_areas");
    expect(locationDirectMigration).toContain("drop table if exists public.factory_mesti_cleaning_areas");
    expect(locationDirectMigration).toContain("'location_name', p_location.location_name");
    expect(locationDirectMigration).not.toContain("create table if not exists public.factory_locations");
  });

  it("keeps requirement identity stable and only versions real forward-effective changes", () => {
    expect(versionIdentityMigration).toContain("pg_advisory_xact_lock");
    expect(versionIdentityMigration).toContain("factory_mesti_cleaning_requirements_one_current_version_key");
    expect(versionIdentityMigration).toContain("factory_mesti_cleaning_requirements_non_overlapping_versions");
    expect(versionIdentityMigration).toContain("v_current_location_ids = v_location_ids");
    expect(versionIdentityMigration).toContain("'version_created', v_version_created");
    expect(versionIdentityMigration).toContain("and (requirement.effective_until is null or due_date.day::date < requirement.effective_until)");
    expect(versionIdentityMigration).toContain("status = 'pending'");
  });
});
