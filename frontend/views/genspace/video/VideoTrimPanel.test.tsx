import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoTrimPanel } from "./VideoTrimPanel";

describe("VideoTrimPanel", () => {
  it("keeps the two-second minimum when keyboard end adjusts the excerpt start", async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <VideoTrimPanel
        videoUrl="file:///C:/clip.wav"
        videoDuration={2.041667}
        mediaKind="audio"
        initialStartTime={0}
        initialDuration={2.041667}
        onSelectionChange={onSelectionChange}
      />,
    );

    const start = container.querySelector<HTMLElement>('[role="slider"][aria-label="Excerpt start"]');
    expect(start).not.toBeNull();
    await waitFor(() => expect(Number(start?.getAttribute("aria-valuemax"))).toBeCloseTo(0.041667));
    fireEvent.keyDown(start!, { key: "End" });

    await waitFor(() => {
      const [selectionStart, selectionEnd] = onSelectionChange.mock.lastCall ?? [];
      expect(selectionStart).toBeCloseTo(0.041667);
      expect(selectionEnd).toBeCloseTo(2.041667);
    });
  });
});
