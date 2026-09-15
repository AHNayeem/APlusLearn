# APlus Learn — Full-Stack Next.js Production Implementation

You are building **APlus Learn**, a completely new production-ready tutoring marketplace application.

This is a **greenfield application**.

There is NO existing application that needs to be preserved.

The complete APlus Learn requirement document is the **primary source of truth** for product functionality and scope.

Reference UI/UX:

https://tuturn.wp-guppy.com/home-2/

Use the reference only for **visual and UX inspiration**. Do not copy its branding, content, assets, exact design, or implementation.

---

# 1. PRODUCT VISION

APlus Learn is a Canada-focused tutoring marketplace connecting parents/students with qualified tutors for online and in-person tutoring.

The core journey is:

**Search → Compare → Match → Message → Book → Pay → Attend → Review → Rebook**

The application must feel like:

**Modern + Trustworthy + Friendly + Premium**

It must NOT feel like:

* a generic LMS
* an online course platform
* a classified ads website
* a simple tutor directory
* an old-fashioned education portal
* a WordPress template

The final product should feel like a serious modern Canadian marketplace that parents can trust.

---

# 2. GREENFIELD APPLICATION

This is a completely new application.

Do NOT assume any existing application architecture.

Design the project structure properly from the beginning.

Prioritize:

* clean architecture
* scalability
* maintainability
* reusable components
* clear domain boundaries
* secure server-side logic
* API separation
* database integrity
* responsive UI
* future extensibility

Do not create unnecessary complexity.

Build a practical production-ready architecture appropriate for an MVP that can grow into a large marketplace.

---

# 3. TECHNOLOGY STACK — STRICT

Use:

* Next.js
* JavaScript only
* Tailwind CSS
* MongoDB

Additional libraries may be used only when they provide clear value.

### Important:

**NO TypeScript.**

Do not create:

* `.ts`
* `.tsx`

Use:

* `.js`
* `.jsx`

Do not introduce a separate backend framework.

---

# 4. FULL-STACK ARCHITECTURE

There must be **NO separate backend application**.

The entire application must live inside one Next.js project.

Architecture:

```text id="r7gq3f"
APlus Learn
│
├── Next.js Frontend
│
├── Next.js API
│   └── /app/api/...
│
├── Server-side Business Logic
│
├── MongoDB
│
└── External Services
    ├── Payment provider
    ├── Email provider
    ├── Google/Apple authentication
    ├── Maps/geocoding
    └── Zoom/Meet/Teams
```

Next.js should handle:

* frontend rendering
* routing
* API endpoints
* server-side logic
* authentication/session handling
* authorization
* database access
* validation
* business rules
* secure operations

MongoDB is the primary database.

---

# 5. RECOMMENDED PROJECT STRUCTURE

Create a clean structure similar to:

