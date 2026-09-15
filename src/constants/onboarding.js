/**
 * Tutor onboarding steps (§17).
 *
 * Lives in constants rather than on the model so the wizard's Client
 * Components can import it without pulling mongoose into the browser bundle.
 */

export const ONBOARDING_STEPS = [
  "PERSONAL",
  "PROFILE",
  "EDUCATION",
  "QUALIFICATIONS",
  "COURSES",
  "LESSON_TYPE",
  "LOCATION",
  "PRICING",
  "AVAILABILITY",
  "DOCUMENTS",
  "REVIEW",
];

export const ONBOARDING_STEP_META = {
  PERSONAL: { title: "Personal information", description: "How we reach you and confirm who you are." },
  PROFILE: { title: "Your profile", description: "The headline and bio parents read first." },
  EDUCATION: { title: "Education", description: "Degrees, diplomas and current studies." },
  QUALIFICATIONS: { title: "Qualifications", description: "Teaching credentials and experience." },
  COURSES: { title: "Courses you teach", description: "Pick the exact provincial courses." },
  LESSON_TYPE: { title: "Lesson type", description: "Online, in person, or both." },
  LOCATION: { title: "Service area", description: "Where you can travel to teach." },
  PRICING: { title: "Pricing", description: "Your hourly rate and any course overrides." },
  AVAILABILITY: { title: "Availability", description: "The weekly hours you can teach." },
  DOCUMENTS: { title: "Verification documents", description: "Proof for your trust badges." },
  REVIEW: { title: "Review & submit", description: "Check everything before it goes to our team." },
};
