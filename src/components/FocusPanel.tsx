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
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-[380px] border-l border-zinc-200 bg-white shrink-0 overflow-hidden flex flex-col"
      >
        {/* Back indicator */}
        {focusStack.length > 1 && (
          <button
            onClick={popFocus}
            className="px-4 py-1.5 text-[11px] text-violet-600 font-medium border-b border-zinc-100 hover:bg-zinc-50 transition-colors text-left"
          >
            Back
          </button>
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
