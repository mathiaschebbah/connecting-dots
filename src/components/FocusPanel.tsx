import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "../stores/appStore";
import { TweetDetail } from "./TweetDetail";

export function FocusPanel() {
  const focusStack = useAppStore((s) => s.focusStack);
  const popFocus = useAppStore((s) => s.popFocus);
  const clearFocus = useAppStore((s) => s.clearFocus);
  const pushFocus = useAppStore((s) => s.pushFocus);

  const current = focusStack[focusStack.length - 1] || null;

  // Escape to close/pop
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (focusStack.length > 1) popFocus();
        else clearFocus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusStack.length, popFocus, clearFocus]);

  if (!current) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={current.id}
        initial={{ x: 440, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 440, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-[440px] bg-white border-l border-zinc-200/60 rounded-l-2xl shadow-lg shrink-0 overflow-hidden flex flex-col relative z-20"
      >
        {/* Premium Navigation Header */}
        {focusStack.length > 1 && (
          <div className="px-6 py-4 border-b border-zinc-100/60 bg-zinc-50/30">
            <button
              onClick={popFocus}
              className="group flex items-center gap-2.5 text-[13px] text-zinc-500 hover:text-zinc-900 transition-all duration-200 ease-out font-medium"
            >
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-white group-hover:bg-zinc-100 border border-zinc-200/60 shadow-sm transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </div>
              Retour
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {current.type === "tweet" && (
            <TweetDetail
              tweetId={current.id}
              onClose={clearFocus}
              onNavigate={(id) => pushFocus({ type: "tweet", id })}
            />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
