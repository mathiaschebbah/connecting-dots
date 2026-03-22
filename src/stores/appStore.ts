import { create } from "zustand";

export type Lens = "river" | "clusters" | "graph" | "boards" | "agent" | "pinned";

export interface FocusItem {
  type: "tweet" | "author" | "topic";
  id: string;
}

interface AppState {
  lens: Lens;
  setLens: (lens: Lens) => void;

  activeCategory: string | null;
  setActiveCategory: (cat: string | null) => void;

  activeCluster: string | null;
  setActiveCluster: (cluster: string | null) => void;
  navigateToCluster: (cluster: string) => void;

  focusStack: FocusItem[];
  pushFocus: (item: FocusItem) => void;
  popFocus: () => void;
  clearFocus: () => void;

  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  lens: "river",
  setLens: (lens) => set({ lens }),

  activeCategory: null,
  setActiveCategory: (activeCategory) => set({ activeCategory }),

  activeCluster: null,
  setActiveCluster: (activeCluster) => set({ activeCluster }),
  navigateToCluster: (cluster) => set({ lens: "graph", activeCluster: cluster }),

  focusStack: [],
  pushFocus: (item) =>
    set((s) => {
      const last = s.focusStack[s.focusStack.length - 1];
      if (last?.type === item.type && last?.id === item.id) return s;
      return { focusStack: [...s.focusStack, item] };
    }),
  popFocus: () =>
    set((s) => ({ focusStack: s.focusStack.slice(0, -1) })),
  clearFocus: () => set({ focusStack: [] }),

  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
}));
