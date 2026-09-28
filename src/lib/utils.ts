// Tailwind class-merging helper used throughout the UI components — combines
// conditional class lists (clsx) and resolves conflicting Tailwind utilities
// in favor of the last one specified (tailwind-merge), e.g. so a consumer
// passing className="p-4" can override a component's own "p-2" default.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
