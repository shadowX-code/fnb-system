import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ query:vi.fn() }));
vi.mock("../../hooks/useFactoryActionData.js",()=>({default:mocks.query}));
vi.mock("../../hooks/useFactoryPermissions.js",()=>({default:()=>({can:()=>true,permissionSet:["factory_finished_goods.view"]})}));
vi.mock("../FactoryFinishedGoodDetailModal.jsx",()=>({default:props=><div>{props.movements.length} history movements; {props.productionCosts.length} cost rows</div>}));
import Detail from "../FactoryFinishedGoodHistoryDetail.jsx";
afterEach(cleanup);
const props={product:{id:"sku",product_name:"Product"},recipes:[],receivings:[],onClose:vi.fn()};
it("does not render false empty history while pending or failed; allows retry",()=>{
 const retry=vi.fn(); mocks.query.mockReturnValue({loading:true});
 const view=render(<Detail {...props}/>);
 expect(screen.getByRole("status",{name:"Loading data"})).toBeTruthy(); expect(screen.queryByText(/history movements/)).toBeNull();
 mocks.query.mockReturnValue({error:"Connection failed",loading:false,retry});view.rerender(<Detail {...props}/>);
 fireEvent.click(screen.getByRole("button",{name:"Retry"})); expect(retry).toHaveBeenCalledOnce();
 expect(screen.queryByText(/history movements/)).toBeNull();
});
it("uses the completed detail read before rendering history and shared costing",()=>{
 mocks.query.mockReturnValue({data:{productions:[{id:"p",status:"completed"},{id:"pending",status:"draft"}],productMovements:[{id:"m"}]}});
 render(<Detail {...props}/>); expect(screen.getByText("1 history movements; 1 cost rows")).toBeTruthy();
 expect(mocks.query.mock.lastCall[0]).toMatchObject({scope:"finished-goods",action:"finished-good-history",owner:"sku"});
});
