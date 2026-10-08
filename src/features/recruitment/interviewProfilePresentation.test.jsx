import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import InterviewProfileSettings from "./InterviewProfileSettings.jsx";
import { serviceCrewV2 } from "./serviceCrewV2.js";
afterEach(cleanup);
const profiles = [
  {
    id: "v1",
    name: "Service Crew",
    version: 1,
    status: "published",
    definition: structuredClone(serviceCrewV2),
  },
  {
    id: "v2",
    name: "Service Crew",
    version: 2,
    status: "published",
    definition: structuredClone(serviceCrewV2),
  },
  {
    id: "k1",
    name: "Kitchen Crew",
    version: 1,
    status: "published",
    definition: structuredClone(serviceCrewV2),
  },
];
describe("Interview plan presentation", () => {
  it("scales library by family, shows latest published versions, and keeps historical guidance accessible", () => {
    render(<InterviewProfileSettings profiles={profiles} onClose={() => {}} />);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "View Kitchen Crew profile" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "View Service Crew profile" }),
    );
    expect(screen.getByRole("heading", { name: "Assessment Areas" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Completion Rules" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Prepare next version" }),
    ).toBeNull();
    expect(screen.getByText("Version 2 · Latest")).toBeTruthy();
    const summary = screen.getAllByText("Customer Handling").find(n => n.closest("summary")).closest("summary");
    expect(summary.parentElement.open).toBe(false);
    fireEvent.click(summary);
    expect(
      within(summary.parentElement).getByText("Follow-up signals"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Version 1.*Published/ }),
    );
    expect(screen.getByText("Version 1")).toBeTruthy();
    expect(screen.getByText(/Published and immutable/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Interview Profiles", exact: true }),
    );
    expect(
      screen.getByRole("heading", { name: "Profile library" }),
    ).toBeTruthy();
  });
  it("next-version edits are local, discard preserves immutable published guidance, and publication remains explicit", () => {
    const publish = vi.fn();
    render(
      <InterviewProfileSettings
        profiles={profiles}
        canManage
        onPublish={publish}
        onClose={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View Service Crew profile" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare next version" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Role context" }), {
      target: { value: "Local draft only" },
    });
    expect(publish).not.toHaveBeenCalled();
    expect(profiles[1].definition.role_context).not.toBe("Local draft only");
    expect(
      screen.getByRole("button", { name: "Publish Service Crew v3" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(screen.getByText(profiles[1].definition.role_context)).toBeTruthy();
  });
});
