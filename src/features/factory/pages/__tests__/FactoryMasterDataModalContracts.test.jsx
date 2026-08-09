import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryCustomerModal from "../../modals/FactoryCustomerModal.jsx";
import FactorySupplierModal from "../../modals/FactorySupplierModal.jsx";
import StorageLocationModal from "../../modals/FactoryStorageLocationModal.jsx";
import ProductionPlanningParModal from "../../modals/ProductionPlanningParModal.jsx";
import FinishedGoodCategoryModal from "../../modals/finishedGoods/FactoryFinishedGoodCategoryModal.jsx";
import FinishedGoodMasterModal from "../../modals/finishedGoods/FactoryFinishedGoodMasterModal.jsx";
import ProductGroupModal from "../../modals/finishedGoods/FactoryProductGroupModal.jsx";
import RawMaterialCategoryModal from "../../modals/rawMaterials/FactoryRawMaterialCategoryModal.jsx";
import RawMaterialCostModal from "../../modals/rawMaterials/FactoryRawMaterialCostModal.jsx";
import RawMaterialImagePreviewModal from "../../modals/rawMaterials/FactoryRawMaterialImagePreviewModal.jsx";
import RawMaterialMasterModal from "../../modals/rawMaterials/FactoryRawMaterialMasterModal.jsx";

