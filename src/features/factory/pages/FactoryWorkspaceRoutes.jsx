import { lazy, Suspense, useEffect } from "react";

const FactoryAuditTrailPage = lazy(() => import("./FactoryAuditTrailPage.jsx"));
const FactorySuppliersPage = lazy(() => import("./FactorySuppliersPage.jsx"));
const FactoryCustomersPage = lazy(() => import("./FactoryCustomersPage.jsx"));
const FactoryStorageLocationsPage = lazy(() => import("./FactoryStorageLocationsPage.jsx"));
const FactoryEquipmentPage = lazy(() => import("./FactoryEquipmentPage.jsx"));
const FactoryProductionPlanningPage = lazy(() => import("./FactoryProductionPlanningPage.jsx"));
const FactoryDashboardPage = lazy(() => import("./FactoryDashboardPage.jsx"));
const FactoryFinishedGoodsPage = lazy(() => import("./FactoryFinishedGoodsPage.jsx"));
const FactoryRawMaterialInventoryPage = lazy(() => import("./FactoryRawMaterialInventoryPage.jsx"));
const FactoryMestiCleaningPage = lazy(() => import("./FactoryMestiCleaningPage.jsx"));
const FactoryMestiEquipmentCleaningPage = lazy(() => import("./FactoryMestiEquipmentCleaningPage.jsx"));
const FactoryMestiCalibrationPage = lazy(() => import("./FactoryMestiCalibrationPage.jsx"));
const FactoryMestiHealthDeclarationPage = lazy(() => import("./FactoryMestiHealthDeclarationPage.jsx"));
const FactoryMestiOperatorHygienePage = lazy(() => import("./FactoryMestiOperatorHygienePage.jsx"));
const FactoryMestiWasteDisposalPage = lazy(() => import("./FactoryMestiWasteDisposalPage.jsx"));
const FactoryMestiRawMaterialControlPage = lazy(() => import("./FactoryMestiRawMaterialControlPage.jsx"));
const FactoryMestiFoodProcessingControlPage = lazy(() => import("./FactoryMestiFoodProcessingControlPage.jsx"));
const FactoryMestiFinishedProductStorageControlPage = lazy(() => import("./FactoryMestiFinishedProductStorageControlPage.jsx"));
const FactoryProductRecipesPage = lazy(() => import("./FactoryProductRecipesPage.jsx"));
const FactoryProductionSopPage = lazy(() => import("./FactoryProductionSopPage.jsx"));
const FactoryProductionOverviewPage = lazy(() => import("./FactoryProductionOverviewPage.jsx"));
const FactoryJobOrdersPage = lazy(() => import("./FactoryJobOrdersPage.jsx"));
const FactoryBatchTraceabilityPage = lazy(() => import("./FactoryBatchTraceabilityPage.jsx"));
const FactoryProductFeedbackPage = lazy(() => import("./FactoryProductFeedbackPage.jsx"));
const FactoryPettyCashPage = lazy(() => import("./FactoryPettyCashPage.jsx"));
const FactoryProductMovementsPage = lazy(() => import("./FactoryProductMovementsPage.jsx"));
const FactoryRawMaterialMovementsPage = lazy(() => import("./FactoryRawMaterialMovementsPage.jsx"));

function FactoryRouteReady({ route, onReady, children }) {
  useEffect(() => { onReady?.(route); }, [onReady, route]);
  return children;
}

function LazyFactoryRoute({ route, Page, onReady, children }) {
  return <Suspense fallback={<div className="card p-6 text-sm font-semibold text-text-secondary">Loading Factory workspace...</div>}><FactoryRouteReady route={route} onReady={onReady}>{children || <Page />}</FactoryRouteReady></Suspense>;
}

