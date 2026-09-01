import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ crew: vi.fn(), entry: vi.fn(), submit: vi.fn(), submitV2: vi.fn(), submitV3: vi.fn(), submitLegacyV3: vi.fn() }));
vi.mock("../../../services/crewService.js", () => ({
  crewService: {
    publicFeedbackCrew: mocks.crew,
    publicFeedbackEntry: mocks.entry,
    submitPublicFeedback: mocks.submit,
    submitPublicFeedbackV2: mocks.submitV2,
    submitPublicFeedbackV3: mocks.submitV3,
    submitPublicFeedbackLegacyV3: mocks.submitLegacyV3,
  },
}));

import CrewGuestFeedback from "../CrewGuestFeedback.jsx";

const token = "a".repeat(36);
const response = {
  outlet: { id: "outlet-1", name: "Friends Corner", public_feedback_token: token },
  crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew", on_shift: true }],
};

function tokenRoute() {
  window.history.replaceState(null, "", `/feedback/${token}`);
}

async function selectScope(name) {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
}

function selectExperience(name) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
}

function continueToComment() {
  fireEvent.click(screen.getByRole("button", { name: /Continue|继续/ }));
}

beforeEach(() => {
  window.history.replaceState(null, "", "/#feedback?outlet=outlet-1");
  mocks.crew.mockReset().mockResolvedValue(response);
  mocks.entry.mockReset().mockResolvedValue(response);
  mocks.submit.mockReset().mockResolvedValue({ id: "feedback-1", status: "received" });
  mocks.submitV2.mockReset().mockResolvedValue({ id: "feedback-1", status: "received" });
  mocks.submitV3.mockReset().mockResolvedValue({ id: "feedback-1", status: "received" });
  mocks.submitLegacyV3.mockReset().mockResolvedValue({ id: "feedback-1", status: "received" });
});

afterEach(cleanup);

