import { beforeEach,it,expect,vi } from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import Modal from '../Modal.jsx';
beforeEach(cleanup);
it('uses the shared right drawer, contains focus and restores the originating control',()=>{
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();const close=vi.fn();const {unmount}=render(<Modal title="Post details" placement="right" onClose={close}><button>Overview</button></Modal>);const dialog=screen.getByRole('dialog');expect(dialog.className).toContain('h-[100dvh]');expect(document.activeElement).toBe(dialog);fireEvent.keyDown(dialog,{key:'Tab'});expect(document.activeElement).toBe(dialog);fireEvent.keyDown(dialog,{key:'Escape'});expect(close).toHaveBeenCalledOnce();unmount();expect(document.activeElement).toBe(trigger);trigger.remove();
});
it('retains centered sizing for existing dialogs',()=>{render(<Modal title="Approve" onClose={()=>{}} size="lg">Review</Modal>);expect(screen.getByRole('dialog').className).toContain('max-w-3xl');});
