import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,act} from '@testing-library/react';
import TruncatedTextPopover from '../TruncatedTextPopover.jsx';
let resizes;
beforeEach(()=>{
 resizes=[];
 vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockReturnValue(180);
 vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(60);
 vi.stubGlobal('ResizeObserver',class{constructor(callback){resizes.push(callback)}observe(){}disconnect(){}});
 vi.stubGlobal('PointerEvent',class extends MouseEvent{constructor(type,options={}){super(type,options);this.pointerType=options.pointerType||'mouse'}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()});
const show=(props={})=>render(<TruncatedTextPopover text={'Current revision instructions\n全文说明'} label="Read full instructions" {...props}/>);
it('shows only clipped text on hover, allows moving into the scrollable popup and closes after leaving',async()=>{
 show();const trigger=screen.getByRole('button',{name:'Read full instructions'});fireEvent.pointerEnter(trigger);const popup=screen.getByRole('tooltip');expect(popup.textContent).toContain('全文说明');expect(trigger.getAttribute('aria-describedby')).toBe(popup.id);
 fireEvent.pointerLeave(trigger);fireEvent.pointerEnter(popup);await new Promise(r=>setTimeout(r,150));expect(screen.getByRole('tooltip')).toBeTruthy();fireEvent.pointerLeave(popup);await vi.waitFor(()=>expect(screen.queryByRole('tooltip')).toBeNull());
});
it('opens on keyboard focus and activation and dismisses on Escape without losing trigger focus',()=>{
 show();const trigger=screen.getByRole('button');act(()=>trigger.focus());expect(screen.getByRole('tooltip')).toBeTruthy();fireEvent.keyDown(trigger,{key:'Escape'});expect(screen.queryByRole('tooltip')).toBeNull();expect(document.activeElement).toBe(trigger);fireEvent.keyDown(trigger,{key:'Enter'});expect(screen.getByRole('tooltip')).toBeTruthy();fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('tooltip')).toBeNull();
});
it('ignores touch hover, opens on tap and dismisses outside without invoking its parent',()=>{
 const parent=vi.fn();render(<div onClick={parent} onPointerDown={parent}><TruncatedTextPopover text="Long text"/></div>);const trigger=screen.getByRole('button');fireEvent.pointerEnter(trigger,{pointerType:'touch'});expect(screen.queryByRole('tooltip')).toBeNull();fireEvent.pointerDown(trigger,{pointerType:'touch'});fireEvent.click(trigger);expect(screen.getByRole('tooltip')).toBeTruthy();expect(parent).not.toHaveBeenCalled();fireEvent.pointerDown(document.body);expect(screen.queryByRole('tooltip')).toBeNull();
});
it('does not offer a popup or extra tab stop for a fully visible preview',()=>{
 vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockReturnValue(60);const {container}=show({text:'Short feedback'});expect(screen.queryByRole('button')).toBeNull();fireEvent.pointerEnter(container.firstChild);fireEvent.click(container.firstChild);expect(screen.queryByRole('tooltip')).toBeNull();
});
it('rechecks truncation when layout changes and closes a popup that is no longer needed',()=>{
 show();fireEvent.click(screen.getByRole('button'));expect(screen.getByRole('tooltip')).toBeTruthy();vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockReturnValue(60);act(()=>resizes.slice().forEach(resize=>resize()));expect(screen.queryByRole('tooltip')).toBeNull();expect(screen.queryByRole('button')).toBeNull();
});
it('replaces full text with the current source and bounds the shared floating layer',()=>{
 const view=show();fireEvent.click(screen.getByRole('button'));view.rerender(<TruncatedTextPopover text="New cycle feedback"/>);const popup=screen.getByRole('tooltip');expect(popup.textContent).toBe('New cycle feedback');expect(popup.parentElement.parentElement.style.maxHeight).toBe('320px');expect(popup.style.overflowWrap).toBe('anywhere');expect(popup.parentElement.parentElement.className).toContain('overflow-y-auto');
});
