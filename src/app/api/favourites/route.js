import { z } from "zod";
import { routeHandler, ok, created } from "@/lib/api";
import { favouriteSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { listFavourites, addFavourite, removeFavourite } from "@/services/student.service";
import { toPublicTutor } from "@/services/tutor.service";
import { PERMISSIONS, FEATURES } from "@/constants";

export const GET = routeHandler(
  async ({ user }) => {
    const favourites = await listFavourites(user);
    return ok({
      favourites: favourites.map((f) => ({
        id: String(f._id),
        note: f.note ?? null,
        savedAt: f.createdAt,
        tutor: toPublicTutor(f.tutorProfileId, f.tutorProfileId.userId),
      })),
    });
  },
  { feature: FEATURES.FAVOURITES, permission: PERMISSIONS.FAVOURITE_MANAGE },
);

export const POST = routeHandler(
  async ({ user, body }) => created({ favourite: await addFavourite(body, user) }),
  {
    feature: FEATURES.FAVOURITES,
    permission: PERMISSIONS.FAVOURITE_MANAGE,
    bodySchema: favouriteSchema,
  },
);

export const DELETE = routeHandler(
  async ({ user, query }) => ok(await removeFavourite(query.tutorProfileId, user)),
  {
    feature: FEATURES.FAVOURITES,
    permission: PERMISSIONS.FAVOURITE_MANAGE,
    querySchema: z.object({ tutorProfileId: objectId }),
  },
);
