import { useEffect, useRef, useState } from "react";
import { inboxService } from "./inboxService.js";
import {NOTIFICATION_SOUND_READY} from '../../services/notificationSound.js';
export const CONVERSATIONS_OBSERVED = 'feedx:conversations-observed';
export const CONVERSATIONS_CHANGED = "feedx:conversations-changed";
export function notifyConversationsChanged() {
  window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
}
// Private tables are not exposed to Realtime. The server owns the aggregate.
export default function useConversationReplyCount(enabled, identity, sound) {
  const callback=useRef(sound);callback.current=sound;
  const [result, setResult] = useState(null);
  useEffect(() => {
    let live = true,
      running = false,
      queued = false,
      token = null;
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
        if (live) {
          setResult({ identity, count: data.needs_reply });
          if(token && data.change_token && token!==data.change_token)
            window.dispatchEvent(new CustomEvent(CONVERSATIONS_OBSERVED,{detail:{identity}}));
          token=data.change_token;
          if(callback.current){
            let snapshot=data;
            if(callback.current.getSnapshot().ready&&data.sound_events?.some(event=>event.automatic_candidate)) {
              try {
                const configuration=await inboxService.configuration();
                snapshot={...data,sound_events:data.sound_events.map(event=>({...event,automatic_candidate:event.automatic_candidate&&configuration.ai_auto_configured!==false}))};
              } catch { /* Unknown automatic ownership stays silent. */ }
            }
            if(live)try{await callback.current.observe(snapshot)}catch{/* Sound failure must not hide the authorized count. */}
          }
        }
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
    window.addEventListener(NOTIFICATION_SOUND_READY, refresh);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(CONVERSATIONS_CHANGED, refresh);
      window.removeEventListener(NOTIFICATION_SOUND_READY, refresh);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, identity]);
  return enabled && result?.identity === identity ? result.count : null;
}
