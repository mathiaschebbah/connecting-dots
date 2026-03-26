import { create } from "zustand";

export type Page =
  | { type: "dots" }
  | { type: "dot"; slug: string };

interface AppState {
  page: Page;
  navigate: (page: Page) => void;
  back: () => void;
  history: Page[];

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  webviewOpen: boolean;
  setWebviewOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  page: { type: "dots" },
  history: [],

  navigate: (page) =>
    set((s) => ({
      history: [...s.history, s.page],
      page,
    })),

  back: () =>
    set((s) => {
      if (s.history.length === 0) return { page: { type: "dots" } };
      const prev = s.history[s.history.length - 1];
      return {
        page: prev,
        history: s.history.slice(0, -1),
      };
    }),

  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  webviewOpen: false,
  setWebviewOpen: (webviewOpen) => set({ webviewOpen }),
}));
