import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import MarketingInboxPage from "../MarketingInboxPage.jsx";
import { marketingService } from "../marketingService.js";
import { inboxService } from "../inboxService.js";
vi.mock(
  "../../../auth/AuthContext.jsx",
  () => ({
    useAuth: () => ({ user: { id: "user" }, hasPermission: () => true }),
  }),
);
vi.mock(
  "../marketingService.js",
  () => ({ marketingService: { context: vi.fn() } }),
);
vi.mock(
  "../inboxService.js",
  () => ({
    inboxService: Object.fromEntries(
      [
        "read",
        "detail",
        "command",
        "configure",
        "preview",
        "configuration",
        "suggest",
        "reviewAI",
      ].map((k) => [k, vi.fn()]),
    ),
  }),
);
const conversation = {
  id: "c",
  brand_id: "b",
  version: 2,
  title: "Internal QA case",
  channel: "internal",
  status: "open",
  priority: "normal",
  tags: [],
  escalation_reasons: [],
  takeover: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  marketingService.context.mockResolvedValue({
    organizations: [{ id: "o", name: "Organization" }],
    brands: [{ id: "b", organization_id: "o", name: "Brand B" }, {
      id: "other",
      organization_id: "o",
      name: "Other Brand",
    }],
  });
  inboxService.configuration.mockResolvedValue({ ai_configured: false });
  inboxService.read.mockResolvedValue({
    rows: [{ ...conversation, brand_name: "Brand B" }],
    total: 1,
    channels: [{
      connection_id: "meta",
      channel: "facebook",
      account_name: "Test Page",
      state: "permission_unavailable",
      receiving_verified: false,
    }],
    faqs: [],
    policy: { revision: 0 },
    knowledge: null,
  });
  inboxService.detail.mockResolvedValue({
    conversation,
    messages: [{
      id: "note",
      kind: "note",
      body: "Review this case",
      occurred_at: "2026-10-10T01:00:00Z",
      actor_name: "Operator",
    }],
    total: 1,
    drafts: [{
      id: "d",
      status: "approved",
      body: "Prepared reply",
      source_version: 2,
      provenance: "human",
      source_references: [],
    }],
    artifacts: [],
    members: [],
  });
});
afterEach(cleanup);
it("labels internal evidence and disabled delivery, with unavailable AI", async () => {
  render(<MarketingInboxPage />);
  await screen.findByText("Internal QA case");
  fireEvent.click(screen.getByText("Internal QA case"));
  await screen.findByText("Review this case");
  expect(screen.getByText("Internal note")).toBeTruthy();
  expect(screen.getByText(/Delivery blocked:/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Suggest reply" }).disabled).toBe(
    true,
  );
  expect(screen.queryByRole("button", { name: /^send/i })).toBeNull();
});
it("uses the canonical command for a note and clears obsolete conversation evidence on scope change", async () => {
  inboxService.command.mockResolvedValue({ conversation });
  render(<MarketingInboxPage />);
  fireEvent.click(await screen.findByText("Internal QA case"));
  await screen.findByText("Review this case");
  fireEvent.click(screen.getByRole("button", { name: "Add internal note" }));
  fireEvent.change(screen.getByLabelText("Internal note"), {
    target: { value: "Human follow-up" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() =>
    expect(inboxService.command).toHaveBeenCalledWith(
      expect.any(String),
      "o",
      "b",
      conversation,
      "note",
      { body: "Human follow-up" },
    )
  );
  fireEvent.click(screen.getByRole("button", { name: "Brand" }));
  fireEvent.click(screen.getByRole("option", { name: "Other Brand" }));
  await waitFor(() =>
    expect(screen.queryByText("Review this case")).toBeNull()
  );
});
it("labels a past approval as historical when conversation evidence changed", async () => {
  inboxService.detail.mockResolvedValue({
    conversation,
    messages: [],
    total: 0,
    drafts: [{
      id: "old",
      status: "approved",
      body: "Earlier proposal",
      source_version: 1,
      provenance: "human",
      source_references: [],
    }],
    artifacts: [],
    members: [],
  });
  render(<MarketingInboxPage />);
  fireEvent.click(await screen.findByText("Internal QA case"));
  expect(
    await screen.findByText(
      /Historical approval; conversation history changed/,
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Approval recorded for this history version/))
    .toBeNull();
});
