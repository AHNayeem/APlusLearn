"use client";

import { useState } from "react";

/**
 * Today's date as "YYYY-MM-DD", captured once when the component mounts.
 *
 * Reading the clock during render is impure — it can differ between the
 * server and client passes and changes unpredictably on re-render. Date inputs
 * only need a stable lower bound, so capturing it once is both correct and
 * sufficient.
 */
export function useToday() {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  return today;
}
