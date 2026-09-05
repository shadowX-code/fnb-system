import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FactoryMestiHealthDeclarationPage from "../FactoryMestiHealthDeclarationPage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

vi.mock("../../../../services/factoryService.js", () => ({ factoryService: { listMestiHealthDeclarations: vi.fn(), listMestiHealthDeclarationOptions: vi.fn(), submitMestiHealthDeclaration: vi.fn(), actionMestiHealthDeclaration: vi.fn() } }));
vi.mock("../../hooks/useFactoryPermissions.js", () => ({ default: () => ({ can: () => true }) }));

beforeEach(() => {
  vi.clearAllMocks();
  factoryService.listMestiHealthDeclarations.mockResolvedValue([]);
  factoryService.listMestiHealthDeclarationOptions.mockResolvedValue({ employees: [{ id: "employee-qa", name: "Crew QA", position: "Service Crew" }] });
  factoryService.submitMestiHealthDeclaration.mockResolvedValue({ id: "declaration-1" });
});
afterEach(cleanup);

describe("FactoryMestiHealthDeclarationPage", () => {
  it("keeps No symptoms mutually exclusive with structured symptom selections", async () => {
    render(<FactoryMestiHealthDeclarationPage onNotify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Employee Declaration" }));
    const noSymptoms = screen.getByText("No symptoms", { exact: true });
    expect(noSymptoms.className).toContain("bg-primary");
    fireEvent.click(screen.getByText("Fever", { exact: true }));
    expect(noSymptoms.className).not.toContain("bg-primary");
    fireEvent.click(noSymptoms);
    expect(screen.getByLabelText("Fever").checked).toBe(false);
  });

  it("submits visitor evidence through the canonical trusted service with the derived entry defaults", async () => {
    render(<FactoryMestiHealthDeclarationPage onNotify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Visitor Declaration" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Visitor Name" }), { target: { value: "QA Visitor" } });
    fireEvent.click(screen.getByText("Fever", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Declaration" }));
    await waitFor(() => expect(factoryService.submitMestiHealthDeclaration).toHaveBeenCalledWith(expect.objectContaining({ declaration_type: "visitor", visitor_name: "QA Visitor", symptoms: ["fever"], entry_decision: "entry_restricted" })));
  });
});
