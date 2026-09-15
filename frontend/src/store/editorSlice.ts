import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Tab } from '@/types';

interface EditorState {
  tabs: Tab[];
  activeTabId: string | null;
}

const initialState: EditorState = { tabs: [], activeTabId: null };

const slice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    openTab: (state, action: PayloadAction<Tab>) => {
      const exists = state.tabs.find((t) => t.id === action.payload.id);
      if (!exists) state.tabs.push(action.payload);
      state.activeTabId = action.payload.id;
    },
    closeTab: (state, action: PayloadAction<string>) => {
      state.tabs = state.tabs.filter((t) => t.id !== action.payload);
      if (state.activeTabId === action.payload) {
        state.activeTabId = state.tabs[state.tabs.length - 1]?.id || null;
      }
    },
    setActiveTab: (state, action: PayloadAction<string>) => {
      state.activeTabId = action.payload;
    },
    updateTabContent: (state, action: PayloadAction<{ id: string; content: string }>) => {
      const tab = state.tabs.find((t) => t.id === action.payload.id);
      if (tab) {
        tab.content = action.payload.content;
        tab.isDirty = true;
      }
    },
    markSaved: (state, action: PayloadAction<string>) => {
      const tab = state.tabs.find((t) => t.id === action.payload);
      if (tab) tab.isDirty = false;
    },
  },
});

export const { openTab, closeTab, setActiveTab, updateTabContent, markSaved } = slice.actions;
export default slice.reducer;
