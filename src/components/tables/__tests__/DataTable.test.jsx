import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DataTable, {shouldIgnoreRowClick} from "../DataTable.jsx";

describe("DataTable", () => {
  it("marks header, rows, and cells for the shared Admin table contract", () => {
    const { container } = render(<DataTable rows={[{ id: "row-1", name: "Friends Corner" }]} getRowKey={(row) => row.id} columns={[{ key: "name", header: "Outlet" }]} />);
    const table = container.querySelector(".admin-data-table");

    expect(table.dataset.density).toBe("normal");
    expect(table.querySelector(".admin-table-head .admin-table-header-cell")).not.toBeNull();
    expect(table.querySelector(".admin-table-row .admin-table-cell")).not.toBeNull();
  });

  it("keeps compact density explicit without changing column behavior", () => {
    const { container } = render(<DataTable density="compact" rows={[{ id: "row-1", total: "12" }]} getRowKey={(row) => row.id} columns={[{ key: "total", header: "Total", align: "right" }]} />);
    const table = container.querySelector(".admin-data-table");

    expect(table.dataset.density).toBe("compact");
    expect(table.querySelector(".admin-table-header-cell").className).toContain("text-right");
    expect(table.querySelector(".admin-table-cell").className).toContain("text-right");
  });
});

it("supports semantic secondary columns and explicit minimum width without changing default tables",()=>{
 const {container}=render(<DataTable minWidth="100%" density="compact" rows={[{id:"a"}]} getRowKey={r=>r.id} columns={[{key:"identity",header:"Candidate"},{key:"metadata",header:"Invitation",priority:"secondary"}]}/>);
 expect(container.querySelector("table").style.minWidth).toBe("100%");expect(container.querySelectorAll('[data-priority="secondary"]')).toHaveLength(2);
});

it('opens accessible button rows while keeping nested actions independent',()=>{const open=vi.fn(),action=vi.fn();const {container}=render(<DataTable rows={[{id:'a'}]} getRowKey={r=>r.id} onRowClick={open} getRowProps={()=>({role:'button',tabIndex:0})} columns={[{key:'name',header:'Name',render:()=> <span>Row body</span>},{key:'action',header:'Actions',render:()=> <button onClick={action}>Edit row</button>}]}/>);fireEvent.click(container.querySelector('td span'));expect(open).toHaveBeenCalledTimes(1);fireEvent.click(container.querySelector('td button'));expect(action).toHaveBeenCalledOnce();expect(open).toHaveBeenCalledTimes(1)});

it('opts into labeled mobile rows without changing existing tables',()=>{const {container,rerender}=render(<DataTable mobileLayout="stack" rows={[{id:'a',name:'Name'}]} getRowKey={r=>r.id} columns={[{key:'name',header:'Identity'},{key:'state',header:'Health'}]}/>);expect(container.querySelector('table').dataset.mobileLayout).toBe('stack');expect(container.querySelector('td').dataset.label).toBe('Identity');rerender(<DataTable rows={[]} columns={[]} getRowKey={r=>r.id}/>);expect(container.querySelector('table').dataset.mobileLayout).toBe('scroll')});

it('preserves selected text rather than opening a row',()=>{const open=vi.fn();const selected={toString:()=> 'Selected customer',anchorNode:null};const selection=vi.spyOn(window,'getSelection').mockReturnValue(selected);const {container}=render(<DataTable rows={[{id:'selected',name:'Selected customer'}]} getRowKey={r=>r.id} onRowClick={open} columns={[{key:'name',header:'Name'}]}/>);selected.anchorNode=container.querySelector('td').firstChild;fireEvent.click(container.querySelector('td'));expect(open).not.toHaveBeenCalled();selection.mockRestore();});

it('shares text-selection and nested-control protection with mobile consumers',()=>{
 const row=document.createElement('article');row.innerHTML='<span>Campaign title</span><summary>Details</summary><button>Edit</button>';const selection=vi.spyOn(window,'getSelection').mockReturnValue({toString:()=> 'Campaign',anchorNode:row.firstChild.firstChild});
 expect(shouldIgnoreRowClick({type:'click',currentTarget:row,target:row.firstChild})).toBe(true);selection.mockRestore();
 for(const target of row.querySelectorAll('summary,button'))expect(shouldIgnoreRowClick({type:'click',currentTarget:row,target})).toBe(true);
 expect(shouldIgnoreRowClick({type:'click',currentTarget:row,target:row.firstChild})).toBe(false);
});

it('exposes native keyboard sort controls, direction and right-aligned numeric headers without sorting rows locally',()=>{
 const sort=vi.fn();const {container}=render(<DataTable rows={[{id:'b',amount:9},{id:'a',amount:100}]} getRowKey={r=>r.id} columns={[{key:'amount',header:'Spend',align:'right',sortDirection:'desc',onSort:sort}]}/>);
 const header=container.querySelector('th'),button=header.querySelector('button');
 expect(header.getAttribute('aria-sort')).toBe('descending');expect(button.type).toBe('button');expect(button.getAttribute('aria-label')).toBe('Sort by Spend, ascending');
 fireEvent.click(button);expect(sort).toHaveBeenCalledOnce();expect([...container.querySelectorAll('td')].map(e=>e.textContent)).toEqual(['9','100']);
});
