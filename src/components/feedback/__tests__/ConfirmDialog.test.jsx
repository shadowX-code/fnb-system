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

it('focuses the safe action, contains Tab navigation and restores editor focus',()=>{
 const editor=document.createElement('textarea');document.body.append(editor);editor.focus();
 const onCancel=vi.fn();const view=render(<ConfirmDialog request={{title:'Discard?',message:'Unsaved',confirmLabel:'Discard',cancelLabel:'Continue Editing'}} onCancel={onCancel} onConfirm={()=>{}}/>);
 const cancel=screen.getByRole('button',{name:'Continue Editing'}),discard=screen.getByRole('button',{name:'Discard'});
 expect(document.activeElement).toBe(cancel);fireEvent.keyDown(cancel,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(discard);
 fireEvent.keyDown(discard,{key:'Tab'});expect(document.activeElement).toBe(cancel);
 fireEvent.keyDown(cancel,{key:'Escape'});expect(onCancel).toHaveBeenCalledOnce();view.unmount();expect(document.activeElement).toBe(editor);editor.remove();
});
