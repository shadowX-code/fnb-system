import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
const sql=fs.readFileSync(path.resolve(process.cwd(),"supabase/migrations/202608100015_role_configuration_trusted_authority.sql"),"utf8");
describe("Role configuration trusted authority migration",()=>{it("defines one authenticated, locked, idempotent snapshot boundary with explicit delegation checks",()=>{for(const token of ["role_configuration_requests","save_role_configuration","auth.uid()","current_user_has_role_management_permission","current_user_can_assign_permission","current_user_can_access_outlet","pg_advisory_xact_lock","payload_fingerprint","role_permissions","role_outlets"])expect(sql).toContain(token);});});
