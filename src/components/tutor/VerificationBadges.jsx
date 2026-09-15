import { BadgeCheck, ShieldCheck, GraduationCap, School, UserCheck } from "lucide-react";
import { Badge, Tooltip } from "@/components/ui";
import { VERIFICATION_TYPES, VERIFICATION_LABELS, VERIFICATION_DESCRIPTIONS } from "@/constants";

const ICONS = {
  [VERIFICATION_TYPES.IDENTITY]: UserCheck,
  [VERIFICATION_TYPES.OCT]: School,
  [VERIFICATION_TYPES.EDUCATION]: GraduationCap,
  [VERIFICATION_TYPES.UNIVERSITY_STUDENT]: GraduationCap,
  [VERIFICATION_TYPES.BACKGROUND_CHECK]: ShieldCheck,
};

/** Short labels so a row of badges fits on a search card. */
const SHORT = {
  [VERIFICATION_TYPES.IDENTITY]: "ID verified",
  [VERIFICATION_TYPES.OCT]: "OCT",
  [VERIFICATION_TYPES.EDUCATION]: "Education",
  [VERIFICATION_TYPES.UNIVERSITY_STUDENT]: "Student",
  [VERIFICATION_TYPES.BACKGROUND_CHECK]: "Background check",
};

export function VerificationBadges({ types = [], max, size = "sm", compact = false }) {
  if (!types.length) return null;
  const shown = max ? types.slice(0, max) : types;
  const overflow = types.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((type) => {
        const Icon = ICONS[type] ?? BadgeCheck;
        return (
          <Tooltip key={type} content={VERIFICATION_DESCRIPTIONS[type]}>
            <Badge tone="success" size={size} icon={<Icon className="size-3" />}>
              {compact ? SHORT[type] : VERIFICATION_LABELS[type]}
            </Badge>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <Badge tone="neutral" size={size}>
          +{overflow}
        </Badge>
      )}
    </div>
  );
}
