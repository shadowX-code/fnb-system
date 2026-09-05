import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FactoryCellAttention, FactoryCellDateTime, FactoryCellEntity, FactoryCellLabel, FactoryCellMuted, FactoryCellProgress, FactoryCellSemanticText, FactoryCellText } from "../FactoryTableCell.jsx";

describe("Factory table cell semantic presentation", () => {
  it("renders primary and secondary hierarchy for text, entities, and dates", () => {
    render(<><FactoryCellText primary="Black Pepper Sauce" secondary="Finished good" /><FactoryCellEntity name="S01" code="Black Pepper Sauce" /><FactoryCellDateTime date="05/09/2026" time="10:42 AM" /></>);
    expect(screen.getAllByText("Black Pepper Sauce")[0].className).toContain("factory-cell-primary");
    expect(screen.getByText("Finished good").className).toContain("factory-cell-secondary");
    expect(screen.getByText("10:42 AM").className).toContain("factory-cell-secondary");
  });

  it("exposes semantic state through composable, token-backed variants", () => {
    render(<><FactoryCellSemanticText tone="green">Verified</FactoryCellSemanticText><FactoryCellLabel tone="blue">Production</FactoryCellLabel><FactoryCellAttention tone="amber">1 historical diagnostic</FactoryCellAttention><FactoryCellProgress completed={2} required={3} tone="amber" /><FactoryCellMuted /></>);
    expect(screen.getByText("Verified").dataset.tone).toBe("green");
    expect(screen.getByText("Production").dataset.tone).toBe("blue");
    expect(screen.getByText("1 historical diagnostic").dataset.tone).toBe("amber");
    expect(screen.getByText("2/3").dataset.tone).toBe("amber");
    expect(screen.getByText("—").className).toContain("factory-cell-muted");
  });

  it("falls back to neutral presentation for unknown semantic values", () => {
    render(<FactoryCellSemanticText tone="decorative">Historical</FactoryCellSemanticText>);
    expect(screen.getByText("Historical").dataset.tone).toBe("gray");
  });
});
