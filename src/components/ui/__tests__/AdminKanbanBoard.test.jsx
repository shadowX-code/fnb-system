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
