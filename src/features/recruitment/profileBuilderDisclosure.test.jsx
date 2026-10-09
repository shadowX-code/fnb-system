import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import InterviewIntelligenceBuilder from "./InterviewIntelligenceBuilder.jsx";
import { serviceCrewV2 } from "./serviceCrewV2.js";
afterEach(cleanup);
it("prioritizes goals and priorities while collection guidance, rubrics and completion remain expandable", () => {
  const definition = structuredClone(serviceCrewV2);
  definition.evidence_areas[0].rubric = {
    levels: [1, 2, 3, 4].map((level) => ({
      level,
      criteria: "Role-specific demonstrated criterion " + level,
    })),
  };
  const change = vi.fn();
  render(
    <InterviewIntelligenceBuilder
      definition={definition}
      onChange={change}
      version={3}
      unpublished
    />,
  );
  expect(screen.getByRole("textbox", { name: "Role context" })).toBeTruthy();
  const area = screen.getAllByText("Customer Handling")[0].closest("details");
  expect(area.open).toBe(false);
  fireEvent.click(area.querySelector("summary"));
  expect(
    within(area).getByRole("textbox", { name: "Assessment goal" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Priority for Customer Handling" }),
  ).toBeTruthy();
  const guide = screen
    .getAllByText("Evidence collection guidance")[0]
    .closest("details");
  expect(guide.open).toBe(false);
  const rubric = screen
    .getByText(/Optional rubric assessment.*4 criterion levels/)
    .closest("details");
  expect(rubric.open).toBe(false);
  fireEvent.click(guide.querySelector("summary"));
  expect(
    within(guide).getByRole("textbox", { name: "Follow-up signals" }),
  ).toBeTruthy();
  fireEvent.click(rubric.querySelector("summary"));
  expect(
    screen.getByRole("textbox", { name: "Level 1 criteria" }).value,
  ).toContain("criterion 1");
  fireEvent.change(screen.getByRole("textbox", { name: "Level 1 criteria" }), {
    target: { value: "Updated explicit behavioral criterion" },
  });
  expect(
    change.mock.calls[0][0].evidence_areas[0].rubric.levels[0].criteria,
  ).toBe("Updated explicit behavioral criterion");
  const completion = screen
    .getByText(/Completion & duration settings/)
    .closest("details");
  expect(completion.open).toBe(false);
  fireEvent.click(completion.querySelector("summary"));
  expect(screen.getByRole("spinbutton", { name: "Target minutes" }).value).toBe(
    "10",
  );
  expect(change.mock.calls[0][0].scenarios).toEqual(definition.scenarios);
});
