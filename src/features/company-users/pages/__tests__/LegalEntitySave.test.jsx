import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LegalEntitiesPage from "../LegalEntitiesPage.jsx";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../../lib/supabase", () => ({ supabase: { rpc } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const entity = {
  id: "qa-entity", legal_company_name: "QA Legal Entity", company_registration_no: "QA-123",
  registered_address: "Original address", display_name: null, is_active: true, linked_employee_count: 2,
};

async function openEdit(record = entity) {
  rpc.mockImplementation(async (name, args) => name === "legal_entity_list"
    ? { data: [record] }
    : { data: { ...args.p_payload, display_name: args.p_payload.display_name || null } });
  render(<LegalEntitiesPage auth={{ hasPermission: () => true }} />);
  fireEvent.click(await screen.findByText(record.display_name || record.legal_company_name || "Unnamed legal entity"));
  return screen.getByRole("button", { name: "Save Legal Entity" });
}

it("saves an address-only edit with null optional Display Name through the real service", async () => {
  const save = await openEdit();
  expect(screen.getByRole("textbox", { name: /^Display Name/ }).value).toBe("");
  fireEvent.change(screen.getByRole("textbox", { name: /^Registered Address/ }), { target: { value: " Updated address " } });
  fireEvent.click(save);
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("legal_entity_save", {
    p_legal_entity_id: entity.id,
    p_payload: { ...entity, registered_address: "Updated address", display_name: "" },
  }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Legal Entity" })).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
});

it("preserves populated Display Name and unrelated fields", async () => {
  const record = { ...entity, display_name: "QA Display" };
  const save = await openEdit(record);
  fireEvent.change(screen.getByRole("textbox", { name: /^Registered Address/ }), { target: { value: "New address" } });
  fireEvent.click(save);
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("legal_entity_save", {
    p_legal_entity_id: entity.id, p_payload: { ...record, registered_address: "New address" },
  }));
});

it.each(["legal_company_name", "company_registration_no", "registered_address"])("keeps null/blank required %s invalid without throwing", async (field) => {
  const save = await openEdit({ ...entity, [field]: null });
  expect(save.disabled).toBe(true);
  expect(rpc.mock.calls.some(([name]) => name === "legal_entity_save")).toBe(false);
});

it("creates with blank optional Display Name and validates whitespace-only required input", async () => {
  rpc.mockImplementation(async (name, args) => name === "legal_entity_list"
    ? { data: [] } : { data: { ...args.p_payload, id: "new-qa" } });
  render(<LegalEntitiesPage auth={{ hasPermission: () => true }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add Legal Entity" }));
  fireEvent.change(screen.getByRole("textbox", { name: /^Legal Company Name/ }), { target: { value: "  " } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Company Registration No\./ }), { target: { value: "QA-456" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Registered Address/ }), { target: { value: "QA address" } });
  const save = screen.getByRole("button", { name: "Save Legal Entity" });
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: /^Legal Company Name/ }), { target: { value: " New QA Entity " } });
  fireEvent.click(save);
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("legal_entity_save", expect.objectContaining({
    p_legal_entity_id: null, p_payload: expect.objectContaining({ legal_company_name: "New QA Entity", display_name: "" }),
  })));
});
