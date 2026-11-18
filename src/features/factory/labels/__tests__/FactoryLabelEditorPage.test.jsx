import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
global.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
import FactoryLabelEditorPage from "../FactoryLabelEditorPage.jsx";
import { factoryLabelService } from "../../../../services/factoryLabelService.js";
vi.mock("../../../../services/factoryLabelService.js", () => ({
  factoryLabelService: {
    editor: vi.fn(),
    saveDraft: vi.fn(),
    publish: vi.fn(),
  },
}));
vi.mock("../useLabelPreview.js", () => ({
  default: () => ({
    image: "data:image/png;base64,test",
    error: "",
    loading: false,
  }),
}));
const definition = {
  width_mm: 70,
  height_mm: 100,
  elements: [
    { type: "text", field: "product_name", x: 5, y: 5, w: 70, h: 10, size: 3 },
  ],
};
const data = {
  sku: {
    id: "sku",
    product_name: "Sambal",
    product_code: "S9",
    pack_size_qty: 1,
    pack_size_uom: "kg",
  },
  templates: [
    {
      id: "template",
      template_key: "s08",
      name: "S08",
      version: 1,
      definition,
    },
  ],
  published: null,
  draft: null,
  history: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  factoryLabelService.editor.mockResolvedValue(data);
  factoryLabelService.saveDraft.mockImplementation(
    async (kind, key, payload) => ({
      id: "draft",
      revision: 1,
      payload,
      state: "draft",
    }),
  );
  factoryLabelService.publish.mockResolvedValue({ id: "draft", state: "published", base_version: 0, published_id: "v1" });
});
afterEach(cleanup);
describe("dedicated Factory Label Editor", () => {
  it("activates only a saved revision after explicit confirmation", async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const notify = vi.fn();
    render(<FactoryLabelEditorPage kind="product" entityKey="sku" canEdit onConfirm={confirm} onNotify={notify} />);
    const name = await screen.findByLabelText("English name");
    const activate = screen.getByRole("button", { name: "Activate Version" });
    fireEvent.change(name, { target: { value: "Reviewed label name" } });
    expect(activate.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(activate.disabled).toBe(false));
    expect(factoryLabelService.saveDraft.mock.calls[0][2].content.product_name).toBe("Reviewed label name");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft saved" }));
    expect(factoryLabelService.publish).not.toHaveBeenCalled();
    fireEvent.click(activate);
    await waitFor(() => expect(activate.disabled).toBe(false));
    expect(factoryLabelService.publish).not.toHaveBeenCalled();
    factoryLabelService.editor.mockResolvedValue({
      ...data,
      published: { id: "v1", version: 1, template_id: "template", content: { product_name: "Reviewed label name" } },
      draft: { id: "draft", revision: 1, state: "published" },
    });
    fireEvent.click(activate);
    await waitFor(() => expect(factoryLabelService.publish).toHaveBeenCalledWith(
      "draft", 1, expect.any(String), "Saved version reviewed and activated in Label Studio.", true,
    ));
    expect(await screen.findByText("Active version v1")).toBeTruthy();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Version 1 activated" }));
    expect(data.sku.product_name).toBe("Sambal");
  });
  it("leaves approved printing untouched while drafts are edited and prevents duplicate saves", async () => {
    let finish;
    factoryLabelService.saveDraft.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    render(
      <FactoryLabelEditorPage
        kind="product"
        entityKey="sku"
        canEdit
        onBack={() => {}}
      />,
    );
    await screen.findByLabelText("English name");
    const button = screen.getByRole("button", { name: "Save", exact: true });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(factoryLabelService.saveDraft).toHaveBeenCalledTimes(1);
    expect(factoryLabelService.publish).not.toHaveBeenCalled();
    finish({ id: "draft", revision: 1, state: "draft", payload: factoryLabelService.saveDraft.mock.calls[0][2] });
    await screen.findByText("Draft saved · revision 1");
  });
  it("exposes an inspectable read-only editor without mutation actions", async () => {
    render(
      <FactoryLabelEditorPage
        kind="product"
        entityKey="sku"
        canEdit={false}
        onBack={() => {}}
      />,
    );
    await screen.findByLabelText("English name");
    expect(screen.getByLabelText("English name").disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save", exact: true })).toBeNull();
  });
});

