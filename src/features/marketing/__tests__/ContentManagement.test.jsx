import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ContentManagement from "../ContentManagement.jsx";
const { service } = vi.hoisted(() => ({
  service: { contentManagement: vi.fn(), assetUrl: vi.fn() },
}));
vi.mock("../marketingService.js", () => ({ marketingService: service }));
vi.mock(
  "../../../auth/AuthContext.jsx",
  () => ({ useAuth: () => ({ user: { id: "test-user" } }) }),
);
const row = {
  key: "meta:1",
  origin: "meta",
  title: "Real external post",
  brand_name: "Idamans",
  status: "published",
  day: "2026-05-22",
  display_at: "2026-05-22T03:00:00Z",
  actual_at: "2026-05-22T03:00:00Z",
  channels: [{
    channel: "instagram",
    caption: "Real external post",
    status: "published",
    actual_at: "2026-05-22T03:00:00Z",
    metrics: { reach: 5, likes: 0, comments: 0 },
    provider_post_id: "123",
    permalink: "https://www.instagram.com/p/test/",
  }],
};
const props = {
  organizationId: "org",
  brandId: "",
  refresh: 0,
  open: vi.fn(),
  command: vi.fn(),
  can: () => true,
};
beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  service.contentManagement.mockResolvedValue({
    rows: [row],
    total_count: 1,
    day_counts: { "2026-05-22": 1 },
  });
});
it("starts as a dense List, identifies external origin and opens a read-only detail", async () => {
  render(<ContentManagement {...props} />);
  await screen.findByRole("table");
  expect(
    screen.getByRole("tab", { name: "List" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(service.contentManagement.mock.calls[0][0]).toMatchObject({
    view: "list",
    from: null,
    to: null,
  });
  expect(screen.getAllByText("Published externally · Meta").length)
    .toBeGreaterThan(0);
  expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open on Instagram" })).toBeTruthy();
});
it("shares filters across views and uses accurate day overflow rather than a paginated subset", async () => {
  service.contentManagement.mockImplementation(async (args) => ({
    rows: args.view === "calendar" ? [row] : [row],
    total_count: 5,
    day_counts: { "2026-05-22": 5 },
  }));
  render(<ContentManagement {...props} />);
  await screen.findByRole("table");
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-05-01" },
  });
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-05-31" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
  fireEvent.change(screen.getByLabelText("Calendar date"), {
    target: { value: "2026-05-22" },
  });
  await screen.findByRole("button", { name: "+4 more" });
  expect(localStorage.getItem("admin.presentation.marketing.content.test-user"))
    .toBe("calendar");
  fireEvent.click(screen.getByRole("button", { name: "+4 more" }));
  await screen.findByRole("table");
  await waitFor(() =>
    expect(service.contentManagement.mock.calls.at(-1)[0]).toMatchObject({
      view: "list",
      from: "2026-05-21T16:00:00.000Z",
      to: "2026-05-22T16:00:00.000Z",
    })
  );
});
it("discards delayed scope results and closes obsolete external details", async () => {
  let resolve;
  service.contentManagement.mockImplementationOnce(() =>
    new Promise((r) => resolve = r)
  ).mockResolvedValue({ rows: [], total_count: 0 });
  const { rerender } = render(<ContentManagement {...props} />);
  await waitFor(() => expect(service.contentManagement).toHaveBeenCalled());
  rerender(<ContentManagement {...props} brandId="other" />);
  await screen.findByText("No dated content");
  resolve({ rows: [row], total_count: 1 });
  await waitFor(() =>
    expect(screen.queryByText("Real external post")).toBeNull()
  );
});
it("expands per-channel evidence without adding execution actions", async () => {
  service.contentManagement.mockResolvedValue({
    rows: [{
      ...row,
      key: "concept",
      id: "concept",
      origin: "feedx",
      status: "scheduled",
      payload: { title: "Concept", variants: [] },
      channels: [{ ...row.channels[0], job_state: "succeeded" }, {
        channel: "facebook",
        status: "failed",
        job_state: "failed",
        error_code: "provider_not_authorized",
        metrics: {},
      }],
    }],
    total_count: 1,
  });
  render(<ContentManagement {...props} />);
  await screen.findByRole("table");
  fireEvent.click(
    screen.getAllByRole("button", { name: "2 channel variants" })[0],
  );
  expect(screen.getAllByText(/Post 123/).length).toBeGreaterThan(0);
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /Execute|Publish now/ }))
    .toBeNull();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
});
