import { ROLES } from "./roles.js";

/** Public marketing/marketplace navigation. */
export const PUBLIC_NAV = [
  { href: "/find-a-tutor", label: "Find a tutor" },
  { href: "/courses", label: "Courses" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/verification", label: "Verification" },
];

export const FOOTER_NAV = [
  {
    title: "Find tutoring",
    links: [
      { href: "/find-a-tutor", label: "Search tutors" },
      { href: "/courses", label: "Browse courses" },
      { href: "/find-a-tutor?mode=ONLINE", label: "Online tutoring" },
      { href: "/find-a-tutor?mode=IN_PERSON", label: "In-person tutoring" },
      { href: "/requests/new", label: "Post a tutor request" },
    ],
  },
  {
    title: "For tutors",
    links: [
      { href: "/become-a-tutor", label: "Become a tutor" },
      { href: "/verification", label: "Getting verified" },
      { href: "/pricing", label: "Fees and payouts" },
      { href: "/tutor/dashboard", label: "Tutor dashboard" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About us" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/safety", label: "Safety" },
      { href: "/support", label: "Support" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms of service" },
      { href: "/legal/privacy", label: "Privacy policy" },
      { href: "/legal/cookies", label: "Cookie policy" },
      { href: "/legal/cancellation", label: "Cancellation & refunds" },
      { href: "/legal/accessibility", label: "Accessibility" },
    ],
  },
];

/**
 * Footer discovery columns (§29). These are plain search URLs rather than a
 * database read so the footer stays static on every page — the labels mirror
 * the subjects the curriculum seeds, so every link returns results.
 */
export const FOOTER_SUBJECT_LINKS = [
  { href: "/find-a-tutor?subject=mathematics", label: "Mathematics" },
  { href: "/find-a-tutor?subject=english", label: "English" },
  { href: "/find-a-tutor?subject=science", label: "General science" },
  { href: "/find-a-tutor?subject=physics", label: "Physics" },
  { href: "/find-a-tutor?subject=chemistry", label: "Chemistry" },
  { href: "/find-a-tutor?subject=biology", label: "Biology" },
  { href: "/find-a-tutor?subject=french", label: "French" },
  { href: "/find-a-tutor?subject=computer-science", label: "Computer science" },
  { href: "/find-a-tutor?subject=business-studies", label: "Business studies" },
  { href: "/find-a-tutor?subject=history", label: "History" },
  { href: "/find-a-tutor?subject=geography", label: "Geography" },
  { href: "/find-a-tutor?subject=social-sciences", label: "Social sciences" },
  { href: "/courses?popular=true", label: "Ontario course codes" },
];

/** The same subjects, scoped to online delivery (§14 `mode` filter). */
export const FOOTER_ONLINE_LINKS = [
  { href: "/find-a-tutor?mode=ONLINE&subject=mathematics", label: "Online math tutoring" },
  { href: "/find-a-tutor?mode=ONLINE&subject=english", label: "Online English tutoring" },
  { href: "/find-a-tutor?mode=ONLINE&subject=physics", label: "Online physics classes" },
  { href: "/find-a-tutor?mode=ONLINE&subject=chemistry", label: "Online chemistry classes" },
  { href: "/find-a-tutor?mode=ONLINE&subject=biology", label: "Online biology classes" },
  { href: "/find-a-tutor?mode=ONLINE&subject=computer-science", label: "Online coding classes" },
  { href: "/find-a-tutor?mode=ONLINE&subject=french", label: "Online French classes" },
  { href: "/find-a-tutor?mode=ONLINE&courseCode=MCV4U", label: "MCV4U calculus help" },
  { href: "/find-a-tutor?mode=ONLINE&courseCode=MHF4U", label: "MHF4U functions help" },
  { href: "/find-a-tutor?mode=IN_PERSON", label: "In-person tutoring" },
];

/** Short, high-traffic marketing links for the lower footer band. */
export const FOOTER_USEFUL_LINKS = [
  { href: "/about", label: "About" },
  { href: "/courses", label: "Courses" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/find-a-tutor", label: "Find a tutor" },
  { href: "/become-a-tutor", label: "Become a tutor" },
  { href: "/safety", label: "Safety" },
  { href: "/verification", label: "Verification" },
  { href: "/faq", label: "F.A.Q" },
  { href: "/login", label: "Sign in now" },
];

/** Bottom bar. `/legal/[slug]` renders each of these. */
export const FOOTER_LEGAL_LINKS = [
  { href: "/support", label: "Support" },
  { href: "/legal/terms", label: "Terms of use" },
  { href: "/legal/privacy", label: "Privacy policy" },
  { href: "/legal/cookies", label: "Cookie notice" },
  { href: "/legal/accessibility", label: "Accessibility" },
];

/** Dashboard sidebars, keyed by role. Icons are lucide-react names. */
export const PARENT_NAV = [
  { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
  { href: "/bookings", label: "Lessons", icon: "CalendarDays" },
  { href: "/messages", label: "Messages", icon: "MessageSquare", badge: "unreadMessages" },
  { href: "/tutors", label: "My tutors", icon: "Users" },
  { href: "/favourites", label: "Saved tutors", icon: "Heart" },
  { href: "/requests", label: "Tutor requests", icon: "Megaphone" },
  { href: "/children", label: "Children", icon: "Baby", roles: [ROLES.PARENT] },
  { href: "/payments", label: "Payments", icon: "CreditCard" },
  { href: "/reviews", label: "My reviews", icon: "Star" },
  { href: "/notifications", label: "Notifications", icon: "Bell", badge: "unreadNotifications" },
  { href: "/settings", label: "Settings", icon: "Settings" },
];

export const TUTOR_NAV = [
  { href: "/tutor/dashboard", label: "Overview", icon: "LayoutDashboard" },
  { href: "/tutor/calendar", label: "Calendar", icon: "CalendarDays" },
  { href: "/tutor/bookings", label: "Lessons", icon: "BookOpen" },
  { href: "/tutor/students", label: "Students", icon: "Users" },
  { href: "/tutor/messages", label: "Messages", icon: "MessageSquare", badge: "unreadMessages" },
  { href: "/tutor/requests", label: "Tutor requests", icon: "Megaphone" },
  { href: "/tutor/earnings", label: "Earnings", icon: "TrendingUp" },
  { href: "/tutor/payouts", label: "Payouts", icon: "Banknote" },
  { href: "/tutor/reviews", label: "Reviews", icon: "Star" },
  { href: "/tutor/profile", label: "Profile", icon: "UserCircle" },
  { href: "/tutor/verification", label: "Verification", icon: "BadgeCheck" },
  { href: "/tutor/notifications", label: "Notifications", icon: "Bell", badge: "unreadNotifications" },
  { href: "/tutor/settings", label: "Settings", icon: "Settings" },
];

export const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Overview", icon: "LayoutDashboard" },
  { href: "/admin/analytics", label: "Analytics", icon: "BarChart3" },
  { href: "/admin/applications", label: "Applications", icon: "ClipboardCheck", badge: "pendingApplications" },
  { href: "/admin/verification", label: "Verification", icon: "BadgeCheck" },
  { href: "/admin/tutors", label: "Tutors", icon: "GraduationCap" },
  { href: "/admin/users", label: "Users", icon: "Users" },
  { href: "/admin/curriculum", label: "Curriculum", icon: "Library" },
  { href: "/admin/bookings", label: "Bookings", icon: "CalendarDays" },
  { href: "/admin/payments", label: "Payments", icon: "CreditCard" },
  { href: "/admin/payouts", label: "Payouts", icon: "Banknote" },
  { href: "/admin/disputes", label: "Disputes", icon: "ShieldAlert", badge: "openDisputes" },
  { href: "/admin/reviews", label: "Reviews", icon: "Star" },
  { href: "/admin/settings", label: "Settings", icon: "Settings" },
];

export function navForRole(role) {
  if (role === ROLES.ADMIN) return ADMIN_NAV;
  if (role === ROLES.TUTOR) return TUTOR_NAV;
  return PARENT_NAV.filter((item) => !item.roles || item.roles.includes(role));
}

export function homeForRole(role) {
  if (role === ROLES.ADMIN) return "/admin/dashboard";
  if (role === ROLES.TUTOR) return "/tutor/dashboard";
  return "/dashboard";
}
