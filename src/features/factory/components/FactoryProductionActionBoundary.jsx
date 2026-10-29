import Modal from "../../../components/feedback/Modal.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import useFactoryActionData from "../hooks/useFactoryActionData.js";

// A failed action dependency never replaces route data or exposes a partially ready mutation form.
export default function FactoryProductionActionBoundary({ intent, scope, auth, permissionSignature, onClose, children }) {
  const query = useFactoryActionData({ scope, action: intent.type, owner: intent, permissionSignature, hasPermission: auth?.hasPermission });
  if (query.data) return children(query.data);
  return <Modal title="Production details" onClose={onClose}>
    <AsyncDataSurface loading={query.loading} error={query.error} errorTitle="Production details unavailable" onRetry={query.retry} />
  </Modal>;
}
