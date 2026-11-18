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
  factoryLabelService.publish.mockResolvedValue({});
});
afterEach(cleanup);
describe("dedicated Factory Label Editor", () => {
  it("activates only a saved revision after explicit confirmation", async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<FactoryLabelEditorPage kind="product" entityKey="sku" canEdit onConfirm={confirm} />);
    const name = await screen.findByLabelText("English name");
    const activate = screen.getByRole("button", { name: "Activate Version" });
    fireEvent.change(name, { target: { value: "Reviewed label name" } });
    expect(activate.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(activate.disabled).toBe(false));
    expect(factoryLabelService.saveDraft.mock.calls[0][2].content.product_name).toBe("Reviewed label name");
    expect(factoryLabelService.publish).not.toHaveBeenCalled();
    fireEvent.click(activate);
    await waitFor(() => expect(activate.disabled).toBe(false));
    expect(factoryLabelService.publish).not.toHaveBeenCalled();
    fireEvent.click(activate);
    await waitFor(() => expect(factoryLabelService.publish).toHaveBeenCalledWith(
      "draft", 1, expect.any(String), "Saved version reviewed and activated in Label Studio.", true,
    ));
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
    finish({ id: "draft", revision: 1, state: "draft" });
    await screen.findByRole("status");
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

it("separates Production and history from editable SKU content while keeping the preview mounted", async () => {
  render(
    <FactoryLabelEditorPage
      kind="product"
      entityKey="sku"
      canEdit
      onBack={() => {}}
    />,
  );
  await screen.findByLabelText("English name");
  fireEvent.click(screen.getByRole("tab", { name: "Print Settings" }));
  expect(screen.queryByLabelText("English name")).toBeNull();
  expect(screen.getAllByText("From Production")).toHaveLength(4);
  expect(
    screen.getByRole("img", { name: "Product label live preview" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Additional Content" }));
  expect(screen.getByText("No published versions yet.")).toBeTruthy();
});
