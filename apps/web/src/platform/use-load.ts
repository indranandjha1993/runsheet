import { useCallback, useEffect, useState } from "react";
import type { ApiError, ApiResult } from "./api.js";

export type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "failed"; readonly error: ApiError };

// Every screen loads the same way and shows the same three states. A screen never holds a
// half-loaded value, and a reload never flashes the empty state in between.
export function useLoad<T>(
  load: () => Promise<ApiResult<T>>,
  deps: readonly unknown[],
): { readonly loaded: Loaded<T>; readonly reload: () => void } {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    void load().then((result) => {
      if (!live) return;
      setLoaded(result.ok ? { state: "ready", value: result.value } : { state: "failed", error: result.error });
    });
    return () => {
      live = false;
    };
    // The caller names what the load depends on; the loader itself is recreated each render.
  }, [...deps, generation]);

  const reload = useCallback(() => {
    setGeneration((n) => n + 1);
  }, []);

  return { loaded, reload };
}
