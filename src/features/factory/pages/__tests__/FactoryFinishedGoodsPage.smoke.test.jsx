import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryFinishedGoodsPage from "../FactoryFinishedGoodsPage.jsx";

const sku = { id: "sku-1", product_family_id: "family-1", product_family_name: "Sambal", product_family_name_cn: "叁巴酱", product_name: "Sambal", product_name_en: "Sambal", product_name_cn: "叁巴酱", product_code: "SAM-500", pack_size_qty: 500, pack_size_uom: "g", current_balance: 4, status: "active", is_halal: true, recommended_storage: "freezer", b2b_price: 10, shelf_life_days: 180 };
const data = { finishedGoods: [sku], finishedGoodCategories: [{ id: "cat-1", name: "Sambal" }], productFamilies: [{ id: "family-1", name_en: "Sambal", name_cn: "叁巴酱", status: "active" }], recipes: [{ id: "recipe-1", product_family_id: "family-1", status: "active", yield_quantity: 10, uom: "kg", items: [{ raw_material_id: "rm-1", quantity_used: 10, uom: "kg" }] }], receivings: [{ raw_material_id: "rm-1", unit_cost: 5, uom: "kg", received_date: "2026-08-01" }], productions: [{ id: "production-1", product_name: "Sambal", batch_no: "PB260801-01", production_date: "2026-08-01", good_output_qty: 4, uom: "Packs", qc_status: "Pass" }], productMovements: [{ id: "movement-1", finished_good_id: "sku-1", movement_type: "Production In", quantity: 4, uom: "Packs", movement_date: "2026-08-01" }], productionCosts: [] };

function renderPage(masterData = data) {
  const can = () => true;
  return render(<FactoryPermissionsProvider permissionSet={[]} can={can}><FactoryMasterDataProvider data={masterData}><FactoryNavigationProvider openCreateFinishedGood={vi.fn()} openEditFinishedGood={vi.fn()} archiveFinishedGood={vi.fn()} openFinishedGoodPackagingSku={vi.fn()} archiveFinishedGoodPackagingSku={vi.fn()} openFinishedGoodCategory={vi.fn()}><FactoryFinishedGoodsPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

describe("FactoryFinishedGoodsPage smoke", () => {
  it("renders grouped and commercial table views, then opens the read-only detail modal", () => {
    renderPage();
    expect(screen.getByText("Sambal")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Table View" }));
    expect(screen.getAllByText("RM2.50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RM10.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("75.0%").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    expect(screen.getByText("Finished goods stock, production and movement detail")).not.toBeNull();
  }, 15000);

  it("keeps rendering when a master-data refresh omits optional collections", () => {
    renderPage({
      finishedGoods: undefined,
      finishedGoodCategories: undefined,
      productFamilies: undefined,
      recipes: undefined,
      receivings: undefined,
      productions: undefined,
      productMovements: undefined,
      productionCosts: undefined,
    });
    expect(screen.getAllByText("Finished Goods").length).toBeGreaterThan(0);
    expect(screen.getByText("No Finished Goods")).not.toBeNull();
  });
});
