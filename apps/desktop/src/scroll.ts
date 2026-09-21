import { createContext, useContext } from "react";

/** The main area's scrolling element, for lists that render only what is on screen. */
export const ScrollParent = createContext<HTMLElement | null>(null);

export function useScrollParent(): HTMLElement | null {
  return useContext(ScrollParent);
}
