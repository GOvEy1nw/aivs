import { LoaderCircle, Sparkles } from "lucide-react";
import { SeedControl } from "../../../components/SeedControl";

export function PromptActions({
  seedLocked,
  lockedSeed,
  onSeedChange,
  disabled,
  prompt,
  onEnhance,
  onEnhanceDraft,
  isEnhancing,
  showEnhance = true,
  enhanceEnabled,
  enhanceTitle = "Automatically enhance when generating",
}: {
  seedLocked: boolean;
  lockedSeed: number;
  onSeedChange: (seed: { seedLocked: boolean; lockedSeed: number }) => void;
  disabled: boolean;
  prompt: string;
  onEnhance?: () => void;
  onEnhanceDraft?: () => void;
  isEnhancing?: boolean;
  showEnhance?: boolean;
  enhanceEnabled?: boolean;
  enhanceTitle?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {showEnhance && onEnhanceDraft ? <button type="button" onClick={onEnhanceDraft} disabled={disabled || isEnhancing} className="rounded-xl bg-surface-raised px-3 py-2 text-xs text-muted-foreground hover:bg-surface-hover disabled:opacity-40">{isEnhancing ? "Enhancing…" : "Enhance draft"}</button> : null}
      {showEnhance && onEnhance ? (
        <button
          type="button"
          onClick={onEnhance}
          disabled={
            disabled ||
            isEnhancing ||
            (enhanceEnabled === undefined && !prompt.trim())
          }
          aria-pressed={enhanceEnabled}
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 disabled:hover:bg-transparent ${
            enhanceEnabled
              ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              : "bg-surface-raised text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:hover:text-muted-foreground"
          }`}
          title={enhanceTitle}
          aria-label={enhanceTitle}
        >
          {isEnhancing ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
      <SeedControl
        seedLocked={seedLocked}
        lockedSeed={lockedSeed}
        onChange={onSeedChange}
        disabled={disabled}
        menuAlign="left"
      />
    </div>
  );
}