describe("Public guest feedback", () => {
  it("keeps legacy links working and submits Crew evidence with the selected employee", async () => {
    render(<CrewGuestFeedback />);
    await selectScope("Crew");
    fireEvent.click(screen.getByRole("button", { name: /Alex Tan/ }));
    selectExperience("Great");
    fireEvent.click(screen.getByRole("button", { name: "Friendly" }));
    continueToComment();
    fireEvent.click(screen.getByRole("button", { name: /Skip & send/ }));

    await waitFor(() => expect(mocks.submitLegacyV3).toHaveBeenCalledWith(expect.objectContaining({
      outletId: "outlet-1",
      outletToken: token,
      scope: "crew",
      employeeId: "employee-1",
      positiveTags: ["Friendly"],
      improvementTags: [],
      comment: "",
      anonymousDeviceId: expect.any(String),
    })));
    expect(await screen.findByText("Thank you")).not.toBeNull();
  });

  it("submits Food feedback without Crew attribution using canonical improvement tags", async () => {
    tokenRoute();
    render(<CrewGuestFeedback />);
    await selectScope("Food & Drinks");
    selectExperience("Could be better");
    fireEvent.click(screen.getByRole("button", { name: "Temperature" }));
    continueToComment();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Arrived cool" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("When did you visit?");
    fireEvent.click(screen.getByRole("button", { name: "Just now" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "No, just sharing" }));

    await waitFor(() => expect(mocks.submitV3).toHaveBeenCalledWith(expect.objectContaining({
      scope: "food",
      employeeId: null,
      positiveTags: [],
      improvementTags: ["Temperature"],
      comment: "Arrived cool",
      visitTimeMode: "just_now",
      followUpRequested: false,
    })));
  });

  it("submits Overall Visit feedback with its canonical positive tags", async () => {
    tokenRoute();
    render(<CrewGuestFeedback />);
    await selectScope("Overall Visit");
    selectExperience("Great");
    fireEvent.click(screen.getByRole("button", { name: "Atmosphere" }));
    continueToComment();
    fireEvent.click(screen.getByRole("button", { name: /Skip & send/ }));

    await waitFor(() => expect(mocks.submitV3).toHaveBeenCalledWith(expect.objectContaining({
      scope: "outlet",
      employeeId: null,
      positiveTags: ["Atmosphere"],
      improvementTags: [],
    })));
  });

  it("switches the entire flow to Chinese without losing current selections", async () => {
    tokenRoute();
    render(<CrewGuestFeedback />);
    await selectScope("Crew");
    fireEvent.click(screen.getByRole("button", { name: /Alex Tan/ }));
    selectExperience("Great");
    fireEvent.click(screen.getByRole("button", { name: "Friendly" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));

    expect(screen.getByText("什么让您印象深刻？")).not.toBeNull();
    expect(screen.getByRole("button", { name: "亲切友善" }).className).toContain("is-selected");
  });

  it("uses the available outlet logo and falls back cleanly to outlet initials", async () => {
    tokenRoute();
    mocks.entry.mockResolvedValue({ ...response, outlet: { ...response.outlet, logo_url: "https://example.com/logo.png" } });
    const { unmount } = render(<CrewGuestFeedback />);
    await screen.findByText("Friends Corner");
    expect(document.querySelector(".guest-feedback-brand-mark img")?.getAttribute("src")).toBe("https://example.com/logo.png");
    unmount();

    mocks.entry.mockResolvedValue(response);
    render(<CrewGuestFeedback />);
    await screen.findByText("Friends Corner");
    expect(document.querySelector(".guest-feedback-brand-mark")?.textContent).toBe("FC");
  });

  it("preserves selected highlights when the guest goes back", async () => {
    tokenRoute();
    render(<CrewGuestFeedback />);
    await selectScope("Food & Drinks");
    selectExperience("Great");
    fireEvent.click(screen.getByRole("button", { name: "Taste" }));
    continueToComment();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("button", { name: "Taste" }).className).toContain("is-selected");
  });

  it("offers a no-attribution fallback when a Crew member cannot be found", async () => {
    tokenRoute();
    render(<CrewGuestFeedback />);
    await selectScope("Crew");
    fireEvent.click(screen.getByRole("button", { name: /Can't find them/ }));

    expect(screen.getByText("How was your visit?")).not.toBeNull();
  });

  it("has a graceful unavailable state for an invalid public token", async () => {
    window.history.replaceState(null, "", "/feedback/not-a-real-outlet");
    mocks.entry.mockRejectedValue(new Error("Feedback link is unavailable."));
    render(<CrewGuestFeedback />);
    expect(await screen.findByText("This feedback link is unavailable")).not.toBeNull();
  });

  it("shows a submitting state while a public submission is pending", async () => {
    let resolveSubmit;
    mocks.submitV3.mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    tokenRoute();
    render(<CrewGuestFeedback />);
    await selectScope("Overall Visit");
    selectExperience("Okay");
    continueToComment();
    fireEvent.click(screen.getByRole("button", { name: /Send feedback/ }));

    expect(screen.getByRole("button", { name: "Sending..." }).disabled).toBe(true);
    resolveSubmit({ id: "feedback-1" });
    expect(await screen.findByText("Thank you")).not.toBeNull();
  });

  it("includes a reduced-motion treatment for public feedback transitions", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/features/crew/CrewGuestFeedback.css"), "utf8");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("collects manual visit time and follow-up contact only for improvement feedback", async () => {
    tokenRoute();
    render(<CrewGuestFeedback />);
    await selectScope("Overall Visit");
    selectExperience("Could be better");
    continueToComment();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a time" }));
    fireEvent.change(screen.getByLabelText("Visit time"), { target: { value: "18:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, please" }));
    fireEvent.change(screen.getByLabelText("Preferred name"), { target: { value: "Staging QA Guest" } });
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "+60123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => expect(mocks.submitV3).toHaveBeenCalledWith(expect.objectContaining({
      scope: "outlet", visitTimeMode: "chosen_time", visitTime: "18:30", followUpRequested: true,
      preferredName: "Staging QA Guest", contactMethod: "phone", contactValue: "+60123456789",
    })));
  });
});