```text id="b4x2kz"
src/
├── app/
│   ├── (public)/
│   │   ├── page.js
│   │   ├── how-it-works/
│   │   ├── find-a-tutor/
│   │   ├── become-a-tutor/
│   │   ├── tutors/
│   │   ├── courses/
│   │   ├── about/
│   │   ├── pricing/
│   │   ├── verification/
│   │   ├── safety/
│   │   ├── faq/
│   │   ├── support/
│   │   └── legal/
│   │
│   ├── (auth)/
│   │   ├── login/
│   │   ├── register/
│   │   ├── verify-email/
│   │   ├── forgot-password/
│   │   └── reset-password/
│   │
│   ├── (dashboard)/
│   │   ├── dashboard/
│   │   ├── messages/
│   │   ├── bookings/
│   │   ├── tutors/
│   │   ├── children/
│   │   ├── payments/
│   │   ├── requests/
│   │   ├── notifications/
│   │   └── settings/
│   │
│   ├── tutor/
│   │   ├── dashboard/
│   │   ├── onboarding/
│   │   ├── profile/
│   │   ├── calendar/
│   │   ├── bookings/
│   │   ├── students/
│   │   ├── earnings/
│   │   ├── payouts/
│   │   ├── reviews/
│   │   └── verification/
│   │
│   ├── admin/
│   │   ├── dashboard/
│   │   ├── users/
│   │   ├── tutors/
│   │   ├── applications/
│   │   ├── verification/
│   │   ├── curriculum/
│   │   ├── bookings/
│   │   ├── payments/
│   │   ├── disputes/
│   │   ├── reviews/
│   │   ├── analytics/
│   │   └── settings/
│   │
│   └── api/
│       ├── auth/
│       ├── users/
│       ├── students/
│       ├── tutors/
│       ├── curriculum/
│       ├── search/
│       ├── availability/
│       ├── bookings/
│       ├── payments/
│       ├── payouts/
│       ├── messages/
│       ├── requests/
│       ├── matching/
│       ├── favourites/
│       ├── reviews/
│       ├── notifications/
│       ├── disputes/
│       ├── admin/
│       └── webhooks/
│
├── components/
│   ├── ui/
│   ├── layout/
│   ├── navigation/
│   ├── search/
│   ├── tutor/
│   ├── booking/
│   ├── calendar/
│   ├── messaging/
│   ├── reviews/
│   ├── verification/
│   ├── notifications/
│   ├── dashboard/
│   └── admin/
│
├── lib/
│   ├── db/
│   ├── auth/
│   ├── permissions/
│   ├── validation/
│   ├── security/
│   ├── search/
│   ├── booking/
│   ├── payments/
│   ├── matching/
│   └── utils/
│
├── services/
│   ├── auth/
│   ├── users/
│   ├── tutors/
│   ├── curriculum/
│   ├── bookings/
│   ├── payments/
│   ├── messages/
│   ├── reviews/
│   ├── matching/
│   └── notifications/
│
├── models/
│   ├── User.js
│   ├── Tutor.js
│   ├── Student.js
│   ├── Booking.js
│   ├── Course.js
│   └── ...
│
├── hooks/
├── constants/
└── middleware.js
```

Adapt the structure if there is a better Next.js architecture, but preserve the principle:

**UI → Service → API/Server Logic → MongoDB**

Do not mix database access directly into random UI components.

---

# 6. API-FIRST INTERNAL ARCHITECTURE

Even though there is no separate backend, build proper APIs inside Next.js.

Use:

```text id="2o5f4j"
/app/api/...
```

for API route handlers.

Examples:

```text id="8d4t2w"
GET    /api/tutors
GET    /api/tutors/:id
POST   /api/tutors
PATCH  /api/tutors/:id

GET    /api/curriculum/provinces
GET    /api/curriculum/courses
GET    /api/search/tutors

GET    /api/bookings
POST   /api/bookings
PATCH  /api/bookings/:id

GET    /api/messages
POST   /api/messages

GET    /api/reviews
POST   /api/reviews
```

Use consistent:

* request validation
* response format
* HTTP status codes
* error handling
* authentication checks
* authorization checks

Do not put all business logic directly inside route handlers.

Route handler:

```text id="qzj0sv"
Request
 ↓
Authentication
 ↓
Authorization
 ↓
Validation
 ↓
Service
 ↓
Database
 ↓
Response
```

---

# 7. MONGODB ARCHITECTURE

MongoDB is the application database.

Create a centralized database connection layer.

Do NOT create a new database connection on every request.

Use a reusable connection strategy appropriate for Next.js development and production.

Create proper models/schemas for the application's domain.

At minimum evaluate:

```text id="k0gqk8"
User
Role
Permission

StudentProfile
ChildProfile

TutorProfile
TutorApplication
VerificationRecord
VerificationDocument

Province
Grade
Subject
Course
CourseCode

Availability
Booking
Payment
Commission
Payout

Conversation
Message

TutorRequest
TutorMatch

Favourite
Review

Notification
Dispute
AuditLog
```

Do not blindly follow this list if normalization/embedding/reference decisions suggest a better MongoDB design.

Choose relationships carefully.

Use indexes for high-value search fields.

---

# 8. DATA OWNERSHIP & SECURITY

Every private resource must have explicit ownership rules.

Examples:

A parent can access:

* their own profile
* their own children
* their own bookings
* their own messages
* their own payments
* their own favourites
* their own tutor requests

