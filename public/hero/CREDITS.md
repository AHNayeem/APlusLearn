# Hero imagery

| File | Source | Licence |
|---|---|---|
| `iewek-gnos.jpg` | **In use.** Added to the project directly; filename matches the Unsplash photographer *Iewek Gnos*. | **Unverified — confirm before launch.** Nobody on this side fetched it, so its licence has not been checked. |
| `study-hall.jpg` | **In use** on the sign-in / sign-up aside. [Unsplash photo `1427504494785-3a9ca7044f45`](https://unsplash.com/photos/1427504494785-3a9ca7044f45) — library stacks | [Unsplash Licence](https://unsplash.com/license): free for commercial use, no attribution required |

Both are served through `next/image`, so Next re-encodes them to AVIF/WebP and
builds the srcset — do not reference the `.jpg` directly from CSS, or none of
that applies. Only the homepage hero carries `priority`; on the auth pages the
form is the LCP element, so the aside photo loads lazily behind it.

Replacing the hero photo: the treatment in `HeroBackdrop` bleaches whatever it
is given (low opacity, brightened, half-desaturated, blurred), so composition
matters far more than colour. Keep the centre free of high-contrast detail —
the headline sits over the middle third, and the white plate assumes there is
nothing busy behind it.
