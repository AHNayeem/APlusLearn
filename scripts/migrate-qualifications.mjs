/**
 * Move stored qualifications onto the §8 categories (R8.9–R8.12).
 *
 * Earlier builds stored three coarse values — GRADUATE, POSTGRADUATE and
 * SUBJECT_SPECIALIST — that search could not tell apart (a Master's from a
 * PhD, a Bachelor's from a graduate certificate). This maps them:
 *
 *   GRADUATE            → BACHELORS_DEGREE
 *   SUBJECT_SPECIALIST  → INDUSTRY_PROFESSIONAL
 *   POSTGRADUATE        → DOCTORATE when the profile lists a *completed* PhD
 *                         or doctorate, otherwise MASTERS_DEGREE
 *
 * on tutor profiles, on the QUALIFICATIONS step of tutor applications, and on
 * tutor requests' preferred qualifications. Idempotent: a second run finds
 * nothing to change. Prints every change it makes.
 *
 *   MONGODB_URI=mongodb://… node scripts/migrate-qualifications.mjs [--dry-run]
 */
import mongoose from "mongoose";

const DRY_RUN = process.argv.includes("--dry-run");
const LEGACY = ["GRADUATE", "POSTGRADUATE", "SUBJECT_SPECIALIST"];
const DOCTORATE = /\b(ph\.?\s?d|doctorate|doctor of|d\.?\s?phil|ed\.?\s?d)\b/i;

function hasCompletedDoctorate(education = []) {
  return education.some((entry) => DOCTORATE.test(entry?.credential ?? "") && !entry.inProgress);
}

export function mapQualifications(list = [], education = []) {
  const mapped = list.map((value) => {
    if (value === "GRADUATE") return "BACHELORS_DEGREE";
    if (value === "SUBJECT_SPECIALIST") return "INDUSTRY_PROFESSIONAL";
    if (value === "POSTGRADUATE") return hasCompletedDoctorate(education) ? "DOCTORATE" : "MASTERS_DEGREE";
    return value;
  });
  return [...new Set(mapped)];
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI to the database to migrate.");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`\nQualification migration → ${uri.replace(/\/\/[^@]*@/, "//***@")}${DRY_RUN ? " (dry run)" : ""}\n`);

  let changed = 0;
  const apply = async (collection, filter, update, label) => {
    changed += 1;
    console.log(`  ${label}`);
    if (!DRY_RUN) await db.collection(collection).updateOne(filter, update);
  };

  for await (const profile of db.collection("tutorprofiles").find({ qualifications: { $in: LEGACY } })) {
    const next = mapQualifications(profile.qualifications, profile.education);
    await apply("tutorprofiles", { _id: profile._id }, { $set: { qualifications: next } },
      `profile ${profile.slug}: ${profile.qualifications.join(",")} → ${next.join(",")}`);
  }

  for await (const app of db.collection("tutorapplications").find({ "data.QUALIFICATIONS.qualifications": { $in: LEGACY } })) {
    const current = app.data.QUALIFICATIONS.qualifications;
    const next = mapQualifications(current, app.data?.EDUCATION?.education ?? app.data?.EDUCATION?.entries ?? []);
    await apply("tutorapplications", { _id: app._id }, { $set: { "data.QUALIFICATIONS.qualifications": next } },
      `application ${app._id}: ${current.join(",")} → ${next.join(",")}`);
  }

  for await (const request of db.collection("tutorrequests").find({ preferredQualifications: { $in: LEGACY } })) {
    const next = mapQualifications(request.preferredQualifications);
    await apply("tutorrequests", { _id: request._id }, { $set: { preferredQualifications: next } },
      `request ${request.reference}: ${request.preferredQualifications.join(",")} → ${next.join(",")}`);
  }

  console.log(`\n${changed} record${changed === 1 ? "" : "s"} ${DRY_RUN ? "would change" : "changed"}.\n`);
  await mongoose.disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
