import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { SITE } from "@/constants/config";

/**
 * The application mark.
 *
 * Two modes, one component. With no uploaded logo it draws the wordmark: the
 * initial glyph is drawn rather than set in type so it renders identically
 * before fonts load, and the name comes from settings so renaming the platform
 * renames the mark. With a logo configured it renders that file instead, at a
 * fixed height so a 4:1 and a 1:1 upload both sit correctly in the header.
 *
 * `branding` is passed in rather than fetched: this renders inside client
 * components (the public header, the dashboard rail) that cannot await a
 * service, and the server layouts above them already have the config.
 */
export function Logo({ href = "/", className, mark = false, tone = "default", branding }) {
  const appName = branding?.appName ?? SITE.name;
  const inverse = tone === "inverse";

  // The footer sits on a deep ground, so it takes the dark-background upload
  // when there is one and falls back to the standard logo otherwise.
  const src = inverse ? (branding?.logoDark ?? branding?.logo) : branding?.logo;

  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {src ? (
        /* A plain <img>: the source is an admin-uploaded file served from our
           own API route, already size-bounded on upload, and the intrinsic
           dimensions vary per deployment — nothing the image optimiser can
           usefully add. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={appName}
          className={cn("w-auto object-contain", mark ? "h-9 max-w-9" : "h-9 max-w-44")}
        />
      ) : (
        <Wordmark appName={appName} mark={mark} inverse={inverse} />
      )}
      <span className="sr-only">{appName} — home</span>
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="inline-flex rounded-xl focus-visible:outline-offset-4">
      {content}
    </Link>
  );
}

/** The drawn fallback: an initial in a rounded tile, then the name. */
function Wordmark({ appName, mark, inverse }) {
  const [head, ...rest] = appName.split(" ");
  const tail = rest.join(" ");

  return (
    <>
      <span
        className={cn(
          "relative flex size-9 shrink-0 items-center justify-center rounded-xl font-black",
          inverse ? "bg-white text-brand-700" : "bg-brand-600 text-white",
        )}
        aria-hidden="true"
      >
        <span className="text-[15px] leading-none tracking-tight">
          {appName.charAt(0).toUpperCase()}
        </span>
        <span className="absolute right-1.5 top-1.5 text-[10px] leading-none text-accent-300">+</span>
      </span>
      {!mark && (
        <span
          className={cn(
            "text-[17px] font-extrabold tracking-tight",
            inverse ? "text-white" : "text-ink-900",
          )}
        >
          {head}
          {tail && (
            <span className={inverse ? "text-brand-200" : "text-brand-600"}>{tail}</span>
          )}
        </span>
      )}
    </>
  );
}
