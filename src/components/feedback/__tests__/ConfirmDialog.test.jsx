import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ConfirmDialog from "../ConfirmDialog.jsx";

afterEach(cleanup);

describe("ConfirmDialog", () => {
  it("supports a context-specific cancel action label", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog request={{ title: "You have unsaved changes.", message: "Discard or continue?", confirmLabel: "Discard", cancelLabel: "Continue Editing" }} onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue Editing" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
