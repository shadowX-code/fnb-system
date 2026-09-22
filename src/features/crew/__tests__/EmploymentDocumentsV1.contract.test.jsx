import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCrewRoute } from "../crewRoute.js";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921100000_people_employment_documents_v1.sql"), "utf8");
const edgeFunction = readFileSync(resolve(process.cwd(), "supabase/functions/employee-employment-documents/index.ts"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.jsx"), "utf8");

describe("People Employment Documents V1 authority", () => {
  it("keeps legal employer distinct from workplace and snapshots it on send", () => {
    expect(migration).toContain("create table public.legal_entities");
    expect(migration).toContain("alter table public.employees add column legal_entity_id");
    expect(migration).toContain("legal_company_name_snapshot=v_entity.legal_company_name");
    expect(migration).toContain("workplace_snapshot=v_employee.workplace");
  });

  it("pins sent PDF, identity and consent evidence behind immutable guards", () => {
    expect(migration).toContain("Sent employment document content is immutable");
    expect(migration).toContain("Employment document events are immutable");
    expect(migration).toContain("document_sha256");
    expect(migration).toContain("consent_copy_sha256");
    expect(migration).toContain("completion_request_id uuid unique");
    expect(migration).toContain("crew_session_employee(p_token)");
  });

  it("uses a dedicated private PDF-only bucket and trusted server hash", () => {
    expect(migration).toContain("'employee-employment-documents','employee-employment-documents',false,10485760,array['application/pdf']");
    expect(edgeFunction).toContain('crypto.subtle.digest("SHA-256"');
    expect(edgeFunction).toContain('new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"');
    expect(edgeFunction).toContain("createSignedUrl");
    expect(edgeFunction).not.toContain("getPublicUrl");
  });

  it("exposes the shared Employment Records IA without sharing authorities", () => {
    expect(parseCrewRoute("#crew/me/employment-records/contracts")?.screen).toBe("employment-documents");
    expect(parseCrewRoute("#crew/me/employment-records/documents-compliance")?.screen).toBe("compliance");
    expect(parseCrewRoute("#crew/me/employment-records/warnings")?.screen).toBe("disciplinary");
    expect(app).toContain("CrewEmploymentRecordsMobile");
    expect(app).toContain("CrewEmploymentDocumentsMobile");
  });
});
