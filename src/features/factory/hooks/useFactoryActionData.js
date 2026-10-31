import { useEffect, useRef, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import { factoryBootstrap } from "../utils/factoryBootstrap.js";

// Optional support never owns route readiness; mutation forms require the complete result.
export default function useFactoryActionData({ scope, action, owner, permissionSignature, hasPermission, sopId = null, enabled = true }) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const permissionRef = useRef(hasPermission);
  permissionRef.current = hasPermission;
  const key = JSON.stringify([scope, action, permissionSignature, sopId, attempt]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const dependencies = new Map();
    let current = true;
    setState(null);
    factoryBootstrap(() => factoryService.listFactoryData({
      scope, action, sopId,
      hasPermission: (code) => permissionRef.current?.(code),
      signal: controller.signal,
      onDependency: (item) => dependencies.set(item.key, item),
    }), controller, undefined, dependencies).then((data) => {
      if (!current) return;
      if (data.accessIssues?.length) throw new Error("Required details are unavailable.");
      setState({ owner, key, data });
    }).catch((error) => {
      if (!current || error.name === "AbortError") return;
      setState({ owner, key, error: error.name === "TimeoutError" ? error.message : "Unable to load required details. Check your access and connection, then retry." });
    });
    return () => { current = false; controller.abort(); };
  }, [scope, action, owner, key, enabled]);
  const active = state?.owner === owner && state?.key === key;
  return { data: enabled && active ? state.data : null, error: enabled && active ? state.error : "", loading: enabled && !active, retry: () => setAttempt((value) => value + 1) };
}