A tutor can access:

* their own profile
* their own availability
* their own bookings
* their own students where permitted
* their own earnings
* their own payouts
* their own verification status

An admin can access only what their role permits.

Never trust client-provided:

* user ID
* role
* ownership
* payment state
* booking state
* verification state

Always verify these server-side.

---

# 9. AUTHENTICATION

Implement a proper authentication architecture.

Support:

* email/password
* email verification
* Google sign-in
* Apple sign-in where practical
* forgot password
* reset password
* secure sessions
* logout

Passwords must be securely hashed.

Never store plaintext passwords.

Protect authenticated routes.

Use server-side authentication checks.

---

# 10. RBAC

Implement role-based access control.

Roles:

* Parent
* Student
* Tutor
* Administrator

Keep authorization centralized.

Example:

```text id="d2z9ub"
requireAuth()
requireRole("TUTOR")
requirePermission("BOOKING_VIEW")
```

Do not rely only on frontend route guards.

The API/server must enforce permissions.

Design the permission system so additional roles/permissions can be added later.

---

# 11. REQUIREMENT DOCUMENT — COMPLETE IMPLEMENTATION

Implement every requirement from the APlus Learn requirement document.

The following sections must all be represented in the actual application:

1. Product overview
2. Homepage
3. Account types
4. Parent/student registration
5. Child/student profiles
6. Canadian curriculum
7. Tutor search
8. Search filters
9. Tutor result cards
10. Tutor public profile
11. Tutor verification
12. Become a Tutor
13. Tutor onboarding
14. Availability calendar
15. Booking
16. Payments and payouts
17. Messaging
18. Post a Tutor Request
19. Tutor Matching
20. Favourites
21. Reviews
22. Parent/student dashboard
23. Tutor dashboard
24. Lesson confirmation/notifications
25. Online lessons
26. In-person lessons
27. Cancellation/refunds/no-shows
28. Admin dashboard
29. Location/distance search
30. Security/privacy
31. Responsive design/future apps
32. SEO/public landing pages
33. Support/legal pages
34. MVP features
35. Phase Two architecture
36. Phase Three architecture
37. Parent journey
38. Tutor journey
39. Product differentiators
40. Development priorities
41. Final product objective

Do NOT omit any section.

---

# 12. HOMEPAGE

Build a premium marketplace homepage.

Hero search must support:

* Province
* Grade
* Subject/course
* Course code
* Online/in-person
* Location/postal code

Users must be able to search without creating an account.

Homepage sections:

* Hero
* How APlus Learn Works
* Popular Subjects
* Popular Ontario Courses
* Find Tutors by Grade
* Why Choose APlus Learn
* Tutor Verification
* Online vs In-Person
* Testimonials
* Become a Tutor
* FAQ
* Footer

Primary CTAs:

**Find a Tutor**

**Become a Tutor**

---

# 13. CURRICULUM

Implement:

```text id="j2a5m0"
Province
→ Grade
→ Subject
→ Course
→ Course Code
```

Example:

```text id="m7j0w8"
Ontario
→ Grade 12
→ Mathematics
→ Advanced Functions
→ MHF4U
```

Search by both:

* course name
* course code

must return relevant tutors.

Architecture must support additional provinces later.

---

# 14. TUTOR MARKETPLACE

Build a serious marketplace experience.

Tutor search must support:

* province
* grade
* subject
* course
* course code
* location
* online
* in-person
* price
* availability
* qualification
* verification
* rating
* experience

Filters:

* distance
* price range
* qualifications
* verification
* availability
* rating
* experience

Search result cards:

* profile photo
* first name + last initial
* rating
* review count
* verification badges
* courses
* experience
* approximate distance
* lesson type
* hourly rate
* next available time

Actions:

* View Profile
* View Availability
* Message
* Book
* Save

---

# 15. TUTOR PROFILE

The profile should prioritize:

**Trust → Expertise → Social Proof → Availability → Booking**

Include:

* profile image
* name
* rating
* reviews
* completed lessons
* hourly rate
* approximate location
* lesson mode
* response time
* verification
* biography
* education
* experience
* courses
* availability
* reviews

