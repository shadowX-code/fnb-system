import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewBottomSheet from "../CrewBottomSheet.jsx";

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
const listeners = new Map();
const visualViewport = {
  height: 720,
  offsetTop: 0,
  addEventListener: vi.fn((name, handler) => listeners.set(name, handler)),
  removeEventListener: vi.fn((name) => listeners.delete(name)),
};

afterEach(() => {
  cleanup();
  listeners.clear();
  vi.clearAllMocks();
  if (originalVisualViewport) Object.defineProperty(window, "visualViewport", originalVisualViewport);
  else delete window.visualViewport;
});

describe("CrewBottomSheet", () => {
  it("tracks the visual viewport so its footer stays inside the usable mobile viewport", async () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport });
    render(<CrewBottomSheet title="Adjust" onClose={() => {}} footer={<button type="button">Save</button>}><input aria-label="Quantity" /></CrewBottomSheet>);
    const backdrop = document.querySelector(".crew-ui-bottom-sheet-backdrop");
    await waitFor(() => expect(backdrop.style.getPropertyValue("--crew-sheet-viewport-height")).toBe("720px"));
    visualViewport.height = 396;
    listeners.get("resize")();
    await waitFor(() => expect(backdrop.style.getPropertyValue("--crew-sheet-viewport-height")).toBe("396px"));
  });

  it("advances a field on Return, dismisses on Done, and supports handle dismissal", () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport });
    const onClose = vi.fn();
    render(<CrewBottomSheet title="Add Asset" onClose={onClose}><input aria-label="Asset name" enterKeyHint="next" /><textarea aria-label="Description" enterKeyHint="done" /></CrewBottomSheet>);
    const name = screen.getByLabelText("Asset name");
    const description = screen.getByLabelText("Description");
    name.focus();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(document.activeElement).toBe(description);
    fireEvent.keyDown(description, { key: "Enter" });
    expect(document.activeElement).not.toBe(description);
    const handle = document.querySelector(".crew-ui-bottom-sheet-handle");
    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerUp(handle, { clientY: 180 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
