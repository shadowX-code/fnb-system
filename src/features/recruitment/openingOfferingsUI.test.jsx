import {useState} from "react";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import OpeningOfferings from "./OpeningOfferings.jsx";
afterEach(cleanup);
function Harness(){
 const [offers,setOffers]=useState([]);
 return <><OpeningOfferings value={offers} onChange={setOffers}/><output>{JSON.stringify({offers})}</output></>;
}
it("adds independent offerings with progressive details and leaves missing facts unconfirmed",()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"Add offering"}));
 expect(screen.getByText("Hours, breaks & meals")).toBeTruthy();expect(screen.getByText("Benefits, probation & payment")).toBeTruthy();
 fireEvent.change(screen.getByLabelText("Minimum commitment (months)"),{target:{value:"1"}});
 fireEvent.click(screen.getByRole("button",{name:"Add offering"}));
 const data=JSON.parse(screen.getByRole("status").textContent);expect(data.offers).toHaveLength(2);expect(data.offers.map(offer=>offer.employment_type)).toEqual(["full_time","part_time"]);expect(data.offers[0].minimum_commitment_months).toBe(1);expect(data.offers[1].amount_min).toBeUndefined();expect(data.offers[0].id).not.toBe(data.offers[1].id);
});
