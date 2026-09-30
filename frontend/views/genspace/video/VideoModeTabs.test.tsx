import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "../../../types/model-profiles";
import { VideoModeTabs } from "./VideoModeTabs";

describe("VideoModeTabs", () => {
  it("keeps unavailable Retake disabled and selects a concrete tool", async () => {
    const onChange = vi.fn();
    const onToolChange = vi.fn();

    render(
      <VideoModeTabs
        mode="generate"
        onChange={onChange}
        selectedTool="reframe"
        onToolChange={onToolChange}
        profiles={[{
          availability: "available",
          videoEdits: {
            operations: [
              { id: "reframe", status: "stable", handler: "video_generation" },
              { id: "extend", status: "stable", handler: "video_generation" },
              { id: "relight", status: "hidden", handler: "video_generation" },
              {
                id: "retake",
                status: "hidden",
                handler: "retake",
                disabledReason: "Retake is not yet compatible with WanGP",
              },
            ],
          },
        } as ModelProfile]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose tool" }));
    const retake = screen.getByRole("button", { name: "Retake: No compatible installed model is available." });
    expect((retake as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Relight: No compatible installed model is available." }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    expect(onChange).toHaveBeenCalledWith("reframe");
    expect(onToolChange).toHaveBeenCalledWith("extend");

    const trigger = screen.getByRole("button", { name: "Choose tool" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Tool catalogue" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Tool catalogue" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close Tool catalogue" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
