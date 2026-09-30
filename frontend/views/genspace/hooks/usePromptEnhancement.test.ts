import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backendFetch } from "../../../lib/backend";
import { usePromptEnhancement, type PromptEnhancementRequest } from "./usePromptEnhancement";

vi.mock("../../../lib/backend", () => ({ backendFetch: vi.fn() }));
const request: PromptEnhancementRequest = { prompt: "Original", mode: "image", referenceImagePaths: [] };
const response = () => new Response(JSON.stringify({ prompt: "Enhanced" }), { status: 200 });

describe("manual prompt enhancement", () => {
  beforeEach(() => vi.mocked(backendFetch).mockReset());
  it("requires Apply, invalidates changed context and cannot revive an old draft", async () => {
    vi.mocked(backendFetch).mockResolvedValue(response());
    const { result, rerender } = renderHook(({ key }) => usePromptEnhancement(key, () => request), { initialProps: { key: "project-a" } });
    await act(() => result.current.enhance());
    expect(result.current.accepted).toBeNull();
    act(() => result.current.review.apply());
    expect(result.current.accepted?.effectivePrompt).toBe("Enhanced");
    rerender({ key: "project-b" });
    expect(result.current.accepted).toBeNull();
    rerender({ key: "project-a" });
    act(() => result.current.review.apply());
    expect(result.current.accepted).toBeNull();
  });
  it("rejects an in-flight result after the source changes", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(backendFetch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ key }) => usePromptEnhancement(key, () => request), { initialProps: { key: "original" } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.enhance(); });
    rerender({ key: "changed" });
    await act(async () => { finish(response()); await pending; });
    expect(result.current.review.text).toBeNull();
    expect(result.current.review.error).toBeTruthy();
  });
  it("restores accepted metadata and clears it for an ordinary Copy Settings", () => {
    const { result } = renderHook(() => usePromptEnhancement("restored", () => request));
    act(() => result.current.restore({ originalPrompt: "Original", effectivePrompt: "Saved" }));
    expect(result.current.accepted?.effectivePrompt).toBe("Saved");
    act(() => result.current.restore(null));
    expect(result.current.accepted).toBeNull();
  });
});
