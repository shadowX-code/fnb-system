import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608110001_crew_foundation.sql"), "utf8");

describe("Crew Foundation migration contract", () => {
  it("keeps Crew access separate from the Admin Auth employee identity", () => {
    expect(migration).toContain("create table if not exists public.crew_access");
    expect(migration).toContain("employee_id uuid primary key references public.employees(id)");
    expect(migration).not.toMatch(/alter table public\.employees[\s\S]*auth_user_id/);
  });

  it("stores only bcrypt passcode hashes and provides throttled one-time Crew sessions", () => {
    expect(migration).toContain("crypt(v_passcode, gen_salt('bf'))");
    expect(migration).toContain("create table if not exists public.crew_login_attempts");
    expect(migration).toContain("v_failures >= 5");
    expect(migration).toContain("create table if not exists public.crew_sessions");
    expect(migration).toContain("encode(digest(v_token, 'sha256'), 'hex')");
    expect(migration).toContain("'temporary_passcode', v_passcode");
  });

  it("keeps attendance within the Phase A mobile clock-in/out scope", () => {
    expect(migration).toContain("create table if not exists public.crew_attendance_records");
    expect(migration).toContain("crew_attendance_one_open_shift_idx");
    expect(migration).toContain("create or replace function public.crew_clock");
    expect(migration).toContain("create or replace function public.crew_my_attendance");
  });
});
