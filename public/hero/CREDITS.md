# Hero imagery

| File | Source | Licence |
|---|---|---|
| `study-hall.jpg` | [Unsplash photo `1427504494785-3a9ca7044f45`](https://unsplash.com/photos/1427504494785-3a9ca7044f45) — library stacks | [Unsplash Licence](https://unsplash.com/license): free for commercial use, no attribution required |

Downloaded at 2400×1350, q62. It is served through `next/image` with `priority`,
so Next re-encodes it to AVIF/WebP and builds the srcset — do not reference the
`.jpg` directly from CSS, or none of that applies.

Replacing it: keep the 16:9 ratio and a dark, low-contrast centre. The hero's
headline sits over the middle third, and the scrim assumes there is no bright
detail there.
