import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import useConversationReplyCount, {
  notifyConversationsChanged,
} from "../useConversationReplyCount.js";
import { inboxService } from "../inboxService.js";
vi.mock("../inboxService.js", () => ({
  inboxService: { replyCount: vi.fn() },
}));
afterEach(() => vi.clearAllMocks());
it("uses the canonical aggregate and refreshes after domain changes, without converting failure to zero", async () => {
  inboxService.replyCount.mockResolvedValue({ needs_reply: 3 });
  const { result } = renderHook(() => useConversationReplyCount(true, "user"));
  await waitFor(() => expect(result.current).toBe(3));
  inboxService.replyCount.mockResolvedValue({ needs_reply: 2 });
  act(() => notifyConversationsChanged());
  await waitFor(() => expect(result.current).toBe(2));
  inboxService.replyCount.mockRejectedValue(new Error("denied"));
  act(() => notifyConversationsChanged());
  await waitFor(() => expect(result.current).toBeNull());
});
it("does not read outside Marketing or retain a previous identity count", async () => {
  inboxService.replyCount.mockResolvedValue({ needs_reply: 1 });
  const { result, rerender } = renderHook(
    ({ enabled, id }) => useConversationReplyCount(enabled, id),
    { initialProps: { enabled: true, id: "a" } },
  );
  await waitFor(() => expect(result.current).toBe(1));
  rerender({ enabled: false, id: "b" });
  await waitFor(() => expect(result.current).toBeNull());
  expect(inboxService.replyCount).toHaveBeenCalledTimes(1);
});
it('observes exact metadata, refreshes changed conversations and isolates audio failures from the count',async()=>{
 const sound={observe:vi.fn().mockRejectedValue(new Error('audio blocked')),getSnapshot:()=>({ready:true})};
 const changed=vi.fn();window.addEventListener('feedx:conversations-observed',changed);
 inboxService.replyCount.mockResolvedValue({needs_reply:4,change_token:'one',observed_at:'2026-10-26T08:00:00Z',sound_events:[]});
 const hook=renderHook(()=>useConversationReplyCount(true,'user',sound));await waitFor(()=>expect(sound.observe).toHaveBeenCalledTimes(1));expect(hook.result.current).toBe(4);expect(changed).not.toHaveBeenCalled();
 inboxService.replyCount.mockResolvedValue({needs_reply:5,change_token:'two',observed_at:'2026-10-26T08:00:30Z',sound_events:[]});act(()=>notifyConversationsChanged());await waitFor(()=>expect(hook.result.current).toBe(5));expect(changed).toHaveBeenCalledOnce();
 hook.unmount();window.removeEventListener('feedx:conversations-observed',changed);
});