const category = { id: "category-1", name: "Sauces", status: "active" };
const location = { id: "location-1", location_name: "Dry Store", status: "active" };
const family = { id: "family-1", name_en: "Sambal", name_cn: "叁巴酱", category: "Sauces" };
const sku = { id: "sku-1", product_code: "SAM-500", product_family_id: family.id, product_family_name: family.name_en, product_name_en: family.name_en, category_id: category.id, category: category.name, packaging_type: "Pack", pack_size_qty: 500, pack_size_uom: "g", uom: "g", status: "active" };
const material = { id: "material-1", material_code: "CHI", name: "Chili", name_en: "Chili", category_id: category.id, category: category.name, uom: "kg", status: "active", image_url: "https://example.test/chili.png" };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory master-data modal contracts", () => {
  it("opens create modals with their current empty/default master-data payloads", () => {
    const groupView = render(<ProductGroupModal categories={[category]} onClose={vi.fn()} onSave={vi.fn()} onArchive={vi.fn()} />);
    expect(screen.getByText("Create Finished Good")).not.toBeNull();
    expect(screen.getByLabelText("Product Name (EN) *").value).toBe("");
    groupView.unmount();

    const rawView = render(<RawMaterialMasterModal categories={[category]} storageLocations={[location]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText("Create Raw Material")).not.toBeNull();
    expect(screen.getByLabelText("SKU Code *").value).toBe("");
    rawView.unmount();

    const supplierView = render(<FactorySupplierModal onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getAllByText("Create Supplier").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Supplier Name *").value).toBe("");
    supplierView.unmount();

    render(<FactoryCustomerModal onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getAllByText("Create Customer").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Customer Name *").value).toBe("");
  });

  it("preserves Finished Good, packaging SKU, and category identity at their callback boundaries", async () => {
    const saveGroup = vi.fn().mockResolvedValue(undefined);
    const archiveGroup = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<ProductGroupModal initialValue={{ id: family.id, name_en: family.name_en, status: "active" }} categories={[category]} onClose={vi.fn()} onSave={saveGroup} onArchive={archiveGroup} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Finished Good" }));
    await waitFor(() => expect(archiveGroup).toHaveBeenCalledWith(expect.objectContaining({ id: family.id, name_en: family.name_en })));
    unmount();

    const saveSku = vi.fn().mockResolvedValue(undefined);
    const archiveSku = vi.fn().mockResolvedValue(undefined);
    render(<FinishedGoodMasterModal initialValue={sku} categories={[category]} storageLocations={[location]} productFamilies={[family]} onClose={vi.fn()} onSave={saveSku} onArchive={archiveSku} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archiveSku).toHaveBeenCalledWith(sku));
    fireEvent.click(screen.getByRole("button", { name: "Save Packaging SKU" }));
    await waitFor(() => expect(saveSku).toHaveBeenCalledWith(expect.objectContaining({ id: sku.id, product_family_id: family.id, product_code: sku.product_code, pack_size_qty: sku.pack_size_qty })));
  });

  it("preserves Raw Material edit, cost, image, category, and image-upload intent", async () => {
    const saveMaterial = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<RawMaterialMasterModal initialValue={material} categories={[category]} storageLocations={[location]} onClose={vi.fn()} onSave={saveMaterial} />);
    expect(screen.getByRole("img", { name: "Chili" }).getAttribute("src")).toBe(material.image_url);
    vi.spyOn(factoryService, "uploadRawMaterialImage").mockResolvedValue({ publicUrl: "https://example.test/replaced.png" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(["image"], "replacement.png", { type: "image/png" })] } });
    await waitFor(() => expect(factoryService.uploadRawMaterialImage).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ id: material.id })));
    expect(screen.getByRole("img", { name: "Chili" }).getAttribute("src")).toBe("https://example.test/replaced.png");
    fireEvent.click(screen.getByRole("button", { name: "Remove Image" }));
    expect(screen.queryByRole("img", { name: "Chili" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Raw Material" }));
    await waitFor(() => expect(saveMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: material.id, name_en: material.name_en, image_url: "" })));
    unmount();

    const saveCost = vi.fn().mockResolvedValue(undefined);
    render(<RawMaterialCostModal material={material} onClose={vi.fn()} onSave={saveCost} />);
    expect(screen.getByText("Chili")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Unit Cost"), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCost).toHaveBeenCalledWith(expect.objectContaining({ id: material.id, manual_unit_cost: "12.5" })));
  });

  it("renders Raw Material Cost Information for populated and empty fallback costs", () => {
    const view = render(<RawMaterialMasterModal initialValue={{ ...material, manual_unit_cost: 12.5, manual_cost_uom: "kg" }} categories={[category]} storageLocations={[location]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText("RM12.50 / kg")).not.toBeNull();
    view.unmount();
    render(<RawMaterialMasterModal initialValue={{ ...material, manual_unit_cost: "", manual_cost_uom: "" }} categories={[category]} storageLocations={[location]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText("Add a manual fallback cost if this material has no receiving cost yet.")).not.toBeNull();
  });

  it("surfaces image upload failures and keeps the current image authority", async () => {
    vi.spyOn(factoryService, "uploadRawMaterialImage").mockRejectedValue(new Error("Upload unavailable"));
    render(<RawMaterialMasterModal initialValue={material} categories={[category]} storageLocations={[location]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(["image"], "replacement.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByText("Upload unavailable")).not.toBeNull());
    expect(screen.getByRole("img", { name: "Chili" }).getAttribute("src")).toBe(material.image_url);
  });

  it("passes Supplier, Customer, Storage, category, and Par payloads unchanged to their workspace callbacks", async () => {
    const supplier = { id: "supplier-1", supplier_name: "Fresh Farm", supplier_code: "FF", status: "active" };
    const customer = { id: "customer-1", customer_name: "Outlet One", customer_code: "O1", customer_type: "Outlet", status: "active" };
    const saveSupplier = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<FactorySupplierModal initialValue={supplier} onClose={vi.fn()} onSave={saveSupplier} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Supplier" }));
    await waitFor(() => expect(saveSupplier).toHaveBeenCalledWith(expect.objectContaining({ id: supplier.id, supplier_name: supplier.supplier_name })));
    unmount();

    const saveCustomer = vi.fn().mockResolvedValue(undefined);
    const customerView = render(<FactoryCustomerModal initialValue={customer} onClose={vi.fn()} onSave={saveCustomer} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Customer" }));
    await waitFor(() => expect(saveCustomer).toHaveBeenCalledWith(expect.objectContaining({ id: customer.id, customer_name: customer.customer_name })));
    customerView.unmount();

    const saveLocation = vi.fn().mockResolvedValue(undefined);
    const storageView = render(<StorageLocationModal initialValue={location} onClose={vi.fn()} onSave={saveLocation} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    await waitFor(() => expect(saveLocation).toHaveBeenCalledWith(expect.objectContaining({ id: location.id, location_name: location.location_name })));
    storageView.unmount();

    const archiveFinishedCategory = vi.fn().mockResolvedValue(undefined);
    const categoryView = render(<FinishedGoodCategoryModal categories={[category]} canEdit onClose={vi.fn()} onSave={vi.fn()} onArchive={archiveFinishedCategory} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archiveFinishedCategory).toHaveBeenCalledWith(category));
    categoryView.unmount();

    const archiveRawCategory = vi.fn().mockResolvedValue(undefined);
    const rawCategoryView = render(<RawMaterialCategoryModal categories={[category]} canEdit onClose={vi.fn()} onSave={vi.fn()} onArchive={archiveRawCategory} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archiveRawCategory).toHaveBeenCalledWith(category));
    rawCategoryView.unmount();

    const savePar = vi.fn().mockResolvedValue(undefined);
    render(<ProductionPlanningParModal sku={{ ...sku, min_stock_level: 8 }} onClose={vi.fn()} onSave={savePar} />);
    fireEvent.change(screen.getByLabelText("Par Level Qty"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Par Level" }));
    await waitFor(() => expect(savePar).toHaveBeenCalledWith({ sku: expect.objectContaining({ id: sku.id }), par_level: "12" }));
  });

  it("renders the read-only Raw Material image preview from the exact material image", () => {
    render(<RawMaterialImagePreviewModal material={material} onClose={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Chili" }).getAttribute("src")).toBe(material.image_url);
  });
});
