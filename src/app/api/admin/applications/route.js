import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { adminApplicationQuerySchema } from "@/lib/validation/admin";
import { TutorApplication, User } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { escapeRegex } from "@/lib/security/sanitize";
import { PERMISSIONS, TUTOR_STATUS, PAGE_SIZES } from "@/constants";

export const GET = routeHandler(
  async ({ query }) => {
    const pageSize = query.pageSize ?? PAGE_SIZES.adminTable;
    const filter = { status: query.status ?? TUTOR_STATUS.PENDING_REVIEW };

    // Searching by name/email means resolving users first.
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), "i");
      const ids = await User.find({
        $or: [{ firstName: pattern }, { lastName: pattern }, { email: pattern }],
      }).distinct("_id");
      filter.userId = { $in: ids };
    }

    const [items, total] = await Promise.all([
      TutorApplication.find(filter)
        .sort({ submittedAt: 1, createdAt: -1 })
        .skip((query.page - 1) * pageSize)
        .limit(pageSize)
        .populate("userId", "firstName lastName email phone city province createdAt")
        .populate("tutorProfileId", "slug headline hourlyRateCents courseCodes yearsExperience city province qualifications")
        .lean(),
      TutorApplication.countDocuments(filter),
    ]);

    return ok(
      { applications: toPlain(items) },
      { meta: paginationMeta({ page: query.page, pageSize, total }) },
    );
  },
  { permission: PERMISSIONS.ADMIN_TUTOR_REVIEW, querySchema: adminApplicationQuerySchema },
);
