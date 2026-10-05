import { z } from "zod";
import {
  COURSE_SORTS, GRADE_STAGES, LESSON_MODES, OFFERED_QUALIFICATION_TYPES, VERIFICATION_TYPES,
  SEARCH_AVAILABILITY_DAYS, SEARCH_TIME_OF_DAY,
} from "@/constants";
import { csvArray, boolQuery, provinceCode } from "./common";

/** Lesson formats a search can ask for: either, one, or tutors offering both. */
export const SEARCH_MODES = [...Object.values(LESSON_MODES), "BOTH", "ANY"];

/**
 * Tutor search query (§14). Every field arrives as a string from the URL, so
 * each is coerced and bounded here before it reaches the query builder.
 *
 * `q` is what the visitor typed. It is never classified here: the search
 * service matches it against the curriculum itself (a real course code, a
 * subject or one of its aliases, a course name) and only falls back to free
 * text when it is none of those — so "Math" is a subject, "MHF4U" is a
 * course and "Physics" is never mistaken for a course code (R2.5).
 */
export const tutorSearchSchema = z.object({
  // What
  q: z.string().trim().max(120).optional(),
  province: provinceCode.optional(),
  grade: z.string().trim().max(40).optional(), // slug, e.g. "grade-12"
  subject: z.string().trim().max(60).optional(), // slug or alias, e.g. "mathematics", "math"
  course: z.string().trim().max(80).optional(), // slug or alias
  courseCode: z.string().trim().toUpperCase().max(12).optional(),

  // Where / how
  mode: z.enum(SEARCH_MODES).optional(),
  city: z.string().trim().max(80).optional(),
  // Validated as a postal code by the search service, which answers a
  // malformed one with a message rather than a refused request.
  postalCode: z.string().trim().toUpperCase().max(8).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  // A radius in km, or "any" — which really means any (R8.5).
  distanceKm: z
    .union([z.literal("any"), z.coerce.number().int().min(1).max(500)])
    .optional(),

  // Filters
  minPrice: z.coerce.number().int().min(0).max(100000).optional(),
  maxPrice: z.coerce.number().int().min(0).max(100000).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  minExperience: z.coerce.number().int().min(0).max(60).optional(),
  qualifications: csvArray(z.enum(OFFERED_QUALIFICATION_TYPES)),
  verified: csvArray(z.enum(Object.values(VERIFICATION_TYPES))),
  /**
   * Which day (R8.17–R8.20): TODAY, TOMORROW, THIS_WEEK, WEEKEND. The
   * WEEKDAY_* values are accepted for links made before these existed.
   */
  availability: csvArray(
    z.enum([
      ...SEARCH_AVAILABILITY_DAYS.map((d) => d.value),
      "WEEKDAY_MORNING", "WEEKDAY_AFTERNOON", "WEEKDAY_EVENING",
    ]),
  ),
  timeOfDay: csvArray(z.enum(SEARCH_TIME_OF_DAY.map((t) => t.value))),
  /** A specific date and, optionally, start time (R8.21), in the tutor's zone. */
  date: z.iso.date().optional().or(z.literal("").transform(() => undefined)),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time like 16:30.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  languages: csvArray(z.string().trim().max(40)),
  freeIntro: boolQuery,
  acceptingNew: boolQuery,

  // Presentation
  sort: z
    .enum(["RELEVANCE", "RATING", "PRICE_ASC", "PRICE_DESC", "EXPERIENCE", "DISTANCE", "AVAILABILITY"])
    .default("RELEVANCE"),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).optional(),
});

/**
 * Course browse query (§13). Mirrors the tutor schema's shape so the two
 * search pages can share their URL conventions — every filter is a string in
 * the URL, coerced and bounded here before it reaches the query builder.
 */
export const courseSearchSchema = z.object({
  // What
  q: z.string().trim().max(80).optional(),
  province: provinceCode.optional(),
  grade: z.string().trim().max(40).optional(), // slug, e.g. "grade-12"
  subject: z.string().trim().max(60).optional(), // slug, e.g. "mathematics"

  // Narrowing
  stage: csvArray(z.enum(GRADE_STAGES.map((s) => s.value))),
  stream: csvArray(z.string().trim().max(40)),
  minGrade: z.coerce.number().int().min(0).max(12).optional(),
  maxGrade: z.coerce.number().int().min(0).max(12).optional(),
  hasTutors: boolQuery,
  hasCode: boolQuery,
  popular: boolQuery,

  // Presentation
  sort: z.enum(COURSE_SORTS).default("RELEVANCE"),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).optional(),
});

/** Homepage hero + header autocomplete. */
export const suggestSchema = z.object({
  q: z.string().trim().min(1).max(60),
  province: provinceCode.optional(),
  limit: z.coerce.number().int().min(1).max(15).default(8),
});

export const geocodeSchema = z.object({
  postalCode: z.string().trim().toUpperCase().max(8).optional(),
  city: z.string().trim().max(80).optional(),
});
