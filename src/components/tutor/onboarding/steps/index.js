import { PersonalStep } from "./PersonalStep";
import { ProfileStep } from "./ProfileStep";
import { EducationStep } from "./EducationStep";
import { QualificationsStep } from "./QualificationsStep";
import { CoursesStep } from "./CoursesStep";
import { LessonTypeStep } from "./LessonTypeStep";
import { LocationStep } from "./LocationStep";
import { PricingStep } from "./PricingStep";
import { AvailabilityStep } from "./AvailabilityStep";
import { DocumentsStep } from "./DocumentsStep";
import { ReviewStep } from "./ReviewStep";

/** Maps each onboarding step key to its form component (§17). */
export const STEP_COMPONENTS = {
  PERSONAL: PersonalStep,
  PROFILE: ProfileStep,
  EDUCATION: EducationStep,
  QUALIFICATIONS: QualificationsStep,
  COURSES: CoursesStep,
  LESSON_TYPE: LessonTypeStep,
  LOCATION: LocationStep,
  PRICING: PricingStep,
  AVAILABILITY: AvailabilityStep,
  DOCUMENTS: DocumentsStep,
  REVIEW: ReviewStep,
};