it("derives editable fields and dimensions from the selected pinned template", async () => {
  factoryLabelService.editor.mockResolvedValue({
    ...data,
    published: { version: 2, template_id: "template", storage_instructions: "Keep frozen" },
    templates: [
      ...data.templates,
      { id: "second", template_key: "second", name: "Second layout", version: 3, definition: {
        width_mm: 40, height_mm: 50, elements: [
          { ...definition.elements[0], field: "product_name_cn" },
          { ...definition.elements[0], field: "product_code" },
          { ...definition.elements[0], field: "batch_no" },
        ],
      } },
    ],
  });
  render(<FactoryLabelEditorPage kind="product" entityKey="sku" canEdit />);
  await screen.findByLabelText("English name");
  expect(screen.queryByLabelText("Chinese name")).toBeNull();
  expect(screen.queryByLabelText("Ingredients")).toBeNull();
  expect(screen.queryByLabelText("Storage instructions")).toBeNull();
  expect(screen.queryByLabelText("Width (mm)")).toBeNull();
  expect(screen.getByText("70 × 100 mm · 203 DPI")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Automatic Production fields" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Product label live preview" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Template version" }));
  fireEvent.click(await screen.findByText("Second layout · v3"));
  expect(screen.queryByLabelText("English name")).toBeNull();
  expect(screen.getByLabelText("Chinese name")).toBeTruthy();
  expect(screen.queryByLabelText("Batch No.")).toBeNull();
  expect(screen.queryByLabelText("SKU code")).toBeNull();
  expect(screen.getByText("40 × 50 mm · 203 DPI")).toBeTruthy();
  expect(screen.getByText("Active version v2")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Activate Version" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await screen.findByText("Draft saved · revision 1");
  expect(factoryLabelService.saveDraft.mock.calls[0][2]).toMatchObject({ template_id: "second", width_mm: 40, height_mm: 50 });
  expect(factoryLabelService.publish).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Version History" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Version History" }));
  expect(screen.getByRole("dialog", { name: "Version History" })).toBeTruthy();
});

it("reorders template layers with the shared keyboard handle and saves their raster order", async () => {
  const border = { type: "rect", x: 3, y: 3, w: 74, h: 84 };
  factoryLabelService.editor.mockResolvedValue({
    ...data,
    published: { version: 1, name: "Label template", definition: { ...definition, elements: [border, ...definition.elements] } },
  });
  render(<FactoryLabelEditorPage kind="template" entityKey="test" canEdit />);
  await screen.findByRole("heading", { name: "Template Settings" });
  const handle = screen.getByRole("button", { name: /Reorder English name, layer 2/ });
  handle.focus();
  fireEvent.keyDown(handle, { key: "ArrowUp" });
  expect(screen.getByText("English name moved to layer 1 of 2.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Layer 1: English name" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: /Reorder English name, layer 1/ })).toBe(handle);
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await screen.findByText("Draft saved · revision 1");
  expect(factoryLabelService.saveDraft.mock.calls[0][2].definition.elements).toEqual([...definition.elements, border]);
});

it("preserves edits and reports the specific save error through FeedX notifications", async () => {
  const notify = vi.fn();
  const confirm = vi.fn().mockResolvedValue(false);
  factoryLabelService.saveDraft.mockRejectedValue(new Error("Draft changed. Reload before saving."));
  render(<FactoryLabelEditorPage kind="product" entityKey="sku" canEdit onNotify={notify} onConfirm={confirm} />);
  const name = await screen.findByLabelText("English name");
  fireEvent.change(name, { target: { value: "My pending edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect((await screen.findByRole("alert")).textContent).toBe("Draft changed. Reload before saving.");
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Unable to save draft", tone: "error" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Shared Template" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Leave Label Editor?" })));
  expect(name.value).toBe("My pending edit");
});
