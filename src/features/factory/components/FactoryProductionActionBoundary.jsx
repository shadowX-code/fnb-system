import { useEffect, useRef, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { factoryBootstrap } from "../utils/factoryBootstrap.js";

// A failed action dependency never replaces route data or exposes a partially ready mutation form.
export default function FactoryProductionActionBoundary({ intent, scope, auth, permissionSignature, onClose, children }) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const authRef = useRef(auth);
  authRef.current = auth;
  useEffect(() => {
    const controller = new AbortController();
    const dependencies = new Map();
    let current = true;
    setState({ intent, loading: true });
    factoryBootstrap(() => factoryService.listFactoryData({
      scope,
      action: intent.type,
      hasPermission: (code) => authRef.current?.hasPermission?.(code),
      signal: controller.signal,
      onDependency: (item) => dependencies.set(item.key, item),
    }), controller, undefined, dependencies).then((data) => {
      if (!current) return;
      if (data.accessIssues?.length) throw new Error(`Required production details are unavailable: ${data.accessIssues.map((issue) => issue.label).join(", ")}. Check your access or retry.`);
      setState({ intent, data });
    }).catch((error) => {
      if (!current || error.name === "AbortError") return;
      setState({ intent, error: error.name === "TimeoutError" ? error.message : "Unable to load required production details. Check your access and connection, then retry." });
    });
    return () => { current = false; controller.abort(); };
  }, [intent, scope, permissionSignature, attempt]);

  if (state?.intent === intent && state.data) return children(state.data);
  return <Modal title="Production details" onClose={onClose}>
    <AsyncDataSurface loading={state?.intent !== intent || state?.loading} error={state?.intent === intent ? state.error : ""} errorTitle="Production details unavailable" onRetry={() => setAttempt((value) => value + 1)} />
  </Modal>;
}
