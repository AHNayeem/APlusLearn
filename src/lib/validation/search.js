import { z } from "zod";
import {
  COURSE_SORTS, GRADE_STAGES, LESSON_MODES, QUALIFICATION_TYPES, VERIFICATION_TYPES,
} from "@/constants";
import { csvArray, boolQuery, provinceCode } from "./common";

/**
 * Tutor search query (§14). Every field arrives as a string from the URL, so
 * each is coerced and bounded here before it reaches the query builder.
 */
export const tutorSearchSchema = z.object({
  // What
  q: z.string().trim().max(120).optional(),
  province: provinceCode.optional(),
  grade: z.string().trim().max(40).optional(), // slug, e.g. "grade-12"
  subject: z.string().trim().max(60).optional(), // slug, e.g. "mathematics"
  course: z.string().trim().max(60).optional(), // slug
  courseCode: z.string().trim().toUpperCase().max(12).optional(),

  // Where / how
  mode: z.enum([...Object.values(LESSON_MODES), "ANY"]).optional(),
  city: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().toUpperCase().max(8).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  distanceKm: z.coerce.number().int().min(1).max(500).optional(),

  // Filters
  minPrice: z.coerce.number().int().min(0).max(100000).optional(),
  maxPrice: z.coerce.number().int().min(0).max(100000).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  minExperience: z.coerce.number().int().min(0).max(60).optional(),
  qualifications: csvArray(z.enum(Object.values(QUALIFICATION_TYPES))),
  verified: csvArray(z.enum(Object.values(VERIFICATION_TYPES))),
  availability: csvArray(
    z.enum(["WEEKDAY_MORNING", "WEEKDAY_AFTERNOON", "WEEKDAY_EVENING", "WEEKEND"]),
  ),
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
