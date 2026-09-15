import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { TutorProfile } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { escapeRegex } from "@/lib/security/sanitize";
import { TUTOR_STATUS, PAGE_SIZES, PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ query }) => {
    const pageSize = query.pageSize ?? PAGE_SIZES.adminTable;
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), "i");
      filter.$or = [{ headline: pattern }, { city: pattern }, { courseCodes: pattern }];
    }

    const [items, total] = await Promise.all([
      TutorProfile.find(filter)
        .sort({ updatedAt: -1 })
        .skip((query.page - 1) * pageSize)
        .limit(pageSize)
        .populate("userId", "firstName lastName email status")
        .lean(),
      TutorProfile.countDocuments(filter),
    ]);

    return ok(
      { tutors: toPlain(items) },
      { meta: paginationMeta({ page: query.page, pageSize, total }) },
    );
  },
  {
    permission: PERMISSIONS.ADMIN_TUTOR_REVIEW,
    querySchema: z.object({
      q: z.string().trim().max(120).optional(),
      status: z.enum(Object.values(TUTOR_STATUS)).optional(),
      page: z.coerce.number().int().min(1).max(500).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
);
