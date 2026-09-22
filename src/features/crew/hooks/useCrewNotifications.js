import { useCallback, useEffect, useRef, useState } from "react";
import { crewService } from "../../../services/crewService.js";

// The bell is a persisted Platform projection. Domain pages never own or infer it.
export default function useCrewNotifications(token, refreshKey) {
  const [unreadCount, setUnreadCount] = useState(0);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    if (!token) return 0;
    const id = ++request.current;
    try {
      const next = await crewService.notificationUnreadCount(token);
      const count = Math.max(0, Number(next?.unread_count) || 0);
      if (id === request.current) setUnreadCount(count);
      return count;
    } catch {
      // A transient badge read must not make the Crew shell unusable.
      return 0;
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const onForeground = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [refresh, refreshKey]);

  return { unreadCount, refreshUnreadCount: refresh };
}
