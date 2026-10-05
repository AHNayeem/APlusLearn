/**
 * A learner, as a tutor is allowed to see them (§3, §5, §30).
 *
 * A minor's surname is withheld from tutors unless the family opted in. That
 * used to happen only when a page rendered the name, so the full surname was
 * still in the JSON a tutor's browser received and in screen-reader text
 * (audit S5). It is now removed before the record leaves the service: the
 * surname is replaced by its initial, so every renderer — `publicName`,
 * `learnerDisplayName`, an Avatar's label — produces "Ava S." from data that
 * no longer contains anything more.
 *
 * Pure and shared, so a service and a component cannot disagree about it.
 */
export function learnerForTutor(student) {
  if (!student || typeof student !== "object") return student;
  if (!student.isMinor || student.shareFullNameWithTutor) return student;

  const initial = String(student.lastName ?? "").trim().charAt(0);
  return { ...student, lastName: initial ? `${initial}.` : "", surnameWithheld: true };
}

/** Apply `learnerForTutor` to the `studentProfileId` of each row, if populated. */
export function maskLearnersForTutor(rows, key = "studentProfileId") {
  return (rows ?? []).map((row) =>
    row && row[key] && typeof row[key] === "object" ? { ...row, [key]: learnerForTutor(row[key]) } : row,
  );
}
