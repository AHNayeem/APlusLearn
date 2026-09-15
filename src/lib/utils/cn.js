import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, resolving Tailwind conflicts predictably. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
