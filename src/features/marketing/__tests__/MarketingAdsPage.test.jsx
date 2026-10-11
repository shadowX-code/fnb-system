import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import MarketingAdsPage from "../MarketingAdsPage.jsx";
const { ads, service, auth } = vi.hoisted(() => ({
  ads: {
    read: vi.fn(),
    pending: vi.fn(),
    authorize: vi.fn(),
    bind: vi.fn(),
    sync: vi.fn(),
    disconnect: vi.fn(),
  },
  service: { context: vi.fn() },
  auth: { hasPermission: vi.fn(() => true) },
}));
vi.mock("../../../auth/AuthContext.jsx", () => ({ useAuth: () => auth }));
vi.mock("../adsService.js", () => ({ adsService: ads }));
vi.mock("../marketingService.js", () => ({ marketingService: service }));
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  auth.hasPermission.mockReturnValue(true);
  service.context.mockResolvedValue({
    organizations: [{ id: "org", name: "Organization" }],
    brands: [{ id: "brand", organization_id: "org", name: "Brand" }],
  });
  ads.read.mockResolvedValue({ accounts: [], reports: [], jobs: [] });
  ads.pending.mockResolvedValue([]);
});
describe("Ads read-only workspace", () => {
  it("has meaningful unconnected state and never invents advertising metrics", async () => {
    render(<MarketingAdsPage />);
    await screen.findByText("Connect your first Ad Account");
    expect(screen.queryByText("MYR 0")).toBeNull();
    expect(ads.authorize).not.toHaveBeenCalled();
  });
  it("requires explicit brand selection before OAuth", async () => {
    render(<MarketingAdsPage />);
    await screen.findByText("Connect your first Ad Account");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Connect Ad Account" })[0],
    );
    await screen.findByText(
      "Select the FeedX brand that will own this Ad Account.",
    );
    expect(ads.authorize).not.toHaveBeenCalled();
  });
  it("keeps mixed currencies and missing results separate with no execution controls", async () => {
    ads.read.mockResolvedValue({
      accounts: [
        {
          id: "a",
          name: "Account A",
          account_id: "111",
          brand_id: "brand",
          health: { currency: "MYR", timezone: "Asia/Kuala_Lumpur" },
        },
        {
          id: "b",
          name: "Account B",
          account_id: "222",
          health: { currency: "USD", timezone: "America/New_York" },
        },
      ],
      reports: [
        {
          connection_id: "a",
          payload: {
            insights: {
              account: [
                { metrics: { spend: { value: 0, state: "reported" } } },
              ],
            },
          },
        },
        {
          connection_id: "b",
          payload: {
            insights: {
              account: [
                { metrics: { spend: { value: 10, state: "reported" } } },
              ],
            },
          },
        },
      ],
      jobs: [],
    });
    render(<MarketingAdsPage />);
    await screen.findByText("MYR 0");
    expect(screen.getByText("USD 10")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /Activate|Increase budget|Publish/,
      }),
    ).toBeNull();
    expect(
      screen.getAllByText("Results unavailable for this period."),
    ).toHaveLength(2);
  });
  it("does not expose connecting without independent permission", async () => {
    auth.hasPermission.mockImplementation((p) => p !== "marketing_ads.connect");
    render(<MarketingAdsPage />);
    await screen.findByText("Connect your first Ad Account");
    expect(
      screen.queryByRole("button", { name: "Connect Ad Account" }),
    ).toBeNull();
  });
  it("does not query invalid date periods", async () => {
    render(<MarketingAdsPage />);
    await screen.findByText("Connect your first Ad Account");
    const before = ads.read.mock.calls.length;
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    await screen.findByText("Select a valid period of up to 94 days.");
    expect(ads.read.mock.calls.length).toBe(before);
  });
});
