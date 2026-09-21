import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, with later Tailwind utilities beating earlier ones.
 *
 * Plain concatenation loses that: `"p-2" + "p-4"` leaves both in the string and
 * the winner is whichever CSS rule happens to come later, not the one the
 * caller passed. Every shadcn component takes a `className` expecting this.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
