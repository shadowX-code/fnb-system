import {useState} from "react";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import OpeningOfferings,{JobContextFields} from "./OpeningOfferings.jsx";
afterEach(cleanup);
function Harness(){const [offers,setOffers]=useState([]),[context,setContext]=useState({});return <><JobContextFields value={context} onChange={setContext} description="" onDescription={()=>{}}/><OpeningOfferings value={offers} onChange={setOffers}/><output>{JSON.stringify({offers,context})}</output></>;}
it("adds independent offerings with progressive details and leaves missing facts unconfirmed",()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"+ Add employment offering"}));
 expect(screen.getByText("Hours, breaks & meals")).toBeTruthy();expect(screen.getByText("Benefits, probation & payment")).toBeTruthy();
 fireEvent.change(screen.getByLabelText("Minimum commitment (months)"),{target:{value:"1"}});
 fireEvent.click(screen.getByRole("button",{name:"+ Add employment offering"}));
 const data=JSON.parse(screen.getByRole("status").textContent);expect(data.offers).toHaveLength(2);expect(data.offers[0].minimum_commitment_months).toBe(1);expect(data.offers[1].amount_min).toBeUndefined();expect(data.offers[0].id).not.toBe(data.offers[1].id);
});
it("collects structured operating days without implying employment requirements",()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole("checkbox",{name:"Mon"}));fireEvent.change(screen.getByLabelText(/Candidate-facing location/),{target:{value:"Pengkalan / Pasir Puteh"}});
 const data=JSON.parse(screen.getByRole("status").textContent);expect(data.context.operating_days).toEqual(["mon"]);expect(data.context.location).toBe("Pengkalan / Pasir Puteh");expect(data.context.weekend_required).toBeUndefined();
});
