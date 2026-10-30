import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  it("edits label-only content, saves a draft, and requires explicit review before publishing", async () => {
    render(
      <FactoryLabelEditorPage
        kind="product"
        entityKey="sku"
        canEdit
        onBack={() => {}}
      />,
    );
    await screen.findByRole("heading", { name: "Product Label Editor" });
    fireEvent.change(screen.getByLabelText("English name"), {
      target: { value: "Approved label name" },
    });
    fireEvent.change(screen.getByLabelText("Storage instructions"), {
      target: { value: "Freezer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review & Publish" }));
    await screen.findByRole("heading", {
      name: "Approve and publish version 1",
    });
    expect(
      factoryLabelService.saveDraft.mock.calls[0][2].content.product_name,
    ).toBe("Approved label name");
    expect(
      screen.getByRole("button", { name: "Approve & Publish" }).disabled,
    ).toBe(true);
    expect(factoryLabelService.publish).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Approval / publication reason"), {
      target: { value: "Reviewed reference content" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Approve & Publish" }));
    await waitFor(() =>
      expect(factoryLabelService.publish).toHaveBeenCalledWith(
        "draft",
        1,
        expect.any(String),
        "Reviewed reference content",
        true,
      ),
    );
    expect(data.sku.product_name).toBe("Sambal");
    expect(screen.queryByLabelText("Manufacturing date")).toBeNull();
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
    const button = screen.getByRole("button", { name: "Save Draft" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(factoryLabelService.saveDraft).toHaveBeenCalledTimes(1);
    expect(factoryLabelService.publish).not.toHaveBeenCalled();
    finish({ id: "draft", revision: 1, state: "draft" });
    await screen.findByText(/Draft saved/);
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
    expect(screen.queryByRole("button", { name: "Save Draft" })).toBeNull();
  });
});
