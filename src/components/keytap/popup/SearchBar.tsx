/**
 * SearchBar — compact search input with clear button.
 *
 * Auto-focuses on mount so the user can type immediately after opening the
 * popup. The clear (X) button is shown only when the input is non-empty.
 */

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@keytap/lib";

export function SearchBar({
  value,
  onChange,
  placeholder = "Search accounts…",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    // Autofocus on mount, but only after a short delay so the popup is
    // fully painted first (Chrome has weird focus behavior on popup open).
    const t = window.setTimeout(() => ref.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 border-b bg-card px-3",
      )}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
        )}
      />
      {value && (
        <button
          type="button"
          title="Clear search"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          className={cn(
            "inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          )}
        >
          <X className="size-3.5" />
        </button>
      )}
      {focused && !value && (
        <kbd className="hidden text-[9px] font-medium text-muted-foreground/70 sm:inline">esc</kbd>
      )}
    </div>
  );
}