Actions:

* Book
* Message
* Save

Never expose exact residential addresses.

---

# 16. TUTOR VERIFICATION

Support:

* Identity Verified
* OCT Verified
* Education Verified
* University Student Verified
* Background Check Verified

Admin must be able to:

* review documents
* approve
* reject
* request more information
* assign badge
* remove badge

Tutor profile must not become searchable before approval.

---

# 17. TUTOR ONBOARDING

Create a polished multi-step onboarding experience.

Steps:

1. Personal information
2. Profile
3. Education
4. Qualifications
5. Courses taught
6. Lesson type
7. Location/service area
8. Pricing
9. Availability
10. Verification documents
11. Application review
12. Submit

Provide:

* progress indicator
* save progress
* validation
* error handling
* review summary
* submission confirmation

---

# 18. AVAILABILITY

Support:

* recurring weekly availability
* specific date blocking
* vacation
* unavailable periods
* future editing
* double-booking prevention

Design calendar interactions carefully.

Prepare for future Google Calendar / Outlook integration.

---

# 19. BOOKING

Booking must work from tutor profiles.

Flow:

```text id="jv31gc"
Select Child
→ Select Course
→ Select Lesson Type
→ Select Date
→ Select Time
→ Select Duration
→ Review Price
→ Payment
→ Confirmation
```

Support:

* one-time booking
* recurring booking

Display:

* tutor
* course
* date
* time
* duration
* lesson type
* location/meeting details
* price
* cancellation policy
* payment summary

---

# 20. PAYMENT & PAYOUT ARCHITECTURE

Prepare for Stripe Connect or equivalent marketplace payment provider.

Support:

* student payment
* platform commission
* tutor amount
* payment status
* refunds
* tutor payout onboarding
* earnings
* payout status
* receipts
* transaction history

Commission percentage must be configurable by admin.

Payment calculations must be centralized server-side.

Never trust client-calculated totals.

---

# 21. MESSAGING

Implement:

Parent/Student ↔ Tutor messaging.

Support:

* conversations
* timestamps
* booking context
* unread state
* notifications
* report
* block

Prepare the architecture for:

* attachments
* real-time messaging

later.

---

# 22. TUTOR REQUEST & MATCHING

Support tutor requests containing:

* course
* location
* online/in-person
* preferred schedule
* budget
* goal
* start date
* notes

Tutors can indicate interest.

Users can compare interested tutors.

MVP matching:

* course
* location
* budget
* availability

Future matching should be able to incorporate:

* teaching style
* goals
* ratings
* response rate
* repeat booking rate
* availability

Keep matching logic inside a dedicated service.

---

# 23. REVIEWS

Support:

* 1–5 stars
* written review
* knowledge
* communication
* reliability
* teaching ability

Only completed bookings may create verified reviews.

Admin moderation/reporting must exist.

---

# 24. DASHBOARDS

## Parent/Student

Include:

* overview
* upcoming lessons
* past lessons
* my tutors
* saved tutors
* messages
* tutor requests
* payments
* children
* settings
* notifications

## Tutor

Include:

* overview
* next lesson
* calendar
* bookings
* students
* messages
* earnings
* payouts
* reviews
* tutor requests
* profile
* verification
* settings

## Admin

Include:

* user management
* tutor applications
* verification
* curriculum
* bookings
* payments
* commissions
* payouts
* disputes
* reviews
* analytics
* settings

---

# 25. ADMIN ANALYTICS

Provide useful marketplace metrics:

* registered tutors
* approved tutors
* active students
* bookings
* gross tutoring sales
* platform revenue
* average booking value
* popular subjects
* popular courses
* active cities
* online vs in-person
* new registrations

Design analytics for actual decision-making rather than decorative charts.

---

# 26. CANCELLATION / REFUND / NO-SHOW

Implement:

* student cancellation
* tutor cancellation
* configurable cancellation window
* full refund
* partial refund
* no-show
* dispute
* admin review
* repeated abuse tracking
* warnings
* suspension/removal

Centralize these rules.

Do not implement them separately in different UI components.

---

# 27. ONLINE / IN-PERSON

