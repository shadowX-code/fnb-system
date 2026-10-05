import { afterEach, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  CandidateFitSummary,
  RecruitmentState,
} from "./RecruitmentPresentation.jsx";
const qa = vi.hoisted(() => ({ managerEvidence: vi.fn() }));
vi.mock("./recruitmentService.js", () => ({ recruitmentService: qa }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("presents Covered separately from requirement fit", () => {
  render(
    <>
      <RecruitmentState kind="coverage" value="covered" />
      <RecruitmentState kind="fit" value="does_not_meet" />
    </>,
  );
  expect(screen.getByText("Covered").className).toContain("badge-info");
  expect(screen.getByText("Does not meet").className).toContain("badge-danger");
});
it("reads finalized requirement findings without generating reports or inferring fit from coverage", async () => {
  qa.managerEvidence.mockResolvedValue({
    reports: [
      {
        status: "ready",
        body: {
          opening_requirements: [
            { state: "does_not_meet" },
            { state: "meets" },
            { state: "unclear" },
          ],
        },
      },
    ],
  });
  render(
    <CandidateFitSummary
      application={{ id: "one", attempt_status: "partial" }}
    />,
  );
  expect(await screen.findByText("1 Does not meet")).toBeTruthy();
  expect(screen.getByText("1 Meets")).toBeTruthy();
  expect(screen.getByText("1 Unclear")).toBeTruthy();
  expect(qa.managerEvidence).toHaveBeenCalledOnce();
});
it("does not read extra evidence for pre-interview candidates", () => {
  render(
    <CandidateFitSummary
      application={{ id: "one", attempt_status: "ready" }}
    />,
  );
  expect(screen.getByText("Fit after interview review")).toBeTruthy();
  expect(qa.managerEvidence).not.toHaveBeenCalled();
});
it("leaves a failed fit read usable through the primary review action", async () => {
  qa.managerEvidence.mockRejectedValue(Error("unavailable"));
  render(
    <CandidateFitSummary
      application={{ id: "one", attempt_status: "failed" }}
    />,
  );
  expect(await screen.findByText("Fit available in review")).toBeTruthy();
});
