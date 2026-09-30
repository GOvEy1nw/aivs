import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FloatingMenu } from "./FloatingMenu";

export interface UseMediaOption<T extends string> {
  target: T;
  label: string;
  icon?: ReactNode;
}

export function UseMediaDropdown<T extends string>({
  label,
  icon,
  options,
  onSelect,
  variant = "detail",
}: {
  label: string;
  icon: ReactNode;
  options: readonly UseMediaOption<T>[];
  onSelect: (target: T) => void;
  variant?: "context" | "detail";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isContext = variant === "context";

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={
          isContext
            ? "flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover"
            : "flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-card hover:text-foreground"
        }
      >
        {icon}
        <span>{label}</span>
        {isContext ? (
          <ChevronRight className="ml-auto h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      {open ? (
        <FloatingMenu
          ref={menuRef}
          anchorRef={rootRef}
          placement={isContext ? "right-start" : "top-start"}
          gap={isContext ? 4 : 8}
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
          className="max-h-60 w-48 overflow-y-auto rounded-md border border-border bg-popover p-1.5 shadow-xl"
        >
          {options.map((option) => (
            <button
              key={option.target}
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(option.target);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              {option.icon}
              <span>{option.label}</span>
            </button>
          ))}
        </FloatingMenu>
      ) : null}
    </div>
  );
}
