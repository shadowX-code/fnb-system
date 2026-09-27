import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import { getAccessibleOutlets, hasPermission, notifyPermissionDenied } from "../../../../utils/accessControl.js";
import { invalidateInventoryReads } from "../../../../services/inventoryRevalidation.js";
import { formatDate, employeeDisplayName } from "../waste/inventoryWasteService.js";
import { todayInput } from "../InventorySharedPresentation.jsx";
import { formatPurchaseOrderText } from "./purchaseOrderText.js";
import { loadPurchaseOrderDetail, persistRemotePurchaseOrderReceive } from "./inventoryPurchaseOrderService.js";
import InventoryPurchaseOrderDetail from "./InventoryPurchaseOrderDetail.jsx";
import { ReceiveInventoryModal, CopyPoTextModal } from "./ReceiveInventoryModal.jsx";

const businessPoNo = order => order.businessPoNo || order.poNo || "PO";
const statusTone = status => ["completed", "fully_received", "delivered"].includes(status) ? "success"
  : ["draft", "partial_received"].includes(status) ? "warning"
    : ["cancelled"].includes(status) ? "danger" : ["submitted", "supplier_confirmed"].includes(status) ? "info" : "neutral";

// Callers supply identity and shared Auth/UI/context, never PO workflow commands.
export default function InventoryPurchaseOrderSurface({ orderId, auth, ui, outlets, suppliers, initialAction = "detail", onClose }) {
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [action, setAction] = useState(initialAction);
  const [copyText, setCopyText] = useState("");
  const generation = useRef(0);
  const saving = useRef(false);
  const receiptRequest = useRef(null);
  const notify = (title, message = "", tone = "success") => ui?.notify?.({ title, message, tone });
  const canView = hasPermission(auth, "inventory_orders.view");
  const canReceive = hasPermission(auth, "inventory_orders.receive");
  const scope = getAccessibleOutlets(auth, outlets).map(outlet => outlet.id).sort().join("|");
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setState({ status: "loading", data: null, error: "" });
    try {
      if (!canView) throw new Error("Permission required to view purchase orders.");
      const data = await loadPurchaseOrderDetail(orderId);
      if (!scope.split("|").includes(data.order.outletId)) throw new Error("Purchase order is outside your accessible outlets.");
      if (request !== generation.current) return;
      setState({ status: "ready", data, error: "" });
      return data;
    } catch (error) {
      if (request === generation.current) setState({ status: "error", data: null, error: error.message || "Unable to load purchase order." });
    }
  }, [orderId, canView, scope]);
  useEffect(() => {
    setAction(initialAction);
    setCopyText("");
    reload();
    return () => { generation.current += 1; };
  }, [reload, initialAction]);
  const close = () => { if (!saving.current) onClose(); };
  const requestReceive = () => {
    if (!canReceive) return notifyPermissionDenied(ui, "receive inventory");
    setAction("receive");
  };
  const receive = async (rows, remark) => {
    if (saving.current) return;
    if (!canReceive) throw new Error("Permission required to receive inventory.");
    saving.current = true;
    try {
      const fingerprint = JSON.stringify({ orderId, rows, remark });
      if (receiptRequest.current?.fingerprint !== fingerprint) receiptRequest.current = { fingerprint, id: crypto.randomUUID() };
      await persistRemotePurchaseOrderReceive(state.data.order, rows, remark, undefined, receiptRequest.current.id);
    } catch (error) {
      notify("Failed to receive inventory", error.message || "Please try again.", "error");
      throw error;
    } finally {
      saving.current = false;
    }
    // A committed receipt must never be offered for submission again merely
    // because its subsequent read-back failed.
    setAction("detail");
    invalidateInventoryReads({ orderId, outletId: state.data.order.outletId, reason: "purchase-order-received" });
    await reload();
    notify("Inventory received", "Receipt and inventory movement evidence saved.");
  };
  const copy = async text => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setCopyText("");
      setAction("detail");
      notify("PO text copied.");
    } catch {
      setCopyText(text);
      notify("Copy PO Text", "Select and copy the text manually.", "info");
    }
  };
  useEffect(() => {
    if (state.status !== "ready" || action !== "copy") return;
    const { order, items } = state.data;
    copy(formatPurchaseOrderText(order, {
      supplierName: suppliers.find(supplier => supplier.id === order.supplierId)?.name,
      outletName: outlets.find(outlet => outlet.id === order.outletId)?.name,
      itemById: new Map(items.map(item => [item.id, item])), businessPoNo, formatDate, today: todayInput(),
    }));
  }, [state.status, action]);
  if (state.status !== "ready") return <Modal title="Purchase Order Detail" size="xl" onClose={close}>
    <EmptyState title={state.status === "loading" ? "Loading purchase order…" : "Purchase order unavailable"} description={state.error} />
    {state.status === "error" ? <button className="btn-secondary" onClick={reload}>Retry</button> : null}
  </Modal>;
  const { order, items, people, checks } = state.data;
  if (copyText) return <CopyPoTextModal text={copyText} onCopy={copy} onClose={() => { setCopyText(""); setAction("detail"); }} />;
  if (action === "receive" && canReceive) return <ReceiveInventoryModal order={order} displayPoNo={businessPoNo(order)}
    supplier={suppliers.find(supplier => supplier.id === order.supplierId)} outlet={outlets.find(outlet => outlet.id === order.outletId)}
    items={items} onReceive={receive} onClose={() => { if (!saving.current) setAction("detail"); }} />;
  return <InventoryPurchaseOrderDetail order={order} getBusinessPoNo={businessPoNo} suppliers={suppliers}
    outletById={new Map(outlets.map(outlet => [outlet.id, outlet]))} itemById={new Map(items.map(item => [item.id, item]))}
    checks={checks} actorNameByAnyId={id => {
      const person = people.find(person => person.id === id || person.auth_user_id === id);
      return person ? employeeDisplayName(person) : id || "Unknown User";
    }} formatDate={formatDate} statusTone={statusTone} onClose={close} onRequestReceive={requestReceive}
    onCopyPurchaseOrder={() => setAction("copy")} onNotify={notify} onPrint={() => window.print()} onRefresh={reload} />;
}
