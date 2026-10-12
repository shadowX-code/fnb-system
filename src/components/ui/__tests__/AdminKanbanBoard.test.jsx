import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import AdminKanbanBoard from '../AdminKanbanBoard.jsx';
afterEach(cleanup);
const item={id:'one',title:'Task'},columns=[{value:'planned',label:'Planned',items:[item]},{value:'work',label:'In Progress',items:[]},{value:'completed',label:'Completed',items:[]}];
const props={columns,label:'Workflow',renderHeader:c=><h2>{c.label}</h2>,renderItem:t=><button>{t.title}</button>,canDrop:(_,c)=>c==='work'};
it('only handles start dragging and keyboard intent respects allowed destinations',()=>{const move=vi.fn();render(<AdminKanbanBoard {...props} onDrop={move}/>);fireEvent.keyDown(screen.getByRole('button',{name:/Move Task/}),{key:'ArrowRight'});expect(move).toHaveBeenCalledWith(item,'work',null);fireEvent.keyDown(screen.getByRole('button',{name:/Move Task/}),{key:'ArrowLeft'});expect(move).toHaveBeenCalledTimes(1);fireEvent.pointerDown(screen.getByRole('button',{name:'Task'}),{button:0});expect(document.body.classList.contains('admin-kanban-dragging')).toBe(false);});
it('disabled handles do not offer movement',()=>{const move=vi.fn();render(<AdminKanbanBoard {...props} disabled onDrop={move}/>);expect(screen.getByRole('button',{name:/Move Task/}).disabled).toBe(true);});
