import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrewTaskBlockRenderer, { TASK_BLOCK_TYPES, isTaskBlockActionable, normalizeTaskBlock } from "../CrewTaskBlockRenderer.jsx";

afterEach(cleanup);

const base = (block_type, patch = {}) => ({ id: `block-${block_type}`, block_type, title: `${block_type} block`, description: "Crew-facing instruction", is_required: true, config: {}, ...patch });

describe("CrewTaskBlockRenderer", () => {
  it("maps every canonical Task block to a direct, explicit-save, or reference renderer without an expand gate", () => {
    const configs = {
      sop_reference: { sop_version_id: "sop-v1", sop_reference: { sop_version_id: "sop-v1", title: "Opening Standard", version: 1 } },
      single_choice: { config: { options: ["Pass", "Fail"] } },
      number: { config: { min: 1, max: 10, unit: "units" } },
      temperature: { config: { min: 0, max: 5, unit: "°C" } },
    };
    const { container } = render(<>{TASK_BLOCK_TYPES.map((type, index) => <CrewTaskBlockRenderer key={type} block={base(type, configs[type])} index={index} mode="preview" onOpenSop={() => {}} />)}</>);
    expect(container.querySelectorAll("[data-block-type]")).toHaveLength(TASK_BLOCK_TYPES.length);
    expect(container.querySelectorAll("[aria-expanded]")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "View SOP preview" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Pass" })).not.toBeNull();
    expect(screen.getByLabelText("Temperature")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Complete checklist_item block/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Confirm confirmation block/ })).not.toBeNull();
  });

  it("does not expose internal block type helper copy or type-only status badges", () => {
    const { container } = render(<>
      <CrewTaskBlockRenderer block={base("checklist_item")} mode="preview" />
      <CrewTaskBlockRenderer block={base("yes_no")} mode="preview" />
      <CrewTaskBlockRenderer block={base("confirmation")} mode="preview" />
      <CrewTaskBlockRenderer block={base("health_rating")} mode="preview" />
      <CrewTaskBlockRenderer block={base("text")} mode="preview" />
      <CrewTaskBlockRenderer block={base("sop_reference", { sop_version_id: "sop-v1", sop_reference: { title: "Opening Standard", version: 1 } })} mode="preview" onOpenSop={() => {}} />
    </>);
    ["Checklist item", "Yes / No", "Confirmation", "Health rating", "Instruction", "SOP reference"].forEach((label) => expect(screen.queryByText(label)).toBeNull());
    expect(container.querySelectorAll(".crew-task-block-result")).toHaveLength(4);
  });

  it("persists checklist, confirmation, yes/no, and single choice on their first direct action", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ status: "completed" });
    const { rerender } = render(<CrewTaskBlockRenderer block={base("checklist_item")} mode="interactive" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Complete checklist_item block/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "completed", response: { value: true } })));
    rerender(<CrewTaskBlockRenderer block={base("confirmation")} mode="interactive" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm confirmation block/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "completed", response: { value: true } })));
    rerender(<CrewTaskBlockRenderer block={base("yes_no")} mode="interactive" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "completed", response: { value: "yes" } })));
    rerender(<CrewTaskBlockRenderer block={base("single_choice", { config: { options: ["Pass", "Fail"] } })} mode="interactive" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("radio", { name: "Pass" }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "completed", response: { value: "Pass" } })));
    rerender(<CrewTaskBlockRenderer block={base("health_rating")} mode="interactive" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "good", response: { value: "good" } })));
  });

  it("distinguishes completed direct actions and keeps health choices semantically compact", () => {
    const { rerender, container } = render(<CrewTaskBlockRenderer block={base("checklist_item", { status: "completed", response: { value: true } })} mode="interactive" onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /complete checklist_item block/i }).textContent).toContain("Done");
    expect(container.querySelector(".crew-task-direct-toggle.is-done")).not.toBeNull();
    rerender(<CrewTaskBlockRenderer block={base("health_rating", { response: { value: "needs_attention" } })} mode="interactive" onSubmit={() => {}} />);
    expect(container.querySelector(".is-needs-attention.is-selected")).not.toBeNull();
    expect(container.querySelector(".is-not-checked")).not.toBeNull();
  });

  it("keeps measurement and short text blocks on their explicit validated save path", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ status: "completed" });
    const { rerender } = render(<CrewTaskBlockRenderer block={base("number")} mode="interactive" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Number input"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save value" }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "completed", response: { value: "4" } })));
    rerender(<CrewTaskBlockRenderer block={base("short_text")} mode="interactive" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Short response"), { target: { value: "Recorded" } });
    fireEvent.click(screen.getByRole("button", { name: "Save response" }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "completed", response: { value: "Recorded" } })));
  });

  it("reveals issue reporting only after a health attention state or configured No exception", () => {
    const { rerender } = render(<CrewTaskBlockRenderer block={base("health_rating")} mode="preview" allowException />);
    expect(screen.queryByRole("button", { name: "Report issue" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Needs Attention" }));
    fireEvent.click(screen.getByRole("button", { name: "Report issue" }));
    expect(screen.getByRole("dialog", { name: /Report issue for health_rating block/ })).not.toBeNull();
    rerender(<CrewTaskBlockRenderer block={base("yes_no", { config: { no_requires_issue: true } })} mode="preview" allowException />);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.getByRole("button", { name: "Report issue" })).not.toBeNull();
  });

  it("keeps long instructions progressive but never hides short content or SOP access", () => {
    const long = "A".repeat(220);
    render(<CrewTaskBlockRenderer block={base("text", { description: long })} mode="preview" />);
    expect(screen.getByRole("button", { name: "Read more" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText(long)).not.toBeNull();
  });

  it("keeps a failed direct save actionable for retry", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ status: "completed" });
    render(<CrewTaskBlockRenderer block={base("yes_no")} mode="interactive" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Yes" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  it("keeps preview interactions local and honors optional semantics", () => {
    const onSubmit = vi.fn();
    const onPreviewChange = vi.fn();
    render(<CrewTaskBlockRenderer block={base("checklist_item", { is_required: false })} mode="preview" onSubmit={onSubmit} onPreviewChange={onPreviewChange} />);
    expect(screen.getByText("Optional")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Complete checklist_item block/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onPreviewChange).toHaveBeenCalledWith(expect.objectContaining({ action: "completed" }));
  });

  it("keeps unavailable task content readable while disabling every mutation control", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<CrewTaskBlockRenderer block={base("yes_no")} mode="interactive" unavailable allowException onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Yes" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "No" }).disabled).toBe(true);
    rerender(<CrewTaskBlockRenderer block={base("checklist_item")} mode="interactive" unavailable onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: /Complete checklist_item block/ }).disabled).toBe(true);
    rerender(<CrewTaskBlockRenderer block={base("health_rating")} mode="interactive" unavailable onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Good" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Needs Attention" }).disabled).toBe(true);
    rerender(<CrewTaskBlockRenderer block={base("short_text")} mode="interactive" unavailable onSubmit={onSubmit} />);
    expect(screen.getByLabelText("Short response").disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Save response" }).disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows useful incomplete and unavailable linked-SOP states", () => {
    const { rerender } = render(<CrewTaskBlockRenderer block={base("text", { title: "" })} mode="preview" />);
    expect(screen.getByText("Add a title to preview this block.")).not.toBeNull();
    rerender(<CrewTaskBlockRenderer block={base("sop_reference")} mode="preview" />);
    expect(screen.getByText("Choose a published SOP to preview this block.")).not.toBeNull();
  });

  it("normalizes Admin and Crew schema variants consistently", () => {
    expect(normalizeTaskBlock({ block_type: "text", is_required: false }).required).toBe(false);
    expect(normalizeTaskBlock({ block_type: "confirmation", required: true }).is_required).toBe(true);
    expect(isTaskBlockActionable({ block_type: "text" })).toBe(false);
    expect(isTaskBlockActionable({ block_type: "confirmation" })).toBe(true);
  });

});
