import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import AdminKanbanBoard from '../AdminKanbanBoard.jsx';
afterEach(cleanup);
const item={id:'one',title:'Task'},columns=[{value:'planned',label:'Planned',items:[item]},{value:'work',label:'In Progress',items:[]},{value:'completed',label:'Completed',items:[]}];
const props={columns,label:'Workflow',renderHeader:c=><h2>{c.label}</h2>,renderItem:t=><button>{t.title}</button>,canDrop:(_,c)=>c==='work'};
it('only handles start dragging and keyboard intent respects allowed destinations',()=>{const move=vi.fn();render(<AdminKanbanBoard {...props} onDrop={move}/>);fireEvent.keyDown(screen.getByRole('button',{name:/Move Task/}),{key:'ArrowRight'});expect(move).toHaveBeenCalledWith(item,'work',null);fireEvent.keyDown(screen.getByRole('button',{name:/Move Task/}),{key:'ArrowLeft'});expect(move).toHaveBeenCalledTimes(1);fireEvent.pointerDown(screen.getByRole('button',{name:'Task'}),{button:0});expect(document.body.classList.contains('admin-kanban-dragging')).toBe(false);});
it('disabled handles do not offer movement',()=>{const move=vi.fn();render(<AdminKanbanBoard {...props} disabled onDrop={move}/>);expect(screen.getByRole('button',{name:/Move Task/}).disabled).toBe(true);});

it('accepts empty-space drops across a full column and ignores interactive card controls',()=>{
 const move=vi.fn();render(<AdminKanbanBoard {...props} onDrop={move}/>);
 const board=screen.getByRole('region',{name:'Workflow'});board.getBoundingClientRect=()=>({left:0,right:900,top:0,bottom:500});
 board.querySelectorAll('[data-kanban-column]').forEach((node,index)=>node.getBoundingClientRect=()=>({left:index*300,right:index*300+280,top:0,bottom:500}));
 const card=board.querySelector('[data-kanban-item]');card.getBoundingClientRect=()=>({left:10,right:270,top:50,bottom:150,width:260,height:100});
 const pointer=(node,type,x,y)=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperty(event,'pointerId',{value:1});fireEvent(node,event)};
 pointer(screen.getByRole('button',{name:/Move Task/}),'pointerdown',250,100);pointer(window,'pointermove',450,460);pointer(window,'pointerup',450,460);
 expect(move).toHaveBeenCalledWith(item,'work',null);
});

it('card surfaces distinguish a normal click from a six-pixel drag and suppress the release click',()=>{
 const move=vi.fn(),open=vi.fn();render(<AdminKanbanBoard {...props} onDrop={move} onOpenItem={open} renderItem={t=><article><h3>{t.title}</h3><button>Preview</button><span contentEditable suppressContentEditableWarning>Editable</span></article>}/>);
 const board=screen.getByRole('region',{name:'Workflow'});board.getBoundingClientRect=()=>({left:0,right:900,top:0,bottom:500});board.querySelectorAll('[data-kanban-column]').forEach((node,index)=>node.getBoundingClientRect=()=>({left:index*300,right:index*300+280,top:0,bottom:500}));board.querySelector('[data-kanban-item]').getBoundingClientRect=()=>({left:10,right:270,top:50,bottom:150,width:260,height:100});
 const pointer=(node,type,x,y)=>{const e=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperty(e,'pointerId',{value:1});fireEvent(node,e)};
 const title=screen.getByRole('heading',{name:'Task'});pointer(title,'pointerdown',50,80);pointer(window,'pointermove',55,80);expect(document.body.classList.contains('admin-kanban-dragging')).toBe(false);pointer(window,'pointerup',55,80);fireEvent.click(title);expect(open).toHaveBeenCalledOnce();
 pointer(title,'pointerdown',50,80);pointer(window,'pointermove',56,80);expect(document.body.classList.contains('admin-kanban-dragging')).toBe(true);pointer(window,'pointerup',400,450);fireEvent.click(title);expect(open).toHaveBeenCalledOnce();expect(move).toHaveBeenCalledWith(item,'work',null);
 pointer(screen.getByRole('button',{name:'Preview'}),'pointerdown',50,80);pointer(window,'pointermove',400,450);pointer(window,'pointerup',400,450);expect(move).toHaveBeenCalledOnce();
 pointer(screen.getByText('Editable'),'pointerdown',50,80);pointer(window,'pointermove',400,450);pointer(window,'pointerup',400,450);expect(move).toHaveBeenCalledOnce();
});

it('targets the correct date row in a two-dimensional month grid',()=>{
 const move=vi.fn(),grid=[{value:'day1',label:'Day 1',items:[item]},{value:'day2',label:'Day 2',items:[]},{value:'day3',label:'Day 3',items:[]},{value:'day4',label:'Day 4',items:[]}];render(<AdminKanbanBoard {...props} columns={grid} canDrop={()=>true} onDrop={move}/>);
 const board=screen.getByRole('region',{name:'Workflow'});board.getBoundingClientRect=()=>({left:0,right:600,top:0,bottom:600});board.querySelectorAll('[data-kanban-column]').forEach((node,index)=>node.getBoundingClientRect=()=>({left:(index%2)*300,right:(index%2)*300+280,top:Math.floor(index/2)*300,bottom:Math.floor(index/2)*300+280}));board.querySelector('[data-kanban-item]').getBoundingClientRect=()=>({left:10,right:270,top:30,bottom:130,width:260,height:100});
 const pointer=(node,type,x,y)=>{const e=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperty(e,'pointerId',{value:1});fireEvent(node,e)};
 pointer(screen.getByRole('button',{name:/Move Task/}),'pointerdown',250,90);pointer(window,'pointermove',450,480);pointer(window,'pointerup',450,480);expect(move).toHaveBeenCalledWith(item,'day4',null);
});