Online lesson support:

* Zoom
* Google Meet
* Microsoft Teams

Store meeting information against booking.

In-person support:

* student home
* tutor location
* library
* public location
* other agreed location

Exact private addresses must remain protected.

---

# 28. NOTIFICATIONS

Implement in-site notifications for:

* booking
* booking changes
* cancellations
* refunds
* tutor application
* verification
* messages
* tutor requests
* reminders
* payouts

Support:

* unread count
* notification center
* read/unread
* preferences

Architecture should allow future:

* email
* SMS
* push notifications

---

# 29. SEO

Public pages must be SEO-ready.

Support URLs such as:

```text id="0g0a6c"
/ontario/grade-12/math/mhf4u
/tutors/mhf4u/scarborough
```

Tutor profiles must have shareable URLs.

Implement:

* metadata
* page titles
* descriptions
* canonical URLs
* semantic markup
* indexable public pages

---

# 30. DESIGN SYSTEM

Create a reusable design system using Tailwind.

Visual direction:

### Colors

Use a trustworthy modern palette.

Suggested starting point:

```text id="6z0jmt"
Primary: #2563EB
Dark: #0F172A
Background: #F8FAFC
Surface: #FFFFFF
Text: #334155
Muted: #64748B
Success: #16A34A
Warning: #F59E0B
```

These are starting values, not a restriction.

Create consistent:

* typography
* spacing
* buttons
* forms
* cards
* badges
* avatars
* dropdowns
* modals
* tabs
* alerts
* tooltips
* tables
* pagination
* skeletons

Do not use random styling from page to page.

---

# 31. PREMIUM ANIMATION

Animation is an important part of the visual quality.

Use subtle, high-quality animation for:

* hero entrance
* search interactions
* card hover
* page transitions
* modal transitions
* filter transitions
* tabs
* calendar interactions
* booking progress
* success states
* notifications
* dashboard statistics
* loading states

Animation must feel:

**premium, smooth, fast and purposeful.**

Do not over-animate.

Avoid:

* childish effects
* excessive bouncing
* unnecessary parallax
* distracting motion

Support `prefers-reduced-motion`.

---

# 32. LOADING / ERROR / EMPTY STATES

Every major feature needs:

* loading state
* skeleton state
* empty state
* error state
* success state
* retry state

Never leave blank screens.

Examples:

* No tutors found
* No availability
* No bookings
* No saved tutors
* No messages
* No notifications
* No requests
* No reviews

Design each state intentionally.

---

# 33. RESPONSIVE DESIGN

The application must be fully responsive:

* mobile
* tablet
* desktop

Do not merely scale desktop layouts down.

Design proper mobile UX for:

* homepage
* search
* filters
* tutor profile
* booking
* calendar
* messaging
* dashboards
* admin
* forms

No horizontal overflow.

---

# 34. ACCESSIBILITY

Follow good accessibility practices:

* semantic HTML
* keyboard navigation
* visible focus
* labels
* accessible forms
* validation messages
* proper contrast
* accessible dialogs
* accessible dropdowns
* accessible calendar
* reduced motion

---

# 35. SECURITY

Implement secure foundations.

Requirements include:

* HTTPS-ready architecture
* secure password hashing
* secure authentication
* RBAC
* API authorization
* secure verification documents
* protected payment information
* minor privacy controls
* admin security
* audit logging
* data retention/deletion architecture

Never expose sensitive information to public pages.

Never trust client-side authorization.

---

# 36. API SECURITY

Every protected API endpoint must validate:

1. Authentication
2. Role
3. Permission
4. Resource ownership
5. Request body
6. Query parameters
7. Business rules

Return appropriate HTTP status codes.

Do not leak sensitive database errors.

---

# 37. VALIDATION

Validate all important input on the server.

Especially:

* registration
* tutor onboarding
* curriculum
* booking
* availability
* payment
* messaging
* reviews
* tutor requests
* admin actions

Client validation is for UX.

Server validation is mandatory for security.

---

# 38. MOCK / EXTERNAL SERVICE STRATEGY

The application must be fully functional during development even if some external services are unavailable.

