import { createContext, useContext, useSyncExternalStore } from "react";
import type { createModelDirectory } from "./modelDirectory";

export const ModelDirectoryContext = createContext<ReturnType<typeof createModelDirectory> | null>(null);

export function useModelDirectory() {
  const store = useContext(ModelDirectoryContext)!;
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot);
  return {...snapshot, refresh: () => store.load(true), rememberKey: store.rememberKey};
}
