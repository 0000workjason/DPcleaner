import { useStore } from "./store";

/** Call once per test file (top-level) to capture the store's pristine
 *  state; call the returned function in beforeEach to reset it. */
export function freshStore() {
  const initial = useStore.getState();
  return () => useStore.setState(initial, true);
}