Create service abstractions for:

* payment
* email
* authentication providers
* geocoding
* calendar
* video meetings

Example:

```text id="0c1e2v"
PaymentService
  ├── createCheckout()
  ├── calculateCommission()
  ├── processRefund()
  └── getPaymentStatus()
```

Initially these may use development/mock implementations where real credentials are unavailable.

The UI should not need to change when the real provider is connected.

---

# 39. NO FAKE BUTTONS

Do not create buttons that only show:

```text
Coming soon
```

unless the requirement is explicitly future-phase functionality.

For MVP requirements, interactions must actually work through:

* state
* API
* service
* database/mock persistence

Do not create visually complete but functionally empty screens.

---

# 40. REALISTIC DEVELOPMENT DATA

Seed development data for:

### Ontario

Examples:

* Toronto
* Scarborough
* Mississauga
* Brampton
* Ottawa
* Hamilton

Courses such as:

* MHF4U
* ENG4U
* MCV4U
* SBI4U
* SCH4U

Create realistic:

* tutors
* qualifications
* ratings
* reviews
* availability
* bookings
* students
* course relationships

Do not use meaningless placeholder data.

---

# 41. PHASE 2 / PHASE 3

Do not unnecessarily implement all future features now.

However, architecture must allow:

### Phase 2

* advanced tutor requests
* advanced matching
* Google Calendar
* Outlook Calendar
* SMS
* referrals
* tutor packages
* group tutoring
* progress reports
* promoted profiles
* advanced analytics
* fraud/risk tools

### Phase 3

* iOS
* Android
* native video classroom
* interactive whiteboard
* homework/document sharing
* AI recommendations
* AI search
* AI lesson summaries
* student analytics
* tutor subscriptions
* group courses
* exam preparation marketplace
* additional provinces
* university tutoring

---

# 42. CORE BUSINESS RULES

Centralize these rules:

* unapproved tutors cannot appear in search
* users cannot access another user's private data
* exact tutor addresses are never public
* only completed bookings can create verified reviews
* tutor availability cannot double-book
* booking totals are calculated server-side
* commission is calculated server-side
* payout eligibility follows booking/payment state
* cancellation/refund follows centralized rules
* verification status is controlled server-side
* admin permissions are enforced server-side

---

# 43. PERFORMANCE

Build with performance in mind.

Use appropriate:

* Server Components
* Client Components only where interaction requires them
* dynamic loading where useful
* optimized images
* pagination
* database indexes
* efficient MongoDB queries
* caching where appropriate

Do not make the entire application client-rendered unnecessarily.

Public SEO pages should benefit from Next.js server rendering capabilities.

---

# 44. CODE QUALITY

Write code that another developer can understand.

Prefer:

* small focused functions
* reusable components
* clear naming
* centralized constants
* centralized business rules
* reusable validation
* reusable API response handling
* clear service boundaries

Avoid:

* giant components
* duplicated logic
* deeply nested conditionals
* hard-coded business rules everywhere
* unnecessary abstraction
* unnecessary dependencies

---

# 45. REQUIREMENT COVERAGE MATRIX

Before completion, create a complete requirement matrix.

For every requirement:

```text id="a4prn1"
Requirement
→ Route/Page
→ Component
→ API
→ Service
→ Database Model
→ Role
→ Status
```

Status:

* Implemented
* Partially Implemented
* Blocked by External Integration
* Intentionally Deferred (Phase 2/3)

There must be **no silently skipped requirement**.

---

# 46. END-TO-END QA

Test the complete Parent journey:

```text id="x8xgqb"
Homepage
→ Search
→ Filter
→ Tutor Profile
→ Availability
→ Login/Register
→ Select Child
→ Booking
→ Payment
→ Confirmation
→ Messaging
→ Lesson
→ Review
→ Rebook
```

Test Tutor journey:

```text id="8m7k0z"
Become Tutor
→ Register
→ Onboarding
→ Courses
→ Pricing
→ Availability
→ Documents
→ Submit
→ Admin Review
→ Approval
→ Searchable Profile
→ Booking
→ Lesson
→ Earnings
→ Review
```

