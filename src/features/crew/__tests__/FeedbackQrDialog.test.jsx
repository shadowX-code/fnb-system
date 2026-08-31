import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toCanvas = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("qrcode", () => ({ default: { toCanvas } }));
import { FeedbackQrDialog } from "../pages/CrewPerformanceAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", public_feedback_token: "a".repeat(36) };

beforeEach(() => {
  toCanvas.mockClear();
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,qr");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Feedback QR", () => {
  it("generates, copies, and downloads the selected outlet's stable public URL", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<FeedbackQrDialog outlet={outlet} onClose={vi.fn()} />);
    const url = `${window.location.origin}/feedback/${outlet.public_feedback_token}`;
    await waitFor(() => expect(toCanvas).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), url, expect.objectContaining({ width: 256 })));
    expect(screen.getByLabelText("Public feedback link").value).toBe(url);
    fireEvent.click(screen.getByRole("button", { name: /Copy Link/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url));
    fireEvent.click(screen.getByRole("button", { name: /Download QR/i }));
    expect(click).toHaveBeenCalled();
  });
});
