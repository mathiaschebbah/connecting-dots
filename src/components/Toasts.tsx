import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";

interface Toast {
  id: number;
  message: string;
}

interface SyncEvent {
  worker: string;
  status: string;
  detail: string | null;
}

let nextId = 0;

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    const unlisten = listen<SyncEvent>("sync:event", (event) => {
      const e = event.payload;

      if (e.worker === "bookmarks" && e.status === "done" && e.detail) {
        if (!e.detail.startsWith("error")) {
          addToast(e.detail);
        }
      }

      if (e.worker === "enricher" && e.status === "done" && e.detail) {
        addToast(e.detail);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addToast]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg border border-border bg-card px-4 py-2.5 text-[13px] text-foreground shadow-lg"
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