export default function FactoryWorkspaceRoutes({
  initialTab,
  auth,
  data,
  ui,
  operationalJobs,
  onReady,
  legacy,
}) {
  const notify = ui?.notify;
  const usesWorkspaceLegacyRoute = ["raw-receiving", "raw-stock-check", "production", "reports", "finished-goods-dispatch", "product-stock-check"].includes(initialTab);
  useEffect(() => {
    if (usesWorkspaceLegacyRoute) onReady?.(initialTab);
  }, [initialTab, onReady, usesWorkspaceLegacyRoute]);
  if (initialTab === "product-feedback") return <LazyFactoryRoute route={initialTab} Page={FactoryProductFeedbackPage} onReady={onReady}><FactoryProductFeedbackPage auth={auth} onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "petty-cash") return <LazyFactoryRoute route={initialTab} Page={FactoryPettyCashPage} onReady={onReady}><FactoryPettyCashPage auth={auth} onNotify={notify} onConfirm={ui?.confirm} /></LazyFactoryRoute>;
  if (initialTab === "mesti-equipment-cleaning") return <LazyFactoryRoute route={initialTab} Page={FactoryMestiEquipmentCleaningPage} onReady={onReady}><FactoryMestiEquipmentCleaningPage auth={auth} onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "mesti-food-processing-control") return <LazyFactoryRoute route={initialTab} Page={FactoryMestiFoodProcessingControlPage} onReady={onReady} />;
  if (initialTab === "mesti-calibration") return <LazyFactoryRoute route={initialTab} Page={FactoryMestiCalibrationPage} onReady={onReady}><FactoryMestiCalibrationPage onNotify={notify} onRefreshFactoryData={legacy.loadData} /></LazyFactoryRoute>;
  if (initialTab === "mesti-operator-hygiene") return <LazyFactoryRoute route={initialTab} Page={FactoryMestiOperatorHygienePage} onReady={onReady}><FactoryMestiOperatorHygienePage auth={auth} onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "mesti-waste-disposal") return <LazyFactoryRoute route={initialTab} Page={FactoryMestiWasteDisposalPage} onReady={onReady}><FactoryMestiWasteDisposalPage auth={auth} onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "mesti-raw-material-control") return <LazyFactoryRoute route={initialTab} Page={FactoryMestiRawMaterialControlPage} onReady={onReady} />;
  if (initialTab === "mesti-health-declaration") return <LazyFactoryRoute route={initialTab} Page={FactoryMestiHealthDeclarationPage} onReady={onReady}><FactoryMestiHealthDeclarationPage onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "mesti-finished-product-storage-control") return <LazyFactoryRoute route={initialTab} Page={FactoryMestiFinishedProductStorageControlPage} onReady={onReady}><FactoryMestiFinishedProductStorageControlPage onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "equipment") return <LazyFactoryRoute route={initialTab} Page={FactoryEquipmentPage} onReady={onReady}><FactoryEquipmentPage onCreate={legacy.openEquipment} onEdit={legacy.editEquipment} onManageCategories={legacy.openEquipmentCategories} /></LazyFactoryRoute>;
  if (initialTab === "production-overview") return <LazyFactoryRoute route={initialTab} Page={FactoryProductionOverviewPage} onReady={onReady}><FactoryProductionOverviewPage route={initialTab} auth={auth} openJob={legacy.openJob} startJob={legacy.startJob} completeProduction={legacy.completeProduction} viewCompletedResult={legacy.viewCompletedResult} releaseJob={legacy.releaseJob} cancelJob={legacy.cancelJob} /></LazyFactoryRoute>;
  if (initialTab === "job-orders") return <LazyFactoryRoute route={initialTab} Page={FactoryJobOrdersPage} onReady={onReady}><FactoryJobOrdersPage data={data} auth={auth} can={legacy.can} onCreate={legacy.createJob} onView={legacy.viewJob} onEdit={legacy.editJob} onRelease={legacy.releaseJob} onDelete={legacy.deleteJob} onCancel={legacy.cancelJob} onStart={legacy.startJob} onViewProcess={legacy.viewProcess} onComplete={legacy.completeJob} onViewResult={legacy.viewCompletedResult} jobOrdersListingBridge={legacy.jobOrdersListingBridge} onPermissionDenied={legacy.clearJobOrdersListingPermission} onNotify={notify} jobFinishedGoodName={legacy.jobFinishedGoodName} productionQcTone={legacy.productionQcTone} productionQcDisplayLabel={legacy.productionQcDisplayLabel} /></LazyFactoryRoute>;
  if (initialTab === "raw-inventory") return <LazyFactoryRoute route={initialTab} Page={FactoryRawMaterialInventoryPage} onReady={onReady} />;
  if (initialTab === "raw-receiving") return legacy.renderRawReceiving();
  if (initialTab === "raw-movements") return <LazyFactoryRoute route={initialTab} Page={FactoryRawMaterialMovementsPage} onReady={onReady}><FactoryRawMaterialMovementsPage onNotify={notify} onOpenDetail={legacy.openRawMaterialMovementDetail} onCloseDetail={legacy.closeRawMaterialMovementDetail} /></LazyFactoryRoute>;
  if (initialTab === "raw-stock-check") return legacy.renderRawStockCheck();
  if (initialTab === "production") return legacy.renderProduction(operationalJobs);
  if (initialTab === "reports") return legacy.renderReports();
  if (initialTab === "batch-traceability") return <LazyFactoryRoute route={initialTab} Page={FactoryBatchTraceabilityPage} onReady={onReady}><FactoryBatchTraceabilityPage onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "finished-goods") return <LazyFactoryRoute route={initialTab} Page={FactoryFinishedGoodsPage} onReady={onReady} />;
  if (initialTab === "production-planning") return <LazyFactoryRoute route={initialTab} Page={FactoryProductionPlanningPage} onReady={onReady}><FactoryProductionPlanningPage onNotify={notify} onPermissionDenied={legacy.clearPlanningPermission} /></LazyFactoryRoute>;
  if (initialTab === "finished-goods-dispatch") return legacy.renderFinishedGoodsDispatch();
  if (initialTab === "product-movements") return <LazyFactoryRoute route={initialTab} Page={FactoryProductMovementsPage} onReady={onReady}><FactoryProductMovementsPage onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "product-stock-check") return legacy.renderProductStockCheck();
  if (initialTab === "mesti-cleaning") return <LazyFactoryRoute route={initialTab} Page={FactoryMestiCleaningPage} onReady={onReady}><FactoryMestiCleaningPage auth={auth} onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "product-recipes") return <LazyFactoryRoute route={initialTab} Page={FactoryProductRecipesPage} onReady={onReady} />;
  if (initialTab === "production-sop") return <LazyFactoryRoute route={initialTab} Page={FactoryProductionSopPage} onReady={onReady} />;
  if (initialTab === "audit-logs") return <LazyFactoryRoute route={initialTab} Page={FactoryAuditTrailPage} onReady={onReady}><FactoryAuditTrailPage onNotify={notify} /></LazyFactoryRoute>;
  if (initialTab === "storage-locations") return <LazyFactoryRoute route={initialTab} Page={FactoryStorageLocationsPage} onReady={onReady} />;
  if (initialTab === "suppliers") return <LazyFactoryRoute route={initialTab} Page={FactorySuppliersPage} onReady={onReady} />;
  if (initialTab === "customers") return <LazyFactoryRoute route={initialTab} Page={FactoryCustomersPage} onReady={onReady} />;
  return <LazyFactoryRoute route="dashboard" Page={FactoryDashboardPage} onReady={onReady}><FactoryDashboardPage onRefreshFactoryData={legacy.loadData} /></LazyFactoryRoute>;
}
