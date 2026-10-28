import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminSortableList from "../AdminSortableList.jsx";

function renderSortable(onMove) {
  const items = ["one", "two", "three"].map((id) => ({ id, title: id }));
  const view = render(
    <AdminSortableList items={items} scope="test" onMove={onMove}>
      {({ item, handle }) => <div>{handle}<span>{item.title}</span></div>}
    </AdminSortableList>,
  );
  const positions = { one: 0, two: 40, three: 80 };
  Object.entries(positions).forEach(([id, top]) => {
    const row = view.container.querySelector(`[data-sortable-item-id="${id}"]`);
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top, height: 32 });
  });
  return view;
}

describe("AdminSortableList", () => {
  it("moves an item through the dedicated pointer drag handle", async () => {
    const onMove = vi.fn();
    renderSortable(onMove);

    const handle = screen.getByRole("button", { name: /Reorder item 2/ });
    fireEvent.pointerDown(handle, { pointerId: 8, button: 0, clientY: 56 });
    fireEvent.pointerMove(window, { pointerId: 8, clientY: 84 });
    fireEvent.pointerUp(window, { pointerId: 8, clientY: 84 });

    await waitFor(() => expect(onMove).toHaveBeenCalledWith("two", "three", "before"));
  });

  it("does not reorder when the handle is merely clicked", async () => {
    const onMove = vi.fn();
    renderSortable(onMove);

    const handle = screen.getByRole("button", { name: /Reorder item 2/ });
    fireEvent.pointerDown(handle, { pointerId: 8, button: 0, clientY: 56 });
    fireEvent.pointerUp(window, { pointerId: 8, clientY: 56 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onMove).not.toHaveBeenCalled();
  });
});

afterEach(cleanup);

it('disables handles and cancels an in-flight move when the order or enabled state changes',()=>{
 const onMove=vi.fn(),items=[{id:'one'},{id:'two'}];
 const props={items,onMove};const view=render(<AdminSortableList {...props}>{({item,handle})=><div>{handle}{item.id}</div>}</AdminSortableList>);
 const handle=screen.getByRole('button',{name:/Reorder item 1/});fireEvent.pointerDown(handle,{pointerId:9,button:0,clientY:10});fireEvent.pointerMove(window,{pointerId:9,clientY:100});
 view.rerender(<AdminSortableList {...props} disabled>{({item,handle})=><div>{handle}{item.id}</div>}</AdminSortableList>);fireEvent.pointerUp(window,{pointerId:9,clientY:100});
 expect(onMove).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:/Reorder item 1/}).disabled).toBe(true);expect(document.body.classList.contains('admin-sortable-is-dragging')).toBe(false);
});
