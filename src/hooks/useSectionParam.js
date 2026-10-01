"use client";

import { useState } from "react";

/**
 * Which section of a client-side console is open, mirrored into one query
 * parameter so a reload or a shared link lands on the same section.
 *
 * The URL is written with `history.replaceState`, which Next's router picks
 * up without a navigation — so switching sections never re-requests the
 * server component that already loaded the data. `replace` rather than
 * `push`: moving between panels of one screen is not somewhere Back should
 * step through.
 *
 * `initial` comes from the page's `searchParams`. Anything not in `values`
 * falls back to the first section rather than rendering an empty panel.
 */
export function useSectionParam(param, values, initial) {
  const [value, setValue] = useState(() => (values.includes(initial) ? initial : values[0]));

  const select = (next) => {
    setValue(next);
    const params = new URLSearchParams(window.location.search);
    params.set(param, next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  };

  return [value, select];
}
