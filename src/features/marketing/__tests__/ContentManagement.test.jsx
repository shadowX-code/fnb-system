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
    metrics: { reach: 5, likes: 0, comments: 0, interactions: 0 },
    provider_post_id: "123",
    permalink: "https://www.instagram.com/p/test/",
  }],
};
const props = {
  organizationId: "org",
  brandId: "brand",
  refresh: 0,
  open: vi.fn(),
  command: vi.fn(),
  can: () => true,
};
beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem("admin.presentation.marketing.content.test-user","list");
  vi.clearAllMocks();
  service.contentManagement.mockResolvedValue({
    rows: [row],
    total_count: 1,
    day_counts: { "2026-05-22": 1 },draft_count:3,
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
  fireEvent.click(screen.getAllByRole("button", { name: "Real external post" })[0]);
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
  fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
  fireEvent.click(screen.getByRole("button", { name: "Month / Year" }));
  fireEvent.click(screen.getByRole("gridcell", { name: "May", exact: true }));
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
  await screen.findByText("No content yet");
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
  expect(screen.getAllByText("Succeeded").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /Execute|Publish now/ }))
    .toBeNull();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
});

it("uses the shared active-filter contract and allows removing a filter", async () => {
  render(<ContentManagement {...props} />);
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole('button',{name:'Date Range',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Today',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Apply',exact:true}));
  const remove = await screen.findByRole("button", {
    name: "Remove From filter",
  });
  expect(screen.queryByRole("button", { name: "Remove undefined filter" }))
    .toBeNull();
  fireEvent.click(remove);
  await waitFor(() =>
    expect(service.contentManagement.mock.calls.at(-1)[0].from).toBeNull()
  );
});

it('persists configurable metric columns without changing shared records',async()=>{
 render(<ContentManagement {...props}/>);await screen.findByRole('table');fireEvent.click(screen.getByRole('button',{name:'Columns'}));fireEvent.click(screen.getByRole('checkbox',{name:'Saves'}));expect(localStorage.getItem('admin.presentation.marketing.metrics.test-user')).toContain('saves');expect(screen.getByRole('columnheader',{name:'Saves'})).toBeTruthy();expect(service.contentManagement.mock.calls.at(-1)[0].view).toBe('list');
});

it('opens a row through pointer, keyboard and View once, while expansion stays independent',async()=>{
 render(<ContentManagement {...props}/>);await screen.findByRole('table');
 expect(screen.queryByRole('columnheader',{name:'Brand'})).toBeNull();
 for(const label of ['Reach','Views','Interactions','Likes','Comments','Shares'])expect(screen.getByRole('columnheader',{name:label})).toBeTruthy();
 const tr=screen.getByRole('table').querySelector('tbody tr');
 fireEvent.keyDown(tr,{key:'Enter'});expect(await screen.findByRole('dialog')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Close modal'}));
 fireEvent.click(tr);expect(await screen.findByRole('dialog')).toBeTruthy();
});

it('defaults to Calendar for users without a view preference',async()=>{localStorage.clear();render(<ContentManagement {...props}/>);await waitFor(()=>expect(service.contentManagement).toHaveBeenCalled());expect(screen.getByRole('tab',{name:'Calendar'}).getAttribute('aria-selected')).toBe('true');});
it('opens canonical undated Drafts in the existing editor and synchronizes quick/status filters',async()=>{const draft={...row,key:'draft',id:'draft',origin:'feedx',status:'draft',revision:4,payload:{title:'Saved Draft',outlet_ids:[],variants:[{channel:'facebook',format:'text',caption:'Retained caption',asset_ids:[]}]},title:'Saved Draft',display_at:null,channels:[{channel:'facebook',status:'draft'}]};service.contentManagement.mockResolvedValue({rows:[draft],total_count:1,draft_count:3});render(<ContentManagement {...props}/>);const shortcut=await screen.findByRole('button',{name:'Drafts 3'});fireEvent.click(shortcut);await waitFor(()=>expect(service.contentManagement).toHaveBeenLastCalledWith(expect.objectContaining({view:'list',status:'draft',from:null,to:null})));fireEvent.click(screen.getAllByRole('button',{name:'Saved Draft',exact:true})[0]);expect(props.open).toHaveBeenCalledWith(expect.objectContaining({type:'content',content:draft,payload:draft.payload}));fireEvent.click(screen.getByRole('button',{name:'Scheduled',exact:true}));expect(screen.getByRole('button',{name:'Status',exact:true}).textContent).toContain('Scheduled');fireEvent.click(screen.getByRole('button',{name:'Status',exact:true}));fireEvent.click(screen.getByRole('option',{name:'Published',exact:true}));expect(screen.getByRole('button',{name:'Published',exact:true}).getAttribute('aria-pressed')).toBe('true');});
it('refreshes counts without dropping active Brand, search or Draft filters',async()=>{const view=render(<ContentManagement {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Drafts 3'}));fireEvent.change(screen.getByRole('searchbox',{name:'Search content'}),{target:{value:'Lunch'}});await waitFor(()=>expect(service.contentManagement).toHaveBeenLastCalledWith(expect.objectContaining({search:'Lunch',status:'draft'})));service.contentManagement.mockResolvedValue({rows:[],total_count:0,draft_count:4});view.rerender(<ContentManagement {...props} refresh={2}/>);await screen.findByRole('button',{name:'Drafts 4'});expect(service.contentManagement).toHaveBeenLastCalledWith(expect.objectContaining({brandId:props.brandId,search:'Lunch',status:'draft',view:'list'}));});

it('keeps removed visibility a server filter, Calendar-only, and preserves List history',async()=>{
 render(<ContentManagement {...props}/>);await screen.findByRole('table');
 expect(screen.queryByRole('checkbox',{name:'Show Removed'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'Calendar'}));
 const toggle=await screen.findByRole('checkbox',{name:'Show Removed'});expect(toggle.checked).toBe(false);
 await waitFor(()=>expect(service.contentManagement).toHaveBeenLastCalledWith(expect.objectContaining({view:'calendar',showRemoved:false})));
 fireEvent.click(toggle);await waitFor(()=>expect(service.contentManagement).toHaveBeenLastCalledWith(expect.objectContaining({view:'calendar',showRemoved:true})));
 fireEvent.click(screen.getByRole('tab',{name:'List'}));expect(screen.queryByRole('checkbox',{name:'Show Removed'})).toBeNull();
 await waitFor(()=>expect(service.contentManagement).toHaveBeenLastCalledWith(expect.objectContaining({view:'list'})));
});
