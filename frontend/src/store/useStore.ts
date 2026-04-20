import { create } from 'zustand';
import { CorpusStats, ResearchProgressEvent } from '../utils/api';

interface AppStore {
  stats: CorpusStats | null;
  setStats: (stats: CorpusStats) => void;

  activeRun: ResearchProgressEvent | null;
  setActiveRun: (run: ResearchProgressEvent | null) => void;

  notifications: Array<{ id: string; type: 'success' | 'error' | 'info'; message: string }>;
  addNotification: (type: 'success' | 'error' | 'info', message: string) => void;
  removeNotification: (id: string) => void;
}

export const useStore = create<AppStore>((set) => ({
  stats: null,
  setStats: (stats) => set({ stats }),

  activeRun: null,
  setActiveRun: (activeRun) => set({ activeRun }),

  notifications: [],
  addNotification: (type, message) => {
    const id = crypto.randomUUID();
    set(state => ({
      notifications: [...state.notifications, { id, type, message }],
    }));
    // Auto-remove after 5 seconds
    setTimeout(() => {
      set(state => ({
        notifications: state.notifications.filter(n => n.id !== id),
      }));
    }, 5000);
  },
  removeNotification: (id) => {
    set(state => ({
      notifications: state.notifications.filter(n => n.id !== id),
    }));
  },
}));
