import { useRef, useState } from "react";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CrewMobileModal from "../CrewMobileModal.jsx";
import CrewBottomSheet from "../CrewBottomSheet.jsx";
import "../../../../i18n/index.js";

afterEach(cleanup);

it("keeps safe-area, touch-target and reduced-motion rules on the shared surfaces", () => {
  const css = postcss.parse(readFileSync("src/features/crew/CrewMobileSystem.css", "utf8"));
  for (const kind of ["modal", "bottom-sheet"]) {
    const rules = [];
    css.walkRules((rule) => { if (rule.selector === `.crew-ui-${kind}-close`) rules.push(rule); });
    const dimensions = {};
    rules.forEach((rule) => rule.walkDecls((decl) => { dimensions[decl.prop] = decl.value; }));
    expect(dimensions.width).toBe("44px");
    expect(dimensions.height).toBe("44px");
    const reduced = [];
    css.walkAtRules("media", (media) => {
      if (media.params === "(prefers-reduced-motion: reduce)") media.walkRules((rule) => {
        if (rule.selector.split(",").includes(`.crew-ui-${kind}`)) rule.walkDecls("animation", (decl) => reduced.push(decl.value));
      });
    });
    expect(reduced).toContain("none");
    const backdrop = css.nodes.find((rule) => rule.selector === `.crew-ui-${kind}-backdrop`);
    expect(backdrop.toString()).toContain("env(safe-area-inset");
  }
});

function Harness({ Surface, blocked = false }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [child, setChild] = useState(false);
  const inputRef = useRef(null);
  return <><button onClick={() => setOpen(true)}>Open</button>{open && <Surface title="Action" onClose={() => setOpen(false)} closeDisabled={blocked} initialFocusRef={inputRef} footer={<button onClick={() => setChild(true)}>More</button>}>
    <label>Value<input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} /></label>
    <button disabled>Unavailable</button>
    {child && <CrewBottomSheet title="Nested" onClose={() => setChild(false)}><button>Child action</button></CrewBottomSheet>}
  </Surface>}</>;
}

describe.each([['modal', CrewMobileModal], ['sheet', CrewBottomSheet]])("Crew shared %s", (_, Surface) => {
  it("portals, keeps focus through edits, traps Tab and restores trigger/scroll on Escape", () => {
    const { container } = render(<Harness Surface={Surface} />);
    const trigger = screen.getByText("Open");
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Action" });
    expect(container.contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText("Value"));
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "123" } });
    expect(document.activeElement).toBe(screen.getByLabelText("Value"));
    const last = within(dialog).getByText("More");
    last.focus(); fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(document.body.style.position).toBe("fixed");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("allows only the top sheet to close and retains the underlying scroll lock", () => {
    render(<Harness Surface={Surface} />);
    fireEvent.click(screen.getByText("Open"));
    const more = screen.getByText("More");
    more.focus(); fireEvent.click(more);
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Nested" })).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
  });

  it("gates Close, backdrop and Escape together while saving", () => {
    const view = render(<Harness Surface={Surface} blocked />);
    fireEvent.click(screen.getByText("Open"));
    let dialog = screen.getByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement);
    expect(within(dialog).getByRole("button", { name: "Close" }).disabled).toBe(true);
    expect(screen.getByRole("dialog")).toBe(dialog);
    view.rerender(<Harness Surface={Surface} />);
    dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog.parentElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
