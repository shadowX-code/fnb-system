import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FactoryMestiMonthlyActionRow, FactoryMestiMonthlyExpansion } from "../FactoryMestiMonthlyExpansion.jsx";

describe("FactoryMestiMonthlyExpansion", () => {
  it("keeps action controls inside a wrapping operational expansion row", () => {
    const { container } = render(<FactoryMestiMonthlyExpansion ariaLabel="Monthly actions" title="September evidence">
      <FactoryMestiMonthlyActionRow primary="Long operational evidence" status={<span>Pending</span>} actions={<button type="button">Complete</button>} />
    </FactoryMestiMonthlyExpansion>);

    expect(screen.getByLabelText("Monthly actions")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Complete" })).not.toBeNull();
    expect(container.querySelector(".flex-wrap")).not.toBeNull();
    expect(container.querySelector(".basis-56")).not.toBeNull();
  });
});
