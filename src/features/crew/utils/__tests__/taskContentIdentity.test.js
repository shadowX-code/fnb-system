import { describe, expect, it } from "vitest";
import { duplicateTaskBlock, repairDraftTaskIdentity, moveTaskBlock } from "../taskContentIdentity.js";
import { taskLocalizationUnits } from "../localizedContent.js";

const block = { id: "a", block_type: "checklist_item", title: "Clean Counter Area", config: { localization_key: "a", options: [{ id: "yes", label: "Yes" }] } };
describe("Task content identity", () => {
  it("gives repeated copies and copies of copies fresh independent identities", () => {
    const copy = duplicateTaskBlock(block);
    const copies = [block, copy, duplicateTaskBlock(block), duplicateTaskBlock(copy)];
    expect(new Set(copies.map((item) => item.id)).size).toBe(4);
    const units = taskLocalizationUnits({ name: "Opening Duties", blocks: copies }, "en");
    expect(new Set(units.map((unit) => unit.unit_key)).size).toBe(units.length);
    copy.config.options[0].label = "Edited";
    expect(block.config.options[0].label).toBe("Yes");
  });
  it("repairs Draft collisions once while preserving first identity and active evidence", () => {
    const invalid = { status: "draft", blocks: [block, { ...block, id: "b" }] };
    const repaired = repairDraftTaskIdentity(invalid);
    expect(repaired.blocks[0].config.localization_key).toBe("a");
    expect(repaired.blocks[1].config.localization_key).not.toBe("a");
    expect(repairDraftTaskIdentity(repaired)).toEqual(repaired);
    const active = { ...invalid, status: "active" };
    expect(repairDraftTaskIdentity(active)).toBe(active);
    expect(invalid.blocks[1].config.localization_key).toBe("a");
  });
  it("preserves identity through repeated reorders and removes deleted projection units", () => {
    const copy = duplicateTaskBlock(block);
    const initial = [block, copy];
    const moved = moveTaskBlock(initial, copy.id, block.id, "before");
    expect(moved).toEqual([copy, block]);
    expect(moveTaskBlock(moved, copy.id, block.id, "after")).toEqual(initial);
    const keys = (blocks) => taskLocalizationUnits({ name: "Opening Duties", blocks }, "en").map((row) => row.unit_key).sort();
    expect(keys(moved)).toEqual(keys(initial));
    expect(keys([block]).some((key) => key.includes(copy.config.localization_key))).toBe(false);
  });
});
