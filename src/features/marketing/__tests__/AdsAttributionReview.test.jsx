import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import AdsAttributionReview from "../AdsAttributionReview.jsx";
const { batch } = vi.hoisted(() => ({ batch: vi.fn() }));
vi.mock("../adsService.js", () => ({ adsService: { attributeBatch: batch } }));
const report = {
  account: { id: "111",currency:"MYR",timezone:"Asia/Singapore" },
  date_from:"2025-10-17",date_to:"2026-10-16",
  insights:{campaign:[{campaign_id:"1",metrics:{spend:{value:0,state:"reported"}}}]},
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
  identities: [{channel:"facebook",account_id:"99",brand_id:"brand"},{channel:"facebook",account_id:"88",brand_id:"other"}],
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

it('shows selected-period zero, unavailable spend and coverage before confirming',()=>{
 render(<AdsAttributionReview {...props}/>);
 fireEvent.click(screen.getAllByLabelText('Select Campaign One')[0]);fireEvent.click(screen.getAllByLabelText('Select Campaign Two')[0]);fireEvent.click(screen.getByRole('button',{name:'Review selected (2)'}));
 const dialog=within(screen.getByRole('dialog'));
 expect(dialog.getAllByText('MYR 0').length).toBeGreaterThan(0);
 expect(dialog.getAllByText('No activity reported').length).toBeGreaterThan(0);
 expect(dialog.getAllByText('1/1 ads with identity').length).toBeGreaterThan(0);
 expect(dialog.getAllByText('Verified identities').length).toBeGreaterThan(0);
 expect(dialog.getByText(/Selected period: 2025-10-17/)).toBeTruthy();
 expect(batch).not.toHaveBeenCalled();
});
it('keeps incomplete identity campaigns Unassigned and disables confirmation',()=>{
 const partial=structuredClone(report);partial.configs.ads.push({campaign_id:'1',creative:{id:'unknown'}});
 render(<AdsAttributionReview {...props} report={partial}/>);
 expect(screen.getAllByLabelText('Select Campaign One')[0].disabled).toBe(true);
 fireEvent.click(screen.getAllByRole('button',{name:'Review',exact:true})[0]);
 const dialog=within(screen.getByRole('dialog'));
 expect(dialog.getAllByText('1/2 ads with identity').length).toBeGreaterThan(0);
 expect(dialog.getByRole('button',{name:'Confirm selected attribution'}).disabled).toBe(true);
 expect(batch).not.toHaveBeenCalled();
});
it('opening and closing confirmation never saves attribution',()=>{
 render(<AdsAttributionReview {...props}/>);fireEvent.click(screen.getAllByRole('button',{name:'Review',exact:true})[0]);
 fireEvent.click(screen.getByRole('button',{name:'Close modal'}));expect(screen.queryByRole('dialog')).toBeNull();expect(batch).not.toHaveBeenCalled();
});

it('retains explicit clearing of an existing assignment when identity evidence becomes incomplete',async()=>{
 const partial=structuredClone(report);partial.configs.campaigns[0].feedx_brand_id='brand';partial.configs.ads.push({campaign_id:'1',creative:{id:'unknown'}});
 render(<AdsAttributionReview {...props} report={partial}/>);fireEvent.click(screen.getAllByRole('button',{name:'Review',exact:true})[0]);
 fireEvent.click(screen.getByRole('button',{name:'Confirm selected attribution'}));
 await waitFor(()=>expect(batch).toHaveBeenCalledOnce());expect(batch.mock.calls[0][3]).toBe('');
});
