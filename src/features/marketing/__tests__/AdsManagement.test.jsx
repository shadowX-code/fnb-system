import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AdsManagement from "../AdsManagement.jsx";
const { ads } = vi.hoisted(() => ({
  ads: {
    changes: vi.fn(),
    aiCapabilities: vi.fn(),
    transitionChange: vi.fn(),
    prepareChange: vi.fn(),
    executeChange: vi.fn(),
  },
}));
vi.mock("../adsService.js", () => ({ adsService: ads }));
vi.mock("../marketingService.js", () => ({
  marketingService: { assetUrl: vi.fn().mockResolvedValue("") },
}));
const props = {
  org: "org",
  brand: "brand",
  brands: [{ id: "brand", name: "Approved brand" }],
  accounts: [
    {
      id: "conn",
      account_id: "111",
      name: "Shared account",
      health: {
        manage_verified: false,
        currency: "MYR",
        timezone: "Asia/Singapore",
      },
    },
  ],
  can: () => true,
  report: { configs: { campaigns: [] } },
};
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  ads.changes.mockResolvedValue({ changes: [], assets: [], pages: [] });
  ads.aiCapabilities.mockResolvedValue({ external_execution_enabled: false });
});
describe("native Ads control surface", () => {
  it("prepares locally without invoking external execution and preserves compact canonical controls", async () => {
    render(<AdsManagement {...props} />);
    await screen.findByText("No advertising revisions");
    fireEvent.click(screen.getByRole("button", { name: "Prepare change" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save revision" })).toBeTruthy();
    expect(screen.getByText(/Creation starts paused/)).toBeTruthy();
    expect(ads.executeChange).not.toHaveBeenCalled();
  });
  it("keeps an approved revision disabled when Meta management and execution are unavailable", async () => {
    ads.changes.mockResolvedValue({
      assets: [],
      pages: [],
      changes: [
        {
          id: "r",
          brand_id: "brand",
          connection_id: "conn",
          account_id: "111",
          revision: 1,
          operation: "create",
          maximum_budget: 50000,
          state: "approved",
          current: true,
          configuration: { name: "Reviewed campaign" },
          fingerprint: "pin",
        },
      ],
    });
    render(<AdsManagement {...props} />);
    await screen.findAllByText("Reviewed campaign");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Review revision" })[0],
    );
    expect(
      screen.getByRole("button", { name: "Execute approved change" }).disabled,
    ).toBe(true);
    expect(ads.executeChange).not.toHaveBeenCalled();
    expect(
      screen.getByText(/separate authorization for this exact revision/),
    ).toBeTruthy();
  });
  it("cannot approve an unreviewed revision or submit a stale proposal", async () => {
    ads.changes.mockResolvedValue({
      assets: [],
      pages: [],
      changes: [
        {
          id: "r",
          brand_id: "brand",
          connection_id: "conn",
          account_id: "111",
          revision: 1,
          operation: "pause",
          maximum_budget: 0,
          state: "review",
          current: false,
          configuration: { campaign_id: "123" },
          fingerprint: "pin",
        },
      ],
    });
    render(<AdsManagement {...props} />);
    await screen.findAllByText("Campaign change");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Review revision" })[0],
    );
    expect(
      screen.queryByRole("button", { name: "Approve exact revision" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Confirm review" }).disabled,
    ).toBe(true);
  });
});
