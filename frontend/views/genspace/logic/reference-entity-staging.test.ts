import { describe, expect, it, vi } from "vitest";
import { stageEntityInputs } from "./reference-entity-staging";

describe("stageEntityInputs", () => {
  it("cleans already staged paths and does not return inputs when a later copy fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    await expect(stageEntityInputs([
      { id: "reference-a", path: "C:/library/a.png", url: "file:///C:/library/a.png", role: "reference_image", type: "image" },
      { id: "reference-b", path: "C:/library/b.png", url: "file:///C:/library/b.png", role: "reference_image", type: "image" },
    ], vi.fn().mockResolvedValueOnce({ success: true, path: "C:/project/a.png", url: "file:///C:/project/a.png" }).mockResolvedValueOnce({ success: false, error: "copy failed" }), cleanup)).rejects.toThrow("copy failed");
    expect(cleanup).toHaveBeenCalledWith(["C:/project/a.png"]);
  });

  it("does not clean a reused project asset after a later copy fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    await expect(stageEntityInputs([
      { id: "reference-a", path: "C:/project/a.png", url: "file:///C:/project/a.png", role: "reference_image", type: "image" },
      { id: "reference-b", path: "C:/library/b.png", url: "file:///C:/library/b.png", role: "reference_image", type: "image" },
    ], vi.fn().mockResolvedValueOnce({ success: true, path: "C:/project/a.png", url: "file:///C:/project/a.png", reusedExisting: true }).mockResolvedValueOnce({ success: false, error: "copy failed" }), cleanup)).rejects.toThrow("copy failed");
    expect(cleanup).toHaveBeenCalledWith([]);
  });
});
