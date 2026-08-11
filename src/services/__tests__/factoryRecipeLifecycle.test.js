import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("../auditLogService", () => ({ auditLogService: { createAuditLog: mocks.createAuditLog } }));

import { factoryService } from "../factoryService.js";

const recipe = {
  id: "recipe-1",
  recipe_code: "FGRCP-001",
  recipe_name: "Sambal",
  product_name: "Sambal",
  product_family_id: "family-1",
  version: "v2",
  status: "active",
  yield_quantity: 10,
  uom: "kg",
  items: [],
};

function recipeFetch(result = recipe) {
  return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: result, error: null }) })) })) };
}

describe("Factory Product Recipe trusted lifecycle service contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation(() => recipeFetch());
  });

  it("activates the exact recipe only through the trusted RPC before refreshing its authoritative row", async () => {
    mocks.rpc.mockResolvedValue({ data: { recipe_id: recipe.id }, error: null });
    await factoryService.activateProductRecipe(recipe);
    expect(mocks.rpc).toHaveBeenCalledWith("factory_activate_product_recipe", { p_recipe_id: recipe.id });
    expect(mocks.from).toHaveBeenCalledWith("factory_product_recipes");
  });

  it("creates a new version from only the exact source Recipe identity", async () => {
    const draft = { ...recipe, id: "recipe-2", version: "v3", status: "draft" };
    mocks.rpc.mockResolvedValue({ data: { recipe_id: draft.id, version: draft.version }, error: null });
    mocks.from.mockImplementation(() => recipeFetch(draft));
    const result = await factoryService.createProductRecipeNewVersion(recipe);
    expect(mocks.rpc).toHaveBeenCalledWith("factory_create_product_recipe_new_version", { p_source_recipe_id: recipe.id });
    expect(result).toEqual(expect.objectContaining({ id: draft.id, product_family_id: recipe.product_family_id, version: "v3", status: "draft" }));
  });

  it("archives an active Recipe through the trusted lifecycle RPC and rejects unsupported source states before RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { recipe_id: recipe.id }, error: null });
    await factoryService.archiveProductRecipe(recipe);
    expect(mocks.rpc).toHaveBeenCalledWith("factory_archive_product_recipe", { p_recipe_id: recipe.id });

    await expect(factoryService.archiveProductRecipe({ ...recipe, status: "archived" })).rejects.toThrow("Only active or draft product recipes can be archived.");
  });

  it("keeps Draft delete separate from Active archive at the direct service boundary", async () => {
    const lookup = { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { ...recipe, status: "draft" }, error: null }) })) })) };
    const deletion = { delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) })) };
    mocks.from.mockImplementationOnce(() => lookup).mockImplementationOnce(() => deletion);
    await factoryService.deleteProductRecipe({ ...recipe, status: "draft" });
    expect(deletion.delete).toHaveBeenCalled();

    mocks.from.mockImplementationOnce(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: recipe, error: null }) })) })) }));
    await expect(factoryService.deleteProductRecipe(recipe)).rejects.toThrow("Only draft product recipes can be deleted");
  });

  it("restores an Archived Recipe directly as a Draft without client actor input", async () => {
    const restored = { ...recipe, status: "draft" };
    const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: restored, error: null }) })) })) })) }));
    mocks.from.mockImplementationOnce(() => ({ update }));
    const result = await factoryService.restoreProductRecipe({ ...recipe, status: "archived" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
    expect(result).toEqual(expect.objectContaining({ id: recipe.id, status: "draft" }));
  });
});