Test Admin journey:

```text id="7v5c8a"
Admin Login
→ Applications
→ Documents
→ Approve/Reject/Request Info
→ Verification
→ Users
→ Curriculum
→ Bookings
→ Payments
→ Refunds
→ Disputes
→ Reviews
→ Analytics
```

Also test unauthorized access.

---

# 47. QUALITY GATES

Before declaring completion, run:

* lint
* build
* application startup
* API validation
* database connectivity
* route checks
* authorization checks
* responsive checks
* accessibility checks
* major user-flow checks

Fix issues found.

Do not simply report known broken functionality.

---

# 48. IMPLEMENTATION WORKFLOW

Follow these phases.

## Phase 1 — Understand

Read the complete requirements document.

Read all project instructions.

Understand the entire product before implementation.

---

## Phase 2 — Architecture

Design:

* folder structure
* routes
* API structure
* MongoDB models
* authentication architecture
* RBAC
* service layer
* validation
* error handling
* design system

---

## Phase 3 — Foundation

Implement:

* Next.js foundation
* Tailwind
* MongoDB connection
* models
* authentication foundation
* RBAC
* reusable UI
* layout
* navigation
* API conventions
* error handling
* validation

---

## Phase 4 — Public Marketplace

Implement:

* homepage
* curriculum
* tutor search
* filters
* tutor cards
* tutor profiles
* public SEO pages
* become tutor

---

## Phase 5 — Tutor System

Implement:

* registration
* onboarding
* profile
* courses
* qualifications
* verification
* availability
* tutor dashboard

---

## Phase 6 — Booking & Commerce

Implement:

* booking
* availability validation
* payment abstraction
* commission
* payouts
* cancellations
* refunds
* receipts

---

## Phase 7 — Communication

Implement:

* messaging
* notifications
* tutor requests
* matching
* favourites
* reviews

---

## Phase 8 — Parent/Student

Implement:

* dashboard
* children
* tutors
* bookings
* payments
* requests
* messages
* reviews
* settings

---

## Phase 9 — Admin

Implement:

* user management
* tutor applications
* verification
* curriculum
* bookings
* payments
* refunds
* disputes
* reviews
* analytics
* settings

---

## Phase 10 — Polish

Improve:

* responsive UX
* accessibility
* loading states
* empty states
* error states
* animation
* micro-interactions
* SEO
* performance
* visual consistency

---

## Phase 11 — Final Audit

Re-read the entire requirement document.

Check every requirement individually.

Do not rely on memory.

If anything is missing, implement it.

Only then consider the application complete.

---

# 49. FINAL PRODUCT STANDARD

The final application should feel like a combination of:

* modern marketplace UX
* premium SaaS dashboard
* trusted education platform
* professional booking platform

The public website should be conversion-focused.

The search experience should be fast and intuitive.

Tutor profiles should build trust.

Booking should be frictionless.

Dashboards should be operationally useful.

Admin should have complete marketplace control.

The entire product should feel like a **real startup product ready for production**, not a frontend demo.

---

# FINAL INSTRUCTION

Build APlus Learn as a **complete greenfield full-stack Next.js application**.

There is:

**ONE repository.
ONE Next.js application.
ONE MongoDB database.
NO separate backend.**

Next.js must handle both the frontend and backend/API layer.

Use:

**Next.js + JavaScript + Tailwind + MongoDB**

with a clean architecture:

**UI → API → Service → Database**

Keep business logic server-side.

Keep authorization server-side.

Keep sensitive operations server-side.

Keep the UI reusable and independent from database implementation.

Use the Tuturn reference as inspiration for marketplace UX, but make APlus Learn visually distinct.

The final design must be:

**Modern + Trustworthy + Friendly + Premium**

with subtle, sophisticated animations and excellent responsive behavior.

Most importantly:

**Every requirement in the APlus Learn requirement document must be accounted for.**

Do not silently skip features.

Do not create fake functionality.

Do not use TypeScript.

Do not create a separate backend.

Do not sacrifice architecture for visual polish.

Do not sacrifice UX for technical convenience.

Build the application as a coherent production-ready product from the ground up.
