import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { persistStore, persistReducer } from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import authReducer from './authSlice';
import editorReducer from './editorSlice';

const editorPersistConfig = {
  key: 'editor',
  storage,
  whitelist: ['tabs', 'activeTabId'],
};

const rootReducer = combineReducers({
  auth: authReducer,
  editor: persistReducer(editorPersistConfig, editorReducer),
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefault) => getDefault({ serializableCheck: false }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
