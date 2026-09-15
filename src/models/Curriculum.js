import mongoose from "mongoose";

/**
 * Canadian curriculum hierarchy (§13):
 *   Province -> Grade -> Subject -> Course (carrying a provincial course code)
 *
 * Provinces/grades/subjects are small, stable reference collections kept
 * separate so a new province can be added without a migration. Courses
 * reference them so search can filter on any level.
 */

const ProvinceSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // ON, BC
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    /** Provinces without curriculum data yet are hidden from pickers. */
    isActive: { type: Boolean, default: false, index: true },
    /** Whether the province issues course codes (Ontario: MHF4U etc.). */
    usesCourseCodes: { type: Boolean, default: false },
    courseCodeHint: { type: String, trim: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const GradeSchema = new mongoose.Schema(
  {
    provinceId: { type: mongoose.Schema.Types.ObjectId, ref: "Province", required: true, index: true },
    name: { type: String, required: true, trim: true }, // "Grade 12"
    slug: { type: String, required: true, index: true }, // "grade-12"
    level: { type: Number, required: true }, // sort key; 0 = Kindergarten
    stage: { type: String, enum: ["ELEMENTARY", "MIDDLE", "SECONDARY"], required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
GradeSchema.index({ provinceId: 1, slug: 1 }, { unique: true });
GradeSchema.index({ provinceId: 1, level: 1 });

const SubjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // "Mathematics"
    slug: { type: String, required: true, unique: true, index: true },
    /** Short label for chips/cards. */
    shortName: { type: String, trim: true },
    description: { type: String, trim: true },
    icon: { type: String, trim: true }, // lucide icon name
    colorKey: { type: String, trim: true }, // design-system accent key
    isPopular: { type: Boolean, default: false, index: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const CourseSchema = new mongoose.Schema(
  {
    provinceId: { type: mongoose.Schema.Types.ObjectId, ref: "Province", required: true, index: true },
    gradeId: { type: mongoose.Schema.Types.ObjectId, ref: "Grade", required: true, index: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", required: true, index: true },

    name: { type: String, required: true, trim: true }, // "Advanced Functions"
    /** Provincial course code, e.g. MHF4U. Uppercase, unique per province. */
    code: { type: String, trim: true, uppercase: true, index: true },
    slug: { type: String, required: true, index: true }, // "advanced-functions"

    description: { type: String, trim: true },
    credits: { type: Number },
    stream: { type: String, trim: true }, // University / College / Workplace / Open

    /** Denormalised for fast search facets and SEO copy without $lookup. */
    provinceCode: { type: String, uppercase: true, index: true },
    gradeSlug: { type: String, index: true },
    gradeLevel: { type: Number, index: true },
    subjectSlug: { type: String, index: true },
    subjectName: { type: String },

    isPopular: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },

    /** Maintained by the tutor service so course pages can show supply. */
    tutorCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/**
 * A course code is unique within a province. This is a *partial* index rather
 * than a sparse one: elementary courses legitimately have no code, and a
 * sparse index still indexes an explicit `null`, so several codeless courses
 * would collide. Filtering on the type restricts the constraint to courses
 * that actually carry a code.
 */
CourseSchema.index(
  { provinceId: 1, code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: "string" } } },
);
CourseSchema.index({ provinceId: 1, gradeId: 1, slug: 1 }, { unique: true });
// Search by course name or code (§13).
CourseSchema.index({ name: "text", code: "text", description: "text" }, { name: "course_search" });
CourseSchema.index({ provinceCode: 1, gradeSlug: 1, subjectSlug: 1 });

export const Province = mongoose.models.Province || mongoose.model("Province", ProvinceSchema);
export const Grade = mongoose.models.Grade || mongoose.model("Grade", GradeSchema);
export const Subject = mongoose.models.Subject || mongoose.model("Subject", SubjectSchema);
export const Course = mongoose.models.Course || mongoose.model("Course", CourseSchema);
