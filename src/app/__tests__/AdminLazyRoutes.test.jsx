import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminRouteBoundary from "../AdminRouteBoundary.jsx";
import { routeDetails, salesPurchaseRoutes } from "../routes.jsx";

vi.mock("../../features/factory/pages/FactoryWorkspacePage.jsx", () => ({ default: ({ initialTab }) => <h1>Factory {initialTab}</h1> }));
vi.mock("../../features/sales-purchase/pages/InventoryControlPage.jsx", () => ({ default: ({ initialTab }) => <h1>Inventory {initialTab}</h1> }));
vi.mock("../../features/sales-purchase/pages/AssetTrackingPage.jsx", () => ({ default: () => <h1>Asset Tracking</h1> }));
afterEach(cleanup);

describe("canonical Admin lazy route ownership", () => {
  it.each(["factory_finished_goods", "factory_production", "inventory_master", "inventory_stock_check", "asset_tracking"])("renders direct route %s without changing its props", async (id) => {
    const route = routeDetails[id];
    const Page = route.component;
    render(<AdminRouteBoundary routeKey={id}><Page {...route.props} /></AdminRouteBoundary>);
    const heading = await screen.findByRole("heading");
    expect(heading.textContent).toContain(route.props?.initialTab || "Asset Tracking");
  });

  it("keeps one cached lazy identity for each feature's routes", () => {
    const factory = salesPurchaseRoutes.filter((route) => route.id.startsWith("factory_"));
    expect(new Set(factory.map((route) => route.component)).size).toBe(1);
    expect(routeDetails.inventory_master.component).toBe(routeDetails.inventory_stock_check.component);
    expect(routeDetails.inventory_control.component).toBe(routeDetails.inventory_dashboard.component);
  });
});
