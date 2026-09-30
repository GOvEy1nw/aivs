import { useCallback, useEffect, useRef, useState } from "react";
import { backendFetch } from "../../../lib/backend";

export interface AppliedPromptEnhancement {
  originalPrompt: string;
  effectivePrompt: string;
}

export interface PromptEnhancementReview {
  text: string | null;
  applied: boolean;
  busy: boolean;
  error: string | null;
  apply: () => void;
  discard: () => void;
}

export interface PromptEnhancementRequest {
  prompt: string;
  mode: "image" | "video";
  modelProfileId?: string;
  inputImagePath?: string | null;
  endImagePath?: string;
  controlImagePath?: string;
  referenceImagePaths: string[];
  durationSeconds?: number;
}

export function usePromptEnhancement(contextKey: string, capture: () => PromptEnhancementRequest) {
  const context = useRef({ key: contextKey, revision: 0 });
  if (context.current.key !== contextKey) {
    context.current = { key: contextKey, revision: context.current.revision + 1 };
  }
  const [draft, setDraft] = useState<(AppliedPromptEnhancement & { revision: number; applied: boolean }) | null>(null);
  const [restored, setRestored] = useState<AppliedPromptEnhancement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const requestSequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!restored) return;
    setDraft({ ...restored, revision: context.current.revision, applied: true });
    setRestored(null);
  }, [restored]);
  const current = draft?.revision === context.current.revision ? draft : null;
  const stale = Boolean(draft && !current);
  const enhance = async () => {
    if (pending.current) return;
    const revision = context.current.revision;
    const requestId = ++requestSequence.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const request = capture();
      if (!request.prompt.trim()) throw new Error("Enter a prompt before enhancing.");
      const response = await backendFetch("/api/enhance-prompt", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const detail = result && typeof result === "object" && "detail" in result ? result.detail : null;
        throw new Error(typeof detail === "string" ? detail : "Local prompt enhancement failed.");
      }
      if (!result || typeof result !== "object" || !("prompt" in result) || typeof result.prompt !== "string" || !result.prompt.trim()) {
        throw new Error("The local enhancer returned an empty prompt.");
      }
      if (!mounted.current) return;
      if (requestId !== requestSequence.current) return;
      if (revision !== context.current.revision) throw new Error("The prompt, project or inputs changed. Enhance the current draft again.");
      setDraft({ originalPrompt: request.prompt, effectivePrompt: result.prompt, revision, applied: false });
    } catch (cause) {
      if (mounted.current && requestId === requestSequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const discard = () => { requestSequence.current++; setDraft(null); setError(null); };
  const review: PromptEnhancementReview = {
    text: current?.effectivePrompt ?? null, applied: current?.applied ?? false, busy,
    error: stale ? "The prompt, project or inputs changed. The previous enhancement will not be used." : error,
    apply: () => setDraft((value) => value?.revision === context.current.revision ? { ...value, applied: true } : null),
    discard,
  };
  const restore = useCallback((value: AppliedPromptEnhancement | null) => {
    requestSequence.current++;
    setDraft(null);
    setError(null);
    setRestored(value);
  }, []);
  return { enhance, review, accepted: current?.applied ? current : null, restore, discard };
}
