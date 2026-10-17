import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import MarketingInboxPage from "../MarketingInboxPage.jsx";
import { useAuth } from "../../../auth/AuthContext.jsx";
import { marketingService } from "../marketingService.js";
import { inboxService } from "../inboxService.js";
import { conversationTimeline, socialIdentity, replyOutcomeMessage, replyWasAccepted } from "../inboxPresentation.js";
vi.mock("../../../auth/AuthContext.jsx", () => ({
  useAuth: vi.fn(),
}));
vi.mock("../marketingService.js", () => ({
  marketingService: { context: vi.fn() },
}));
vi.mock("../inboxService.js", () => ({
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
      "markRead",
      "analytics",
      "verifyConnection",
      "sendApproved",
      "sendStatus",
      "sendStaffReply",
      "profiles",
    ].map((k) => [k, vi.fn()]),
  ),
}));
const conversation = {
  id: "c",
  brand_id: "b",
  version: 2,
  title: "Brand B conversation",
  channel: "instagram",
  medium: "dm",
  status: "open",
  priority: "normal",
  tags: [],
  escalation_reasons: [],
  takeover: true,
};
const draft = {
  id: "d",
  status: "approved",
  body: "Exact approved answer",
  source_version: 2,
  provenance: "human",
  source_references: [],
};
let detail;
beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue({ user: { id: "user" }, hasPermission: () => true });
  inboxService.sendStatus.mockResolvedValue({recipient_allowed:true});
  inboxService.preview.mockResolvedValue({state:'human_required'});
  inboxService.profiles.mockResolvedValue({ profiles: {} });
  marketingService.context.mockResolvedValue({
    organizations: [{ id: "o", name: "Organization" }],
    brands: [
      { id: "b", organization_id: "o", name: "Brand B" },
      { id: "other", organization_id: "o", name: "Other Brand" },
    ],
  });
  inboxService.configuration.mockResolvedValue({
    ai_configured: false,
    staff_send_configured: false,
  });
  inboxService.analytics.mockResolvedValue({ volume: 1, unresolved: 1 });
  inboxService.markRead.mockResolvedValue(null);
  inboxService.read.mockResolvedValue({
    rows: [
      {
        ...conversation,
        brand_name: "Brand B",
        latest_message: "Hello",
        latest_message_at: "2026-10-11T01:00:00Z",
        unread_count: 1,
      },
    ],
    total: 1,
    members: [],
    channels: [],
    faqs: [],
    policy: { revision: 0 },
    knowledge: null,
  });
  detail = {
    conversation,
    messages: [
      {
        id: "incoming",
        kind: "incoming",
        body: "Hello",
        occurred_at: "2026-10-11T01:00:00Z",
      },
      {
        id: "note",
        kind: "note",
        body: "Team follow-up",
        actor_name: "Operator",
        occurred_at: "2026-10-11T01:01:00Z",
      },
      {
        id: "read",
        kind: "read",
        body: "Technical receipt",
        occurred_at: "2026-10-11T01:02:00Z",
      },
    ],
    total: 2,
    drafts: [draft],
    artifacts: [],
    members: [],
    window_open: true,
    channel_capability: { receiving_verified: true },
    outbox: [{ draft_id: "d", state: "blocked" }],
  };
  inboxService.detail.mockImplementation(() => Promise.resolve(detail));
});
afterEach(cleanup);
async function select() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Instagram customer/ }),
  );
  await screen.findByText("Team follow-up");
}
it("defaults to social conversations and never substitutes brand identity or renders receipts as chat", async () => {
  render(<MarketingInboxPage />);
  await select();
  expect(inboxService.read).toHaveBeenCalledWith(
    expect.objectContaining({ channel: "social" }),
  );
  expect(screen.queryByText("Brand B conversation")).toBeNull();
  expect(screen.queryByText("Technical receipt")).toBeNull();
  expect(screen.getByRole("article", { name: "Internal note" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Send", exact: true }).disabled,
  ).toBe(true);
  expect(screen.getByRole("button", { name: "AI Suggest" }).disabled).toBe(
    true,
  );
  expect(screen.queryByText(/tokens/)).toBeNull();
});
it("uses the canonical note authority and clears old content on brand scope change", async () => {
  inboxService.command.mockResolvedValue({ conversation });
  render(<MarketingInboxPage />);
  await select();
  fireEvent.click(screen.getByRole("button", { name: "Internal note" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Internal note" }), {
    target: { value: "New staff note" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() =>
    expect(inboxService.command).toHaveBeenCalledWith(
      expect.any(String),
      "o",
      "b",
      conversation,
      "note",
      { body: "New staff note" },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Brand", exact: true }));
  fireEvent.click(screen.getByRole("option", { name: "Other Brand" }));
  await waitFor(() => expect(screen.queryByText("Team follow-up")).toBeNull());
});
it("requires a separate confirmation and cannot resend an uncertain attempt", async () => {
  inboxService.configuration.mockResolvedValue({ staff_send_configured: true });
  render(<MarketingInboxPage />);
  await select();
  fireEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
  expect(inboxService.sendApproved).not.toHaveBeenCalled();
  inboxService.sendApproved.mockImplementation(() => {
    detail = { ...detail, outbox: [{ draft_id: "d", state: "reconciling" }] };
    return Promise.resolve({ state: "reconciling" });
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm send" }));
  await waitFor(() =>
    expect(inboxService.sendApproved).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send", exact: true }).disabled,
    ).toBe(true),
  );
});
it("an edited approved reply cannot be sent without a new draft and approval", async () => {
  inboxService.configuration.mockResolvedValue({ staff_send_configured: true });
  render(<MarketingInboxPage />);
  await select();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send", exact: true }).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Reply"), {
    target: { value: "Changed answer" },
  });
  expect(
    screen.getByRole("button", { name: "Send", exact: true }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(inboxService.command).toHaveBeenCalledWith(
      expect.any(String),
      "o",
      "b",
      conversation,
      "draft",
      { body: "Changed answer" },
    ),
  );
  expect(inboxService.sendApproved).not.toHaveBeenCalled();
});
it("passes assignee/unread filters and shows details only when requested", async () => {
  render(<MarketingInboxPage />);
  await select();
  expect(
    screen.queryByRole("complementary", { name: "Customer details" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Show customer details" }),
  );
  expect(
    screen.getByRole("complementary", { name: "Customer details" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Close customer details" }),
  );
  fireEvent.click(screen.getByRole("button",{name:"More filters",exact:true}));
  fireEvent.click(
    screen.getByRole("button", { name: "Assignee", exact: true }),
  );
  fireEvent.click(screen.getByRole("option", { name: "Assigned to me" }));
  fireEvent.click(screen.getByLabelText("Unread only"));
  await waitFor(() =>
    expect(inboxService.read).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignee: "me", unread: true, page: 1 }),
    ),
  );
});
it("maps receipts only to their exact outbound message and keeps accepted sends without fabricating echoes", () => {
  const records = {
    messages: [
      {
        id: "a",
        kind: "echo",
        provider_message_id: "one",
        body: "First",
        occurred_at: "2026-10-11T01:00:00Z",
      },
      {
        id: "r",
        kind: "read",
        provider_message_id: "two",
        occurred_at: "2026-10-11T01:02:00Z",
      },
    ],
    drafts: [
      { id: "d2", body: "Second" },
      { id: "unsent", body: "Never sent" },
    ],
    outbox: [
      { draft_id: "d1", provider_message_id: "one", state: "sent" },
      {
        draft_id: "d2",
        provider_message_id: "two",
        state: "read",
        sent_at: "2026-10-11T01:01:00Z",
      },
      { draft_id: "unsent", state: "blocked" },
    ],
  };
  const result = conversationTimeline(records);
  expect(result).toHaveLength(2);
  expect(result[0].send_state).toBe("sent");
  expect(result[1]).toMatchObject({ body: "Second", send_state: "read" });
  expect(
    socialIdentity({
      ...conversation,
      customer_profile: { handle: "actual_customer" },
    }).name,
  ).toBe("@actual_customer");
  expect(socialIdentity(conversation).name).toBe("Instagram customer");
});
it("prevents sending outside the messaging window even when staff sending is configured", async () => {
  inboxService.configuration.mockResolvedValue({ staff_send_configured: true });
  detail.window_open = false;
  render(<MarketingInboxPage />);
  await select();
  expect(
    screen.getByRole("button", { name: "Send", exact: true }).disabled,
  ).toBe(true);
  expect(screen.getByText(/Reply window closed/)).toBeTruthy();
});

it('keeps an unsaved reply while refreshing the same conversation',async()=>{
 render(<MarketingInboxPage/>);await select();
 fireEvent.change(screen.getByRole('textbox',{name:'Reply',exact:true}),{target:{value:'Unsaved human reply'}});
 fireEvent.click(screen.getByRole('button',{name:'Refresh',exact:true}));
 await waitFor(()=>expect(inboxService.detail).toHaveBeenCalledTimes(2));
 expect(screen.getByRole('textbox',{name:'Reply',exact:true}).value).toBe('Unsaved human reply');
 expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(true);
});

it('sends a normal editable staff reply without separate per-message approval when every gate permits',async()=>{
 detail.reply_requires_approval=false;
 inboxService.configuration.mockResolvedValue({staff_send_configured:true});
 inboxService.sendStaffReply.mockResolvedValue({state:'sent'});
 render(<MarketingInboxPage/>);await select();
 fireEvent.change(screen.getByLabelText('Reply'),{target:{value:'Reviewed by staff'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'Send',exact:true}));
 await waitFor(()=>expect(inboxService.sendStaffReply).toHaveBeenCalledWith(expect.any(String),conversation,'Reviewed by staff',null));
 expect(screen.queryByRole('button',{name:'Confirm send'})).toBeNull();expect(inboxService.sendApproved).not.toHaveBeenCalled();
});
it('keeps direct replies disabled for excluded test recipients and unresolved send outcomes',async()=>{
 detail.reply_requires_approval=false;detail.outbox=[{draft_id:'d',state:'reconciling'}];
 inboxService.configuration.mockResolvedValue({staff_send_configured:true});inboxService.sendStatus.mockResolvedValue({recipient_allowed:false});
 render(<MarketingInboxPage/>);await select();fireEvent.change(screen.getByLabelText('Reply'),{target:{value:'Do not send'}});
 expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(true);
 expect(inboxService.sendStaffReply).not.toHaveBeenCalled();
});

it('uses an editable AI proposal as a human-confirmed staff reply without autonomous execution',async()=>{
 detail.reply_requires_approval=false;
 detail.artifacts=[{id:'ai-one',kind:'reply',state:'proposed',source_version:2,body:{text:'Approved brand fact',human_required:false}}];
 inboxService.configuration.mockResolvedValue({staff_send_configured:true});inboxService.sendStaffReply.mockResolvedValue({state:'sent'});
 render(<MarketingInboxPage/>);await select();fireEvent.click(screen.getByRole('button',{name:'Use suggestion'}));
 fireEvent.change(screen.getByLabelText('Reply'),{target:{value:'Edited by a person'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(false));
 expect(inboxService.sendStaffReply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Send',exact:true}));
 await waitFor(()=>expect(inboxService.sendStaffReply).toHaveBeenCalledWith(expect.any(String),conversation,'Edited by a person','ai-one'));
 expect(inboxService.reviewAI).not.toHaveBeenCalled();
});

it('distinguishes provider acceptance from delivery and does not accept failed or unknown outcomes',()=>{expect(replyOutcomeMessage({state:'sent'})).toContain('not yet been confirmed');expect(replyOutcomeMessage({state:'reconciling'})).toContain('do not resend');expect(replyOutcomeMessage({state:'failed',code:'provider_token_invalid'})).toContain('Reconnect');for(const state of ['failed','reconciling','pending','prepared'])expect(replyWasAccepted({state})).toBe(false);expect(replyWasAccepted({state:'read'})).toBe(true)});

it.each([{state:'failed',code:'provider_token_invalid'},{state:'reconciling',code:'delivery_receipt_unknown'}])('retains typed staff reply after $state and shows accurate recovery',async result=>{detail.reply_requires_approval=false;inboxService.configuration.mockResolvedValue({staff_send_configured:true});inboxService.sendStaffReply.mockResolvedValue(result);render(<MarketingInboxPage/>);await select();fireEvent.change(screen.getByLabelText('Reply'),{target:{value:'Keep my reviewed reply'}});await waitFor(()=>expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Send',exact:true}));await screen.findByText(replyOutcomeMessage(result));expect(screen.getByLabelText('Reply').value).toBe('Keep my reviewed reply');expect(inboxService.sendStaffReply).toHaveBeenCalledTimes(1)});

it('labels external Meta outbound without staff attribution and retains exact status',async()=>{
 detail.messages.push({id:'external',kind:'echo',body:'Provider-originated answer',message_origin:'meta',send_state:'read',occurred_at:'2026-10-11T01:04:00Z'});
 render(<MarketingInboxPage/>);await select();
 const bubble=screen.getByText('Provider-originated answer').closest('article');
 expect(bubble.getAttribute('aria-label')).toBe('Outgoing message');
 expect(bubble.textContent).toContain('Meta');expect(bubble.textContent).toContain('Read');
 expect(bubble.textContent).not.toContain('Team member');
});
it('renders canonical persisted profiles even when optional enrichment is unavailable', async()=>{
 const existing=inboxService.read.getMockImplementation();
 inboxService.read.mockImplementation(async(...args)=>{const result=await existing(...args);return {...result,rows:result.rows.map(row=>({...row,customer_profile:{display_name:'Verified Profile',available:true}}))};});
 inboxService.profiles.mockRejectedValue(new Error('temporary profile read failure'));
 detail.conversation={...conversation,customer_profile:{display_name:'Verified Profile',available:true}};
 render(<MarketingInboxPage/>);
 fireEvent.click(await screen.findByRole('button',{name:/Verified Profile/}));
 await screen.findByText('Team follow-up');
 expect(screen.getByRole('heading',{name:'Verified Profile'})).toBeTruthy();
 expect(screen.queryByText('Instagram customer')).toBeNull();
});
it('shows honest customer context and existing notes without creating CRM relationships',async()=>{
 render(<MarketingInboxPage/>);await select();
 fireEvent.click(screen.getByRole('button',{name:'Show customer details'}));
 const context=screen.getByRole('complementary',{name:'Customer details'});
 expect(within(context).getByText(/No verified CRM customer link/)).toBeTruthy();
 expect(within(context).getByRole('link',{name:/Open Customer Directory/}).getAttribute('href')).toBe('/marketing/customers');
 fireEvent.click(within(context).getByRole('tab',{name:'Notes',exact:true}));
 expect(within(context).getByText('Team follow-up')).toBeTruthy();
 fireEvent.click(within(context).getByRole('tab',{name:'History',exact:true}));
 expect(within(context).getByText('Reply approvals & AI history')).toBeTruthy();
 expect(inboxService.command).not.toHaveBeenCalled();
});
it('preserves an unsent draft across context tabs, closing context and chat/list navigation',async()=>{
 render(<MarketingInboxPage/>);await select();
 fireEvent.change(screen.getByRole('textbox',{name:'Reply',exact:true}),{target:{value:'Unsent session draft'}});
 fireEvent.click(screen.getByRole('button',{name:'Show customer details'}));
 fireEvent.click(screen.getByRole('tab',{name:'Notes',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Close customer details'}));
 expect(screen.getByRole('textbox',{name:'Reply',exact:true}).value).toBe('Unsent session draft');
 fireEvent.click(screen.getByRole('button',{name:'Back to conversations'}));await select();
 expect(screen.getByRole('textbox',{name:'Reply',exact:true}).value).toBe('Unsent session draft');
});

it('returns keyboard focus to the chat after closing customer context',async()=>{
 render(<MarketingInboxPage/>);await select();
 fireEvent.click(screen.getByRole('button',{name:'Show customer details'}));
 fireEvent.keyDown(screen.getByRole('complementary',{name:'Customer details'}),{key:'Escape'});
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'Show customer details'})));
});

it.each([true, false])('gates Customer Directory by its canonical route permission (allowed=%s)', async allowed => {
 useAuth.mockReturnValue({user:{id:'user'},hasPermission:permission => permission === 'marketing_audience.view' ? allowed : permission === 'platform_customers.view' ? !allowed : true});
 render(<MarketingInboxPage/>);await select();
 fireEvent.click(screen.getByRole('button',{name:'Show customer details'}));
 const context=screen.getByRole('complementary',{name:'Customer details'});
 expect(Boolean(within(context).queryByRole('link',{name:/Open Customer Directory/}))).toBe(allowed);
});

it('automatically previews the latest incoming question without creating a draft or calling AI',async()=>{
 inboxService.preview.mockResolvedValue({state:'human_takeover',faq:{id:'f',answer:'Approved fact'}});
 render(<MarketingInboxPage/>);await select();
 await screen.findByText('Approved fact');expect(inboxService.preview).toHaveBeenCalledWith('c','Hello');
 expect(inboxService.command).not.toHaveBeenCalled();expect(inboxService.suggest).not.toHaveBeenCalled();
});
