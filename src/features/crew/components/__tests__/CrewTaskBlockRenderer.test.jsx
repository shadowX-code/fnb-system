import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrewTaskBlockRenderer, { TASK_BLOCK_TYPES, isTaskBlockActionable, normalizeTaskBlock } from "../CrewTaskBlockRenderer.jsx";

afterEach(cleanup);

const base = (block_type, patch = {}) => ({ id: `block-${block_type}`, block_type, title: `${block_type} block`, description: "Crew-facing instruction", is_required: true, config: {}, ...patch });

describe("CrewTaskBlockRenderer", () => {
  it("resolves every supported Task block type to its canonical renderer", () => {
    const configs = {
      sop_reference: { sop_version_id: "sop-v1", sop_reference: { sop_version_id: "sop-v1", title: "Opening Standard", version: 1 } },
      single_choice: { config: { options: ["Pass", "Fail"] } },
      number: { config: { min: 1, max: 10, unit: "units" } },
      temperature: { config: { min: 0, max: 5, unit: "°C" } },
    };
    const { container } = render(<>{TASK_BLOCK_TYPES.map((type, index) => <CrewTaskBlockRenderer key={type} block={base(type, configs[type])} index={index} mode="preview" onOpenSop={() => {}} />)}</>);
    expect(container.querySelectorAll("[data-block-type]")).toHaveLength(TASK_BLOCK_TYPES.length);
    for (const type of TASK_BLOCK_TYPES) expect(container.querySelector(`[data-block-type="${type}"]`)).not.toBeNull();
    for (const type of TASK_BLOCK_TYPES) fireEvent.click(container.querySelector(`[data-block-type="${type}"] .crew-task-block-summary`));
    expect(screen.getByRole("button", { name: "Open SOP preview" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Pass" })).not.toBeNull();
    expect(screen.getByLabelText("Temperature")).not.toBeNull();
  });

  it("keeps preview interactions local, collapses to its result and never calls the execution callback", () => {
    const onSubmit = vi.fn();
    const onPreviewChange = vi.fn();
    render(<CrewTaskBlockRenderer block={base("checklist_item")} mode="preview" onSubmit={onSubmit} onPreviewChange={onPreviewChange} />);
    fireEvent.click(screen.getByRole("button", { name: /checklist_item block/i }));
    fireEvent.click(screen.getByRole("button", { name: /Complete checklist_item block/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onPreviewChange).toHaveBeenCalledWith(expect.objectContaining({ action: "completed" }));
    expect(screen.getByText("Done")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Complete checklist_item block/ })).toBeNull();
  });

  it("uses the same contract in interactive mode and submits server-bound responses", async () => {
    const onSubmit = vi.fn();
    render(<CrewTaskBlockRenderer block={base("yes_no")} mode="interactive" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /yes_no block/i }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: "completed", response: { value: "yes" } })));
  });

  it("shows useful incomplete and unavailable linked-SOP states", () => {
    const { rerender } = render(<CrewTaskBlockRenderer block={base("text", { title: "" })} mode="preview" />);
    expect(screen.getByText("Add a title to preview this block.")).not.toBeNull();
    rerender(<CrewTaskBlockRenderer block={base("sop_reference")} mode="preview" />);
    fireEvent.click(screen.getByRole("button", { name: /sop_reference block/i }));
    expect(screen.getByText("Choose a published SOP to preview this block.")).not.toBeNull();
  });

  it("renders optional semantics without developer-style required markers", () => {
    render(<CrewTaskBlockRenderer block={base("checklist_item", { is_required: false })} mode="preview" />);
    expect(screen.getByText("Optional")).not.toBeNull();
    expect(screen.queryByText("*")).toBeNull();
  });

  it("renders health rating separately from exception handling", () => {
    render(<CrewTaskBlockRenderer block={base("health_rating")} mode="preview" allowException />);
    fireEvent.click(screen.getByRole("button", { name: /health_rating block/i }));
    expect(screen.getByRole("button", { name: "Good" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Needs Attention" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Not Checked" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Report issue" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Report issue" }));
    expect(screen.getByRole("dialog", { name: /Report issue for health_rating block/ })).not.toBeNull();
  });

  it("normalizes Admin and Crew schema variants consistently", () => {
    expect(normalizeTaskBlock({ block_type: "text", is_required: false }).required).toBe(false);
    expect(normalizeTaskBlock({ block_type: "confirmation", required: true }).is_required).toBe(true);
    expect(isTaskBlockActionable({ block_type: "text" })).toBe(false);
    expect(isTaskBlockActionable({ block_type: "confirmation" })).toBe(true);
  });
});
