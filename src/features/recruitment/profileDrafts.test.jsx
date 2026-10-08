import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import InterviewProfileSettings from "./InterviewProfileSettings.jsx";
import { serviceCrewV2 } from "./serviceCrewV2.js";
import { recruitmentService } from "./recruitmentService.js";
vi.mock("./recruitmentService.js", () => ({
  recruitmentService: {
    profileDrafts: vi.fn(),
    prepareProfileDraft: vi.fn(),
    saveProfileDraft: vi.fn(),
  },
}));
const profile = {
  id: "v2",
  profile_key: "service_crew",
  name: "Service Crew",
  version: 2,
  definition: serviceCrewV2,
};
const record = {
  ...profile,
  id: "draft3",
  status: "draft",
  version: 3,
  revision: 1,
};
let stored;
beforeEach(() => {
  stored = structuredClone(record);
  recruitmentService.profileDrafts.mockImplementation(async () => [
    structuredClone(stored),
  ]);
  recruitmentService.prepareProfileDraft.mockImplementation(async () =>
    structuredClone(stored),
  );
  recruitmentService.saveProfileDraft.mockImplementation(
    async (id, revision, definition) => {
      if (revision !== stored.revision)
        throw Object.assign(new Error("A newer draft has been saved."), {
          cause: { code: "PT409" },
        });
      stored = {
        ...stored,
        revision: revision + 1,
        definition: structuredClone(definition),
      };
      return structuredClone(stored);
    },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function open(props = {}) {
  const view = render(
    <InterviewProfileSettings
      profiles={[profile]}
      canManage
      onClose={() => {}}
      {...props}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Resume Service Crew draft" }),
  );
  return view;
}
describe("Durable profile draft editing", () => {
  it("saves the whole definition, survives remount and resumes without creating a new version", async () => {
    const view = await open();
    fireEvent.change(screen.getByRole("textbox", { name: "Role context" }), {
      target: { value: "Updated confirmed role context" },
    });
    expect(
      screen.getByRole("button", { name: "Publish Service Crew v3" }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(stored.revision).toBe(2));
    await screen.findByText(/Draft saved. You can return later/);
    expect(stored.definition.evidence_areas).toEqual(
      serviceCrewV2.evidence_areas,
    );
    expect(stored.definition.scenarios).toEqual(serviceCrewV2.scenarios);
    expect(stored.definition.completion_criteria).toEqual(
      serviceCrewV2.completion_criteria,
    );
    view.unmount();
    await open();
    expect(screen.getByRole("textbox", { name: "Role context" }).value).toBe(
      "Updated confirmed role context",
    );
    expect(recruitmentService.prepareProfileDraft).not.toHaveBeenCalled();
    expect(profile.definition.role_context).toBe(serviceCrewV2.role_context);
  });
  it("preserves local edits on conflict, blocks publication, and explicitly reloads latest saved state", async () => {
    await open();
    stored = {
      ...stored,
      revision: 2,
      definition: {
        ...stored.definition,
        role_context: "Saved by another manager",
      },
    };
    fireEvent.change(screen.getByRole("textbox", { name: "Role context" }), {
      target: { value: "My stale edits" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "Role context" }).value).toBe(
      "My stale edits",
    );
    expect(stored.definition.role_context).toBe("Saved by another manager");
    expect(
      screen.getByRole("button", { name: "Publish Service Crew v3" }).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard local edits and reload saved draft",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Role context" }).value).toBe(
        "Saved by another manager",
      ),
    );
  });
  it("publication is separate, revision-bound and never implicit in save", async () => {
    const publish = vi.fn().mockResolvedValue("v3");
    await open({ onPublish: publish });
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Publish Service Crew v3" }),
    );
    await waitFor(() => expect(publish).toHaveBeenCalledWith("draft3", 1));
  });
  it("view-only users see saved drafts and published versions without edit or publication authority", async () => {
    render(
      <InterviewProfileSettings profiles={[profile]} onClose={() => {}} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "View Service Crew draft" }),
    );
    expect(screen.queryByRole("button", { name: "Save Draft" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Publish Service Crew/ }),
    ).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Role context" })).toBeNull();
  });
});
