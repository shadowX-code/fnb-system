import { describe, expect, it } from "vitest";
import { IMAGE_UPLOAD_MAX_BYTES, validateLearningImageFile } from "../imageUpload.js";

describe("Crew Learning image validation", () => {
  it("accepts the explicit image MIME allowlist", () => {
    expect(() => validateLearningImageFile(new File(["image"], "lesson.webp", { type: "image/webp" }))).not.toThrow();
  });

  it("rejects SVG and executable MIME types even when the filename looks safe", () => {
    expect(() => validateLearningImageFile(new File(["svg"], "lesson.png", { type: "image/svg+xml" }))).toThrow(/JPG, PNG, or WebP/);
    expect(() => validateLearningImageFile(new File(["exe"], "lesson.png", { type: "application/octet-stream" }))).toThrow(/JPG, PNG, or WebP/);
  });

  it("rejects oversized images before upload", () => {
    const file = { name: "large.png", type: "image/png", size: IMAGE_UPLOAD_MAX_BYTES + 1 };
    expect(() => validateLearningImageFile(file)).toThrow(/5MB/);
  });
});
