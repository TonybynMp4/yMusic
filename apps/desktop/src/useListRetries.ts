import { useCallback, useEffect, useRef } from "react";

/** How many times the list is fetched again while a new playlist is missing from it. */
const LIST_RETRIES = 5;

/**
 * A new playlist reaches YouTube's library list a while after it exists, so
 * the list is fetched again, further apart each time, until it has it. Its
 * entry then swaps the placeholder for YouTube's, with its art. Returns a
 * function that starts the count again, for when another playlist is created.
 */
export function useListRetries(
  waiting: boolean,
  fetching: boolean,
  refetch: () => void,
): () => void {
  const retries = useRef(0);
  useEffect(() => {
    if (!waiting || fetching || retries.current >= LIST_RETRIES) return;
    const timer = setTimeout(
      () => {
        retries.current += 1;
        refetch();
      },
      (retries.current + 1) * 2000,
    );
    return () => clearTimeout(timer);
  }, [waiting, fetching, refetch]);
  return useCallback(() => {
    retries.current = 0;
  }, []);
}
