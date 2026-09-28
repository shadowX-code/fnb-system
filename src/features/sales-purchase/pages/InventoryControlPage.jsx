import InventoryMasterPage from "../inventory/master/InventoryMasterPage.jsx";
import InventoryPurchaseOrdersWorkspace from "../inventory/purchaseOrders/InventoryPurchaseOrdersWorkspace.jsx";
import InventoryStockCheckRestockSurface from "../inventory/purchaseOrders/InventoryStockCheckRestockSurface.jsx";
import InventoryParLevelsPage from "../inventory/parLevels/InventoryParLevelsPage.jsx";
import InventoryRecipesPage from "../inventory/recipes/InventoryRecipesPage.jsx";
import InventoryRecipeIntelligencePage from "../inventory/recipeIntelligence/InventoryRecipeIntelligencePage.jsx";
import InventoryWastePage from "../inventory/waste/InventoryWastePage.jsx";
import InventoryMovementsPage from "../inventory/movements/InventoryMovementsPage.jsx";
import InventoryGroupsPage from "../inventory/groups/InventoryGroupsPage.jsx";
import InventoryStockCheckResultSurface from "../inventory/stockChecks/InventoryStockCheckResultSurface.jsx";
import InventoryStockCheckPage from "../inventory/stockChecks/InventoryStockCheckPage.jsx";
import InventoryDashboardPage from "../inventory/dashboard/InventoryDashboardPage.jsx";
import { normalizeOutletRecord } from "../inventory/inventoryItemModel.js";
import { navigateAdminRoute } from "../../../app/routeOwnership.js";
import useAdminLocation from "../../../app/useAdminLocation.js";

function InventoryControlPage({ initialTab, store, auth, ui }) {
  const route = useAdminLocation();
  const outlets = (store?.outlets || []).map(normalizeOutletRecord);
  const suppliers = store?.suppliers || [];
  if (route?.definitionId === "inventory-stock-check-restock") return <InventoryStockCheckRestockSurface checkId={route.params.checkId} auth={auth} ui={ui} outlets={outlets} suppliers={suppliers} onClose={() => navigateAdminRoute("inventory_stock_check", {}, route.query)} />;
  if (route?.definitionId === "inventory-stock-check-result") return <InventoryStockCheckResultSurface checkId={route.params.checkId} auth={auth} outlets={outlets} onClose={() => navigateAdminRoute("inventory_stock_check", {}, route.query)} />;
  if (initialTab === "stock-check") return <InventoryStockCheckPage auth={auth} ui={ui} outlets={outlets} />;
  if (initialTab === "orders") return <InventoryPurchaseOrdersWorkspace auth={auth} ui={ui} outlets={outlets} suppliers={suppliers} />;
  if (initialTab === "recipe-intelligence") return <InventoryRecipeIntelligencePage auth={auth} outlets={outlets} />;
  if (initialTab === "recipes") return <InventoryRecipesPage auth={auth} ui={ui} outlets={outlets} />;
  if (initialTab === "master") return <InventoryMasterPage auth={auth} ui={ui} outlets={outlets} suppliers={suppliers} />;
  if (initialTab === "movements") return <InventoryMovementsPage auth={auth} ui={ui} outlets={outlets} suppliers={suppliers} />;
  if (initialTab === "par-levels") return <InventoryParLevelsPage auth={auth} ui={ui} outlets={outlets} suppliers={suppliers} />;
  if (initialTab === "waste") return <InventoryWastePage auth={auth} ui={ui} outlets={outlets} />;
  if (initialTab === "groups") return <InventoryGroupsPage auth={auth} ui={ui} outlets={outlets} />;
  return <InventoryDashboardPage auth={auth} store={store} />;
}

export default InventoryControlPage;
