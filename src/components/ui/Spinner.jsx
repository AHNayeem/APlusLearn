import { cn } from "@/lib/utils/cn";

export function Spinner({ className, label = "Loading" }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <svg
        className={cn("size-5 animate-spin text-current", className)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path
          className="opacity-90"
          fill="currentColor"
          d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2Z"
        />
      </svg>
    </span>
  );
}
