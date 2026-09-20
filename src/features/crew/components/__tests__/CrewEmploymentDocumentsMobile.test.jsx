import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrewEmploymentDocumentsMobile from "../CrewEmploymentDocumentsMobile.jsx";
import { employmentDocumentService } from "../../../../services/employmentDocumentService.js";

vi.mock("../../../../services/employmentDocumentService.js", () => ({ employmentDocumentService: { crewList: vi.fn(), crewOpen: vi.fn(), crewComplete: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const row = { id: "doc-1", title: "Employment Contract 2026", document_type: "employment_contract", effective_date: "2026-10-01", status: "sent", sent_at: "2026-09-21T01:00:00Z" };
const detail = { ...row, status: "viewed", legal_company_name_snapshot: "Example Foods Sdn. Bhd.", company_registration_no_snapshot: "202601234567", document_url: "https://example.test/view", download_url: "https://example.test/download", consent_copy: "I confirm that I have reviewed and acknowledge this exact employment document." };

describe("Crew Employment Documents", () => {
  it("shows employee-scoped contracts and opens the exact private PDF", async () => {
    employmentDocumentService.crewList.mockResolvedValue({ documents: [row] });
    employmentDocumentService.crewOpen.mockResolvedValue(detail);
    render(<CrewEmploymentDocumentsMobile token="opaque-token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /view document/i }));
    await waitFor(() => expect(employmentDocumentService.crewOpen).toHaveBeenCalledWith("opaque-token", "doc-1"));
    expect((await screen.findByTitle("Employment Contract 2026")).getAttribute("src")).toBe("https://example.test/view");
    expect(screen.getByRole("link", { name: /download exact pdf/i }).getAttribute("href")).toBe("https://example.test/download");
  });

  it("uses explicit acknowledgement language rather than electronic-signature claims", async () => {
    employmentDocumentService.crewList.mockResolvedValue({ documents: [row] });
    employmentDocumentService.crewOpen.mockResolvedValue(detail);
    render(<CrewEmploymentDocumentsMobile token="opaque-token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /view document/i }));
    fireEvent.click(await screen.findByRole("button", { name: /review & acknowledge/i }));
    expect(screen.getByText(detail.consent_copy)).not.toBeNull();
    expect(screen.queryByText(/electronic signature/i)).toBeNull();
  });
});
