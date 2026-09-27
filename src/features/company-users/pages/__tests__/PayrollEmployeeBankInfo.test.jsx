import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PayrollEmployeeBankInfo from "../PayrollEmployeeBankInfo.jsx";
import { MALAYSIA_BANKS, malaysiaBankOptions } from "../../../../constants/malaysiaBanks.js";
afterEach(cleanup);
describe("Employee bank presentation", () => {
  it("uses canonical names and preserves an unmatched historical value exactly", () => {
    expect(MALAYSIA_BANKS).toHaveLength(17);
    expect(malaysiaBankOptions("Old Bank Ltd")[1]).toEqual({ value: "Old Bank Ltd", label: "Old Bank Ltd (Existing value)" });
    expect(malaysiaBankOptions("Maybank").filter(option => option.value === "Maybank")).toHaveLength(1);
  });
  it("keeps full bank data out of the table and exposes read-only details on demand", () => {
    const rowClick = vi.fn();
    render(<div onClick={rowClick}><PayrollEmployeeBankInfo employeeName="QA Employee" result={{ employee: {
      bank_name: "Maybank", bank_account_name: "QA Account", bank_account_number: "00012345",
    } }} /></div>);
    expect(screen.queryByText("00012345")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View bank information for QA Employee" }));
    expect(rowClick).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Bank Info" })).toBeTruthy();
    expect(screen.getByText("00012345")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("distinguishes incomplete data from invisible data, loading and failure", () => {
    const retry = vi.fn();
    const { rerender } = render(<PayrollEmployeeBankInfo result={null} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    rerender(<PayrollEmployeeBankInfo result={{ employee: { bank_name: "Maybank" } }} />);
    expect(screen.getByText("Missing")).toBeTruthy();
    rerender(<PayrollEmployeeBankInfo result={{}} />);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    rerender(<PayrollEmployeeBankInfo employeeName="QA" result={{ error: true }} onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry bank information for QA" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText("Missing")).toBeNull();
  });
});
