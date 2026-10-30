import { useMemo } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import useFactoryActionData from "../hooks/useFactoryActionData.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { productionCostRowsFor, recipeCostInfo } from "../utils/factoryCosting.js";
import FactoryFinishedGoodDetailModal from "./FactoryFinishedGoodDetailModal.jsx";

// Catalog readiness is independent of history. Never present a pending/failed history read as empty.
export default function FactoryFinishedGoodHistoryDetail({ recipes, receivings, ...props }) {
  const { can, permissionSet } = useFactoryPermissions();
  const query = useFactoryActionData({ scope: "finished-goods", action: "finished-good-history", owner: props.product.id, permissionSignature: JSON.stringify(permissionSet), hasPermission: can });
  const productionCosts = useMemo(() => query.data ? productionCostRowsFor(
    query.data.productions.filter(row => row.status === "completed"),
    recipes.filter(row => row.status === "active").map(row => ({ ...row, ...recipeCostInfo(row, receivings) })), receivings,
  ) : [], [query.data, recipes, receivings]);
  if (!query.data) return <Modal title={props.product.product_name} onClose={props.onClose} size="2xl">
    <AsyncDataSurface loading={query.loading} error={query.error} errorTitle="Finished Good history unavailable" onRetry={query.retry} />
  </Modal>;
  return <FactoryFinishedGoodDetailModal {...props} productions={query.data.productions} movements={query.data.productMovements} productionCosts={productionCosts} />;
}
