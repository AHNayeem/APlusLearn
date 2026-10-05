import mongoose from "mongoose";

/**
 * One tutor search, as the admin "most searched" report needs it (§28,
 * R28.31).
 *
 * Only what the search *meant*, after it was resolved against the
 * curriculum: the province, grade, subject and course it narrowed to, the
 * lesson format, the kind of location given and the city it resolved to, and
 * how many tutors it found. Deliberately absent: the free text typed, the
 * postal code, the visitor, their IP and any session or device id. A search
 * is somebody looking for help for their child; the report needs to know
 * what is in demand, not who asked.
 *
 * Rows age out on their own (`expiresAt` TTL), so the collection is a rolling
 * window rather than a permanent record of every search ever made.
 */
const SearchEventSchema = new mongoose.Schema(
  {
    provinceCode: { type: String, uppercase: true, trim: true },
    gradeSlug: { type: String, trim: true },
    gradeLevel: { type: Number },
    subjectSlug: { type: String, trim: true },
    subjectName: { type: String, trim: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
    courseCode: { type: String, uppercase: true, trim: true },
    courseName: { type: String, trim: true },

    /** How the visitor described what they wanted (never what they typed). */
    queryKind: {
      type: String,
      enum: ["COURSE_CODE", "COURSE", "SUBJECT", "TEXT", "NONE"],
      default: "NONE",
    },
    mode: { type: String, enum: ["ONLINE", "IN_PERSON", "ANY"], default: "ANY" },

    /** Whether a location was given, and how it was resolved. */
    locationKind: { type: String, enum: ["CITY", "POSTAL_CODE", "NONE"], default: "NONE" },
    locationResolved: { type: Boolean, default: false },
    /** The resolved city name — a place, not an address. */
    city: { type: String, trim: true },

    /** Filter *names* in use (e.g. "availability", "price"), for the report. */
    filters: { type: [String], default: [] },
    resultCount: { type: Number, default: 0, min: 0 },

    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

SearchEventSchema.index({ createdAt: -1 });
SearchEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SearchEvent =
  mongoose.models.SearchEvent || mongoose.model("SearchEvent", SearchEventSchema);
