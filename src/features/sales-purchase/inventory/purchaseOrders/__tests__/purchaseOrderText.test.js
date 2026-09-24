import { describe, expect, it } from "vitest";
import { formatPurchaseOrderText } from "../purchaseOrderText.js";

describe("canonical supplier PO text", () => {
  it("keeps the existing Admin clipboard content for future Crew reuse", () => {
    const text = formatPurchaseOrderText({
      status: "submitted", createdAt: "2026-09-24", remark: "Morning delivery",
      lines: [{ itemId: "item-1", requestedQty: 12, unit: "kg", remark: "Fresh stock" }],
    }, {
      supplierName: "Supplier A", outletName: "Outlet B", itemById: new Map([["item-1", { name: "Rice" }]]),
      businessPoNo: () => "PO-100", formatDate: (date) => date, today: "2026-09-24",
    });
    expect(text).toBe("Hi Supplier A,\n\nPlease arrange the following order:\n\nPO No.: PO-100\nDate: 2026-09-24\nOutlet: Outlet B\n\nItems:\n1. Rice — 12 kg\n   Remark: Fresh stock\n\nRemarks:\nMorning delivery\n\nPlease confirm stock availability and delivery date.\n\nThank you.");
  });
});
