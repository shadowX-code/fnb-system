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
