import { Image, Music, Video } from "lucide-react";
import type { ReactNode } from "react";
import { GenPanelSection } from "./GenPanelSection";
import { MentionTextarea, type MentionOption } from "./MentionTextarea";
import type { PromptEnhancementReview } from "../hooks/usePromptEnhancement";

type MediaMention = {
  alias: string;
  type: "image" | "video" | "audio";
  url: string;
};
type MediaOption = MentionOption & {
  kind: "add" | "alias";
  type: MediaMention["type"];
  alias?: string;
};

function MediaIcon({ type }: { type: MediaMention["type"] }) {
  const Icon = type === "image" ? Image : type === "video" ? Video : Music;
  return <Icon className="h-3.5 w-3.5" />;
}

function mediaLeading(item: MediaMention) {
  if (item.type === "image") return <img src={item.url} alt="" className="h-5 w-5 rounded object-cover" />;
  if (item.type === "video") return <video src={item.url} muted playsInline preload="metadata" className="h-5 w-5 rounded object-cover" />;
  return <span className="flex h-5 w-5 items-center justify-center rounded bg-input text-violet-300"><MediaIcon type={item.type} /></span>;
}

function PromptMediaTextarea({ value, onChange, onSubmit, canSubmit, disabled, placeholder, maxLength, height, mediaMentions, onAddMedia, mediaAddDisabled }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  disabled: boolean;
  placeholder: string;
  maxLength?: number;
  height: string;
  mediaMentions?: MediaMention[];
  onAddMedia?: (type: MediaMention["type"]) => void;
  mediaAddDisabled?: Partial<Record<MediaMention["type"], boolean>>;
}) {
  const options = mediaMentions
    ? (query: string): MediaOption[] => [
        ...(["image", "video", "audio"] as const).map((type) => ({
          id: `add:${type}`,
          kind: "add" as const,
          group: "Media",
          type,
          label: `Add ${type}`,
          disabled: mediaAddDisabled?.[type],
          disabledReason: mediaAddDisabled?.[type] ? `The selected model cannot add ${type} references.` : undefined,
          leading: <span className="flex h-5 w-5 items-center justify-center rounded bg-input text-violet-300"><MediaIcon type={type} /></span>,
        })),
        ...mediaMentions
          .filter((item) => item.alias.slice(1).toLowerCase().includes(query))
          .map((item) => ({
            id: item.alias,
            kind: "alias" as const,
            group: "References",
            type: item.type,
            alias: item.alias,
            label: item.alias.slice(1),
            leading: mediaLeading(item),
          })),
      ]
    : undefined;
  return <MentionTextarea value={value} onChange={onChange} options={options} onSelect={(option, replace) => {
    const media = option as MediaOption;
    if (media.kind === "add") {
      replace("");
      onAddMedia?.(media.type);
      return;
    }
    replace(media.alias ?? "");
  }} onSubmit={onSubmit} canSubmit={canSubmit} disabled={disabled} placeholder={placeholder} maxLength={maxLength} ariaLabel="Prompt" className={`${height} w-full resize-none overflow-y-auto bg-transparent px-3 pb-3 pt-3 text-sm leading-5 text-foreground placeholder:text-subtle-foreground focus:outline-hidden`} />;
}

export function PromptEditor({
  enhancementReview,
  title = "",
  value,
  onChange,
  onSubmit,
  canSubmit,
  disabled,
  placeholder,
  leading,
  bottomRight,
  children,
  actions,
  maxLength,
  height = "h-36",
  mediaAliases,
  mediaMentions,
  onAddMedia,
  mediaAddDisabled,
}: {
  enhancementReview?: PromptEnhancementReview;
  title?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  disabled: boolean;
  placeholder: string;
  leading?: ReactNode;
  bottomRight?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  maxLength?: number;
  height?: string;
  mediaAliases?: string[];
  mediaMentions?: MediaMention[];
  onAddMedia?: (type: MediaMention["type"]) => void;
  mediaAddDisabled?: Partial<Record<MediaMention["type"], boolean>>;
}) {
  return <GenPanelSection title={title} collapsible={false}>
    <div className="flex items-start rounded-lg border border-border bg-card">
      {leading}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {children ?? <PromptMediaTextarea value={value} onChange={onChange} onSubmit={onSubmit} canSubmit={canSubmit} disabled={disabled} placeholder={placeholder} maxLength={maxLength} height={height} mediaMentions={mediaMentions} onAddMedia={onAddMedia} mediaAddDisabled={mediaAddDisabled} />}
        {enhancementReview?.text ? <div className="space-y-2 border-t border-border p-3">
          <p className="text-xs text-muted-foreground">{enhancementReview.applied ? "Applied for generation. Your authored prompt and sequence remain editable above." : "Review the enhanced generation prompt before applying."}</p>
          <textarea aria-label="Enhanced generation prompt" readOnly value={enhancementReview.text} className="h-32 w-full resize-y rounded bg-input p-2 text-sm" />
          <div className="flex gap-2">
            {!enhancementReview.applied ? <button type="button" disabled={disabled || enhancementReview.busy} onClick={enhancementReview.apply} className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground">Apply</button> : null}
            <button type="button" disabled={disabled} onClick={enhancementReview.discard} className="rounded bg-input px-3 py-1 text-xs">{enhancementReview.applied ? "Use original" : "Discard"}</button>
          </div>
        </div> : null}
        {enhancementReview?.error ? <p role="alert" className="px-3 py-2 text-xs text-destructive">{enhancementReview.error}</p> : null}
        {mediaAliases?.length ? <div className="flex flex-wrap gap-1 border-t border-border px-2 py-1.5">{mediaAliases.map((alias) => <button key={alias} type="button" onClick={() => onChange(value ? `${value} ${alias}` : alias)} className="rounded bg-input px-1.5 py-0.5 text-2xs text-muted-foreground hover:bg-surface-hover">{alias}</button>)}</div> : null}
        {actions || bottomRight ? <div data-testid="prompt-editor-footer" className="flex items-center justify-between gap-2 rounded-b-lg px-2 py-1.5"><div data-testid="prompt-editor-footer-left" className="flex min-w-0 items-center">{actions}</div><div data-testid="prompt-editor-footer-right" className="ml-auto flex min-w-0 items-center">{bottomRight}</div></div> : null}
      </div>
    </div>
  </GenPanelSection>;
}
