import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { Spinner } from "./Spinner";

/**
 * The single button in the system. Renders as <button>, or as a Next <Link>
 * when `href` is supplied, so navigation and actions look identical without
 * nesting an anchor inside a button.
 */

const VARIANTS = {
  primary:
    "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-brand-600",
  secondary:
    "bg-white text-ink-800 ring-1 ring-inset ring-ink-200 shadow-xs hover:bg-ink-50 hover:ring-ink-300 active:bg-ink-100",
  accent:
    "bg-accent-500 text-white shadow-sm hover:bg-accent-600 active:bg-accent-700 focus-visible:outline-accent-500",
  ghost: "text-ink-700 hover:bg-ink-100 active:bg-ink-200",
  subtle: "bg-brand-50 text-brand-700 hover:bg-brand-100 active:bg-brand-200",
  danger:
    "bg-danger-600 text-white shadow-sm hover:bg-danger-700 active:bg-danger-700 focus-visible:outline-danger-600",
  dangerGhost: "text-danger-600 hover:bg-danger-50 active:bg-danger-100",
  link: "text-brand-600 underline-offset-4 hover:underline p-0 h-auto shadow-none",
};

const SIZES = {
  xs: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  sm: "h-9 px-3.5 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-5 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
  xl: "h-14 px-8 text-base gap-2.5 rounded-2xl",
  icon: "h-10 w-10 rounded-xl",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  href,
  loading = false,
  disabled = false,
  fullWidth = false,
  iconLeft,
  iconRight,
  children,
  ...props
}) {
  const classes = cn(
    "inline-flex items-center justify-center font-semibold whitespace-nowrap",
    "transition-[background-color,box-shadow,transform,color] duration-150 ease-out",
    // A small, quick press response reads as responsive without being playful.
    "active:scale-[0.98] motion-reduce:active:scale-100",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    className,
  );

  const content = (
    <>
      {loading ? <Spinner className="size-4" /> : iconLeft}
      {children}
      {!loading && iconRight}
    </>
  );

  if (href && !disabled && !loading) {
    return (
      <Link href={href} className={classes} {...props}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </button>
  );
}

/** Icon-only button. `label` is required — it becomes the accessible name. */
export function IconButton({ label, className, size = "icon", ...props }) {
  return (
    <Button
      size={size}
      aria-label={label}
      title={label}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}
