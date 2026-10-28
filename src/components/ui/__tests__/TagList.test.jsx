import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import TagList from "../TagList.jsx";
afterEach(cleanup);

it("keeps two neutral chips inline and reveals only remaining Locations accessibly", () => {
  const tags = ["Cooking Room", "Preparation Room", "A very long Location name", "Dry Store"];
  render(<TagList tags={tags} maxVisible={2} label="Locations" />);
  expect(screen.queryByText(tags[2])).toBeNull();
  const more = screen.getByRole("button", { name: "Show 2 more Locations" });
  expect(more.textContent).toBe("+2");
  fireEvent.click(more);
  expect(screen.getByRole("dialog", { name: "More Locations" }).textContent).toContain(tags[2]);
  expect(screen.getByRole("dialog").textContent).not.toContain(tags[0]);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(tags).toHaveLength(4);
});

it("preserves unlimited tag display, archived metadata and empty state", () => {
  const { rerender } = render(<TagList tags={[{ id: "old", name: "Legacy", status: "archived" }, "Second", "Third"]} />);
  expect(screen.getByText("Legacy").title).toBe("Archived tag");
  expect(screen.getByText("Third")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<TagList />);
  expect(screen.getByText("—")).toBeTruthy();
});
