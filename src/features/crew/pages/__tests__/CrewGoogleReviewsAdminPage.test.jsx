import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ context: vi.fn(), save: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { googleReviewsAdminContext: mocks.context, setGoogleMonthlyTarget: mocks.save } }));
import CrewGoogleReviewsAdminPage from "../CrewGoogleReviewsAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const auth = { hasPermission: () => true };
const context = { api_status: "pending_allowlist", connection_status: "not_connected", positive_target: null, target_locked: false, reviews: [], new_reviews: null, positive_reviews: null, average_rating: null, negative_reviews: null, negative_rate: null };

beforeEach(() => { mocks.context.mockReset().mockResolvedValue(context); mocks.save.mockReset().mockResolvedValue({ changed: true }); });
afterEach(cleanup);

describe("Google Reviews Admin foundation", () => {
  it("does not turn unavailable Google review evidence into zero or fabricated rows", async () => {
    render(<CrewGoogleReviewsAdminPage auth={auth} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("Google Reviews is not connected")).not.toBeNull();
    expect(screen.getByText("No Google reviews available for this outlet and month.")).not.toBeNull();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(1);
    expect(screen.getByText("Not available / Not set")).not.toBeNull();
    expect(mocks.context).toHaveBeenCalledWith(outlet.id, expect.stringMatching(/^\d{4}-\d{2}-01$/));
  });

  it("keeps provider controls disabled and validates the audited target", async () => {
    render(<CrewGoogleReviewsAdminPage auth={auth} store={{ outlets: [outlet] }} />);
    await screen.findByText("Google Reviews is not connected");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Connect" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Choose Google Location" }).disabled).toBe(true);
    const input = screen.getByLabelText("Positive reviews");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(outlet.id, expect.stringMatching(/^\d{4}-\d{2}-01$/), 3));
  });
});
