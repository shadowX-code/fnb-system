import {useState} from "react";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {it,expect,afterEach} from "vitest";
import Entries from "./ConfirmedInformationEntries.jsx";
afterEach(cleanup);
function Harness(){const [value,setValue]=useState([]);return <><Entries value={value} onChange={setValue}/><output>{JSON.stringify(value)}</output></>;}
it("keeps topic/information distinct and removes only the selected entry",()=>{render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"Add confirmed information"}));fireEvent.change(screen.getByLabelText("Topic"),{target:{value:"Training location"}});fireEvent.change(screen.getByLabelText("Confirmed Information"),{target:{value:"Orientation at the hiring workplace."}});expect(JSON.parse(screen.getByRole("status").textContent)).toEqual([{topic:"Training location",information:"Orientation at the hiring workplace."}]);fireEvent.click(screen.getByRole("button",{name:"Remove information 1"}));expect(screen.getByRole("status").textContent).toBe("[]");});
