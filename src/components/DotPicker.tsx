import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Search } from "lucide-react";

interface DotOption {
  slug: string;
  name: string;
}

interface DotPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (dot: DotOption, reason: string) => Promise<void> | void;
  excludeSlug?: string | null;
  className?: string;
}

export function DotPicker({
  open,
  onClose,
  onSelect,
  excludeSlug,
  className = "",
}: DotPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dots, setDots] = useState<DotOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [submittingSlug, setSubmittingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setError(null);
    invoke<[string, string][]>("get_all_dot_slugs")
      .then((entries) => {
        setDots(entries.map(([slug, name]) => ({ slug, name })));
      })
      .catch(() => setError("Impossible de charger les dots"))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setReason("");
      setSubmittingSlug(null);
      setError(null);
    }
  }, [open]);

  const filteredDots = useMemo(() => {
    const query = search.trim().toLowerCase();
    return dots.filter((dot) => {
      if (excludeSlug && dot.slug === excludeSlug) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        dot.slug.toLowerCase().includes(query) ||
        dot.name.toLowerCase().includes(query)
      );
    });
  }, [dots, excludeSlug, search]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className={`absolute right-0 top-10 z-30 w-72 rounded-2xl border border-border bg-popover shadow-2xl ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b border-border px-3 py-2.5">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Choisir un dot"
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-[13px] text-foreground outline-none transition-colors focus:border-[#1d9bf0]"
            autoFocus
          />
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : filteredDots.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
            Aucun dot correspondant
          </p>
        ) : (
          filteredDots.map((dot) => (
            <button
              key={dot.slug}
              type="button"
              onClick={async () => {
                setSubmittingSlug(dot.slug);
                setError(null);
                try {
                  await onSelect(dot, reason.trim());
                  onClose();
                } catch (eventError) {
                  setError(String(eventError));
                } finally {
                  setSubmittingSlug(null);
                }
              }}
              disabled={submittingSlug !== null}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-50"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {dot.name}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {dot.slug}
                </div>
              </div>
              {submittingSlug === dot.slug && (
                <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
              )}
            </button>
          ))
        )}
      </div>

      <div className="border-t border-border px-3 py-3">
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Raison optionnelle"
          rows={2}
          className="min-h-[68px] w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[#1d9bf0]"
        />
        {error && (
          <p className="mt-2 text-[12px] text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}

export type { DotOption };
