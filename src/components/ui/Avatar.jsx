import Image from "next/image";
import { cn } from "@/lib/utils/cn";
import { initials as toInitials } from "@/lib/utils/format";

const SIZES = {
  xs: "size-7 text-[10px]",
  sm: "size-9 text-xs",
  md: "size-11 text-sm",
  lg: "size-14 text-base",
  xl: "size-20 text-xl",
  "2xl": "size-28 text-3xl",
};

const PIXEL_SIZES = { xs: 28, sm: 36, md: 44, lg: 56, xl: 80, "2xl": 112 };

/**
 * Deterministic background so the same person always gets the same colour —
 * an avatar that changes on every render looks broken.
 */
const PALETTE = [
  "bg-brand-100 text-brand-700",
  "bg-accent-100 text-accent-800",
  "bg-success-100 text-success-700",
  "bg-info-100 text-info-600",
  "bg-warning-100 text-warning-700",
];

function paletteFor(seed = "") {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return PALETTE[hash % PALETTE.length];
}

export function Avatar({ src, name, firstName, lastName, size = "md", className, ring = false }) {
  const label = name ?? `${firstName ?? ""} ${lastName ?? ""}`.trim();
  const text = firstName || lastName ? toInitials(firstName, lastName) : toInitials(label.split(" ")[0], label.split(" ")[1]);

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold",
        SIZES[size],
        !src && paletteFor(label),
        ring && "ring-2 ring-white",
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={label}
          width={PIXEL_SIZES[size]}
          height={PIXEL_SIZES[size]}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{text}</span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Overlapping avatars, e.g. "tutors your child has worked with". */
export function AvatarGroup({ people = [], max = 4, size = "sm", className }) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <div className={cn("flex -space-x-2", className)}>
      {shown.map((person, i) => (
        <Avatar
          key={person.id ?? i}
          src={person.avatarUrl}
          firstName={person.firstName}
          lastName={person.lastName}
          name={person.name}
          size={size}
          ring
        />
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-ink-100 font-bold text-ink-600 ring-2 ring-white",
            SIZES[size],
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
