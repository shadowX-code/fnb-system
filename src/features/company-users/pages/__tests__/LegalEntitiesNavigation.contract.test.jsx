import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSidebarSections, moduleRegistry } from "../../../../../config/modules.ts";
import { routeDetails } from "../../../../app/routes.jsx";
import LegalEntitiesPage from "../LegalEntitiesPage.jsx";
import UsersPage from "../UsersPage.jsx";

const usersPageSource = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/UsersPage.jsx"), "utf8");
const legalEntitiesPageSource = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/LegalEntitiesPage.jsx"), "utf8");
const migrationSource = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921130551_legal_entity_people_module.sql"), "utf8");

describe("Legal Entities People module", () => {
  it("registers Legal Entities directly after Employees with its canonical permission codes", () => {
    const people = getSidebarSections("restaurant").find((section) => section.label === "People");
    expect(people.items.map((item) => item.id).slice(0, 6)).toEqual([
      "employees", "legal-entities", "employee_compliance", "job-positions", "departments", "roles",
    ]);
    expect(moduleRegistry.find((module) => module.id === "legal-entities")?.permissions).toEqual({ view: true, manage: true });
    expect(routeDetails["legal-entities"]?.component).toBe(LegalEntitiesPage);
  });

  it("keeps employee Legal Employer selection but removes the Employees-page Legal Entities manager", () => {
    expect(UsersPage).toBeTypeOf("function");
    expect(usersPageSource).toContain("legalEntities={legalEntities}");
    expect(usersPageSource).not.toContain("LegalEntitiesModal");
  });

  it("uses the existing Legal Entity authority and exposes only server-derived link counts", () => {
    expect(migrationSource).toContain("create or replace function public.legal_entity_list()");
    expect(migrationSource).toContain("count(e.id)");
    expect(migrationSource).toContain("current_user_has_permission('legal_entities.view')");
    expect(migrationSource).not.toContain("alter table public.employees");
  });

  it("uses direct Legal Entity row actions without an overflow-menu dependency", () => {
    expect(legalEntitiesPageSource).not.toContain("ActionMenu");
    expect(legalEntitiesPageSource).not.toContain("MoreHorizontal");
    expect(legalEntitiesPageSource).toContain("Contract Templates");
    expect(legalEntitiesPageSource).toContain("#legal-entities/${row.id}/contract-templates");
    expect(legalEntitiesPageSource).toContain("Deactivate");
  });
});
