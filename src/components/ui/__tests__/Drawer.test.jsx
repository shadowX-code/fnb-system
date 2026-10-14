import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import Drawer from '../Drawer.jsx';
afterEach(cleanup);
it('leaves Escape to nested canonical popovers before closing the drawer',()=>{const close=vi.fn();const {rerender}=render(<Drawer title="Task" onClose={close}><div data-floating-ancestors=""><input aria-label="Popover input"/></div></Drawer>);fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'});expect(close).not.toHaveBeenCalled();rerender(<Drawer title="Task" onClose={close}><input aria-label="Task input"/></Drawer>);fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'});expect(close).toHaveBeenCalledOnce();});
it('does not close the parent drawer when a nested dialog handles Escape',()=>{const close=vi.fn();render(<Drawer title="Task" onClose={close}><div role="dialog" aria-label="Media"><input aria-label="Media input"/></div></Drawer>);fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'});expect(close).not.toHaveBeenCalled();});

it('retains current field focus when execution temporarily disables Escape',()=>{const {rerender}=render(<Drawer title="Task" onClose={()=>{}}><input aria-label="Title"/></Drawer>);const input=screen.getByRole('textbox',{name:'Title'});input.focus();rerender(<Drawer title="Task" closeOnEscape={false} onClose={()=>{}}><input aria-label="Title"/></Drawer>);expect(document.activeElement).toBe(input);});

it('spaces direct footer actions at the shared twelve-pixel gap',()=>{render(<Drawer title="Task" footer={<><button>Close</button><button>Save</button></>}/>);const footer=screen.getByRole('button',{name:'Save'}).closest('footer');expect(footer.classList.contains('flex')).toBe(true);expect(footer.classList.contains('gap-[12px]')).toBe(true);expect(footer.classList.contains('flex-wrap')).toBe(true)});
