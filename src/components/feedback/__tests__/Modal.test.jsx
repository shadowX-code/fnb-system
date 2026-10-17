import { beforeEach,it,expect,vi } from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import Modal from '../Modal.jsx';
beforeEach(cleanup);
it('uses the shared right drawer, contains focus and restores the originating control',()=>{
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();const close=vi.fn();const {unmount}=render(<Modal title="Post details" placement="right" onClose={close}><button>Overview</button></Modal>);const dialog=screen.getByRole('dialog');expect(dialog.className).toContain('h-[100dvh]');expect(document.activeElement).toBe(dialog);fireEvent.keyDown(dialog,{key:'Tab'});expect(document.activeElement).toBe(dialog);fireEvent.keyDown(dialog,{key:'Escape'});expect(close).toHaveBeenCalledOnce();unmount();expect(document.activeElement).toBe(trigger);trigger.remove();
});
it('retains centered sizing for existing dialogs',()=>{render(<Modal title="Approve" onClose={()=>{}} size="lg">Review</Modal>);expect(screen.getByRole('dialog').className).toContain('max-w-3xl');});

it('nested media dialog handles Escape without closing the post form',()=>{
 const parentClose=vi.fn(),childClose=vi.fn();render(<Modal title="Post" onClose={parentClose}><input aria-label="Caption"/><Modal title="Picker" onClose={childClose}><button>Select</button></Modal></Modal>);
 fireEvent.keyDown(screen.getByRole('button',{name:'Select'}),{key:'Escape'});expect(childClose).toHaveBeenCalledOnce();expect(parentClose).not.toHaveBeenCalled();cleanup();
});

it('resets scroll and focuses the dialog when switching views, preserving same-view edits and original focus return',()=>{
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();
 const view=render(<Modal title="FAQ Library" onClose={()=>{}}><input aria-label="Draft field"/></Modal>);
 const dialog=screen.getByRole('dialog'),body=dialog.children[1];body.scrollTop=300;screen.getByLabelText('Draft field').focus();
 view.rerender(<Modal title="FAQ Library" onClose={()=>{}}><input aria-label="Draft field" value="Edited" readOnly/></Modal>);
 expect(body.scrollTop).toBe(300);
 view.rerender(<Modal title="FAQ Draft" onClose={()=>{}}><input aria-label="Draft field"/></Modal>);
 expect(body.scrollTop).toBe(0);expect(document.activeElement).toBe(dialog);
 view.unmount();expect(document.activeElement).toBe(trigger);trigger.remove();
});
