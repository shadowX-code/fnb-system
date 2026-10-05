import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ActionMenu from "../ActionMenu.jsx";
afterEach(cleanup);
it("supports keyboard overflow navigation and restores trigger focus",()=>{
 function Menu(){const [open,setOpen]=useState(false);return <ActionMenu open={open} onOpenChange={setOpen} trigger={({toggle})=><button onClick={toggle}>Actions</button>}><div role="menu"><button role="menuitem">Invite</button><button role="menuitem" disabled>Disabled</button><button role="menuitem">Revoke</button></div></ActionMenu>;}
 render(<Menu/>);const trigger=screen.getByRole("button",{name:"Actions"});fireEvent.click(trigger);
 const invite=screen.getByRole("menuitem",{name:"Invite"});invite.focus();fireEvent.keyDown(invite,{key:"ArrowDown"});expect(document.activeElement).toBe(screen.getByRole("menuitem",{name:"Revoke"}));fireEvent.keyDown(document.activeElement,{key:"Escape"});expect(screen.queryByRole("menu")).toBeNull();expect(document.activeElement).toBe(trigger);
});
