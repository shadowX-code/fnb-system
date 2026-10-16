import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import AdsAttributionReview from "../AdsAttributionReview.jsx";
const { batch } = vi.hoisted(() => ({ batch: vi.fn() }));
vi.mock("../adsService.js", () => ({ adsService: { attributeBatch: batch } }));
const report = {
  account: { id: "111" },
  configs: {
    campaigns: [
      { id: "1", name: "Campaign One", feedx_attribution_revision: 3 },
      { id: "2", name: "Campaign Two" },
    ],
    ads: [
      { campaign_id: "1", creative: { object_story_spec: { page_id: "99" } } },
      { campaign_id: "2", creative: { object_story_spec: { page_id: "99" } } },
    ],
  },
};
const props = {
  report,
  org: "org",
  brands: [{ id: "brand", name: "Brand" }],
  identities: [],
  canManage: true,
  onUpdated: vi.fn(),
};
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  batch.mockResolvedValue([]);
});
describe("attribution review confirmations", () => {
  it("prefills only a unique verified identity suggestion and still waits for confirmation", () => {
    render(<AdsAttributionReview {...props} identities={[{channel:'facebook',account_id:'99',brand_id:'brand'}]} />);
    fireEvent.click(screen.getAllByRole('button',{name:'Review'})[0]);
    expect(batch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('Brand');
  });
  it("requires explicit review and confirmation and pins each selected revision", async () => {
    render(<AdsAttributionReview {...props} />);
    fireEvent.click(screen.getAllByLabelText("Select Campaign One")[0]);
    fireEvent.click(screen.getAllByLabelText("Select Campaign Two")[0]);
    fireEvent.click(
      screen.getByRole("button", { name: "Review selected (2)" }),
    );
    expect(batch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm selected attribution" }),
    );
    await waitFor(() => expect(batch).toHaveBeenCalledOnce());
    expect(batch.mock.calls[0][2].map((r) => r.revision)).toEqual([3, 0]);
    expect(props.onUpdated).toHaveBeenCalledOnce();
  });
  it("prevents mixed-identity batch selection", () => {
    const mixed = structuredClone(report);
    mixed.configs.ads[1].creative.object_story_spec.page_id = "88";
    render(<AdsAttributionReview {...props} report={mixed} />);
    fireEvent.click(screen.getAllByLabelText("Select Campaign One")[0]);
    fireEvent.click(screen.getAllByLabelText("Select Campaign Two")[0]);
    expect(
      screen.getByRole("button", { name: "Review selected (2)" }).disabled,
    ).toBe(true);
  });
  it("retains exact retry intent after a failed confirmation", async () => {
    batch
      .mockRejectedValueOnce(new Error("Review changed"))
      .mockResolvedValueOnce([]);
    render(<AdsAttributionReview {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Review" })[0]);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm selected attribution" }),
    );
    await waitFor(() => expect(batch).toHaveBeenCalledOnce());
    await screen.findAllByText("Review changed");
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm selected attribution" }),
    );
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(2));
    expect(batch.mock.calls[1]).toEqual(batch.mock.calls[0]);
  });
});
