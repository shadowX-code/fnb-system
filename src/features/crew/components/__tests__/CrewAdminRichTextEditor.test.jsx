import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewAdminRichTextEditor from "../CrewAdminRichTextEditor.jsx";

Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) });
Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) });
afterEach(cleanup);

function selectEditorText(surface) {
  const range = document.createRange();
  range.selectNodeContents(surface.querySelector("p"));
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  fireEvent(document, new Event("selectionchange"));
}

describe("Crew Admin rich text editor", () => {
  it("formats a selected passage and emits safe HTML", async () => {
    const onChange = vi.fn();
    render(<CrewAdminRichTextEditor value="<p>Service step</p>" onChange={onChange} />);
    const surface = await screen.findByRole("textbox", { name: "Content" });
    surface.focus();
    selectEditorText(surface);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall[0]).toContain("<strong>Service step</strong>");
  });

  it("applies a controlled text tone and highlight without inline colour styles", async () => {
    const onChange = vi.fn();
    render(<CrewAdminRichTextEditor value="<p>Service step</p>" onChange={onChange} />);
    const surface = await screen.findByRole("textbox", { name: "Content" });
    surface.focus();
    selectEditorText(surface);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent.click(screen.getByRole("button", { name: "Text Color" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "FeedX Teal" }));
    await waitFor(() => expect(onChange.mock.lastCall[0]).toContain('data-feedx-text-tone="teal"'));
    selectEditorText(surface);
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mist Mint" }));
    await waitFor(() => expect(onChange.mock.lastCall[0]).toContain('data-feedx-highlight="mint"'));
    expect(onChange.mock.lastCall[0]).not.toContain("style=");
  });

  it("keeps the private section image action separate from inline HTML", async () => {
    const onImage = vi.fn();
    const onChange = vi.fn();
    render(<CrewAdminRichTextEditor value="<p>Text</p>" onChange={onChange} onImage={onImage} />);
    const picker = document.querySelector('input[type="file"]');
    expect(await screen.findByRole("button", { name: "Add or replace section image" })).not.toBeNull();
    fireEvent.change(picker, { target: { files: [new File(["image"], "section.png", { type: "image/png" })] } });
    expect(onImage).toHaveBeenCalledWith(expect.objectContaining({ name: "section.png" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds and removes a safe link, then undoes and redoes the change", async () => {
    const onChange = vi.fn();
    render(<CrewAdminRichTextEditor value="<p>Open guide</p>" onChange={onChange} />);
    const surface = await screen.findByRole("textbox", { name: "Content" });
    surface.focus();
    selectEditorText(surface);
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link URL" }), { target: { value: "https://feedx.my" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Link" }));
    await waitFor(() => expect(onChange.mock.lastCall[0]).toContain('href="https://feedx.my"'));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(onChange.mock.lastCall[0]).not.toContain("href="));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(onChange.mock.lastCall[0]).toContain('href="https://feedx.my"'));
    selectEditorText(surface);
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Link" }));
    await waitFor(() => expect(onChange.mock.lastCall[0]).not.toContain("href="));
  });
});
