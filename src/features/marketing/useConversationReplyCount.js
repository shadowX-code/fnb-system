import { useEffect, useState } from "react";
import { inboxService } from "./inboxService.js";
export const CONVERSATIONS_CHANGED = "feedx:conversations-changed";
export function notifyConversationsChanged() {
  window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
}
// Private tables are not exposed to Realtime. The server owns the aggregate.
export default function useConversationReplyCount(enabled, identity) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let live = true,
      running = false,
      queued = false;
    setResult(null);
    async function refresh() {
      if (!enabled) return;
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        const data = await inboxService.replyCount();
        if (live) setResult({ identity, count: data.needs_reply });
      } catch {
        if (live) setResult(null);
      } finally {
        running = false;
        if (live && queued) {
          queued = false;
          refresh();
        }
      }
    }
    const visible = () => {
      if (document.visibilityState !== "hidden") refresh();
    };
    refresh();
    const timer = enabled ? setInterval(visible, 30000) : null;
    window.addEventListener(CONVERSATIONS_CHANGED, refresh);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(CONVERSATIONS_CHANGED, refresh);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, identity]);
  return enabled && result?.identity === identity ? result.count : null;
}
