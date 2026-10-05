APlus Learn
**Detailed Website Features & Functional Requirements**
*Developer Brief – MVP and Future-Ready Architecture*
1\. Project Overview
APlus Learn is a Canada-focused tutoring marketplace that connects parents and students with qualified tutors for online and in-person tutoring. The initial launch will focus primarily on Ontario K–12 education, with the platform structured around province, grade, subject, course and course code.
Core user journey: Search → Compare → Match → Message → Book → Pay → Attend Lesson → Review → Rebook.
Primary user types:
Parent/Student
Tutor
Administrator
2\. Homepage
The homepage should clearly explain the service and allow visitors to begin searching without creating an account.
Hero Search
Province
Grade
Subject or course
Course code
Online or in-person
Location or postal code for in-person tutoring
Search button
Example: Ontario | Grade 12 | MHF4U – Advanced Functions | In Person | Scarborough
Homepage Sections
How APlus Learn Works
Popular Subjects
Popular Ontario Courses
Find Tutors by Grade
Why Choose APlus Learn
Tutor Verification
Online vs. In-Person Tutoring
Testimonials
Become a Tutor
FAQ
Footer with legal and support links
Primary calls to action: Find a Tutor and Become a Tutor.
3\. Account Types
Parent Account
Parents should be able to manage one or more children under one account. Each child can have separate courses, tutors, bookings, lesson history and progress information.
Student Account
Older students should be able to manage their own account. The system should distinguish minors from adult users where required for privacy, communication and payment.
Tutor Account
Tutors require a separate onboarding process and dashboard.
Administrator Account
Administrators require full marketplace management permissions, with access controlled by role.
4\. Parent/Student Registration
Email/password registration
Google sign-in
Apple sign-in if practical
First name and last name
Email
Phone number
Parent or Student account type
Province
City
Postal code
Email verification
Optional phone verification
5\. Child / Student Profiles
Parents should be able to create individual child profiles.
First name
Grade
Province
Subjects/courses requiring tutoring
Online/in-person preference
General learning goals
Optional current mark
Optional target mark
Optional areas needing improvement
Optional learning preferences
Sensitive educational information must not be publicly visible by default.
6\. Canadian Curriculum Database
This is one of the core product differentiators. The data structure should be:
Province → Grade → Subject → Course → Course Code
Example: Ontario → Grade 12 → Mathematics → Advanced Functions → MHF4U
Users must be able to search by either course name or course code and receive the same relevant results.
The architecture must support additional provinces later without rebuilding the platform.
7\. Tutor Search
Search is a mission-critical feature. Users should be able to search by:
Province
Grade
Subject
Course
Course code
Location
Online / in-person / both
Price
Availability
Tutor qualification
Verification status
Rating
8\. Search Filters
Location
Online
In person
Both
Distance radius such as 5 km, 10 km, 25 km, 50 km
Price
Minimum and maximum hourly rate, e.g. $25–$50/hour.
Qualifications
OCT Certified Teacher
University/College Student
Bachelor’s Degree
Master’s Degree
PhD
Professional/Industry Expert
Verification
Identity Verified
Education Verified
OCT Verified
Background/Vulnerable Sector Check Verified
Availability
Today
Tomorrow
This Week
Weekend
Specific date/time
Other
Rating threshold
Years of experience
9\. Tutor Search Result Cards
Each tutor card should provide enough information for quick comparison.
Profile photo
First name + last initial
Star rating and review count
Verification badge(s)
Top courses/subjects
Years of experience
Approximate distance
Online / in-person status
Hourly rate
Next available time
View Profile button
View Availability button
Optional Message and Book buttons
10\. Tutor Public Profile
Professional profile photo
First name + last initial
Rating and review count
Number of completed lessons
Hourly rate
Approximate location
Online/in-person status
Response time
Verification badges
Tutor introduction/bio
Education
Teaching/tutoring experience
Specific courses taught
Availability calendar
Reviews
Book button
Message button
Save/Favourite button
Exact residential addresses must not appear publicly.
11\. Tutor Verification
Verification should be a central trust feature.
Identity Verified – government-issued identification reviewed
OCT Verified – Ontario College of Teachers status reviewed
Education Verified – degree/diploma documentation reviewed
University Student Verified – current enrolment reviewed
Background Check Verified – recent police/Vulnerable Sector Check reviewed where applicable
The site should clearly define what each badge means and avoid implying that verification guarantees tutor performance or safety.
12\. Become a Tutor Page
How the platform works
Benefits of joining
Platform commission/fees
Tutor requirements
Verification process
How tutors get paid
Tutor FAQs
Create Your Tutor Profile call-to-action
13\. Tutor Application / Onboarding
Personal information: name, email, phone, city, province.
Profile: photo, biography, languages spoken, years of experience.
Education: institution, degree/program, field, graduation year.
Teaching qualifications: OCT or other credentials.
Subjects/courses: province → grade → subject → course.
Lesson type: online, in person or both.
Location: city, general area and travel radius.
Pricing: hourly rate.
Availability: recurring weekly schedule.
Verification documents: secure upload.
Submit application for administrator review.
Tutor profiles should not become searchable until approved by an administrator.
14\. Tutor Availability Calendar
Recurring weekly availability
Specific date blocking
Vacation/unavailable periods
Prevent double-booking
Edit future availability
Support future Google Calendar / Outlook integrations
15\. Booking System
Students/parents should be able to book directly from the tutor profile.
Select course
Select online or in-person
Choose date
Choose available time
Choose duration
Display full lesson price
Continue to secure payment
Receive confirmation
The booking process should support both one-time and recurring lessons.
16\. Payments and Tutor Payouts
Payments should be processed through a marketplace-capable provider such as Stripe Connect or an equivalent.
Student pays through APlus Learn
Platform commission deducted automatically
Tutor portion tracked automatically
Commission percentage configurable by administrators
Payment status visible to both relevant users and admin
Refund support
Tutor payout onboarding
Tutor earnings dashboard
Example: $50 lesson → 15% platform fee = $7.50 → $42.50 tutor portion, before any applicable processing/tax treatment.
17\. Messaging
Private parent/student ↔ tutor conversations
Time and date stamps
Booking-related messages
Website notifications
Optional future file attachments
Report/block functionality
Reasonable anti-circumvention protections against immediately moving payment off-platform
18\. Post a Tutor Request
Users should be able to post their tutoring need instead of searching manually.
Course
Location
Online/in-person
Preferred schedule
Budget
Goal
Desired start date
Optional notes
Matching tutors should be able to indicate interest. The parent/student can compare interested tutors and choose one.
Requests should expire automatically or be closable by the user.
19\. Tutor Matching
The MVP can use rules-based matching based on course, location, budget and availability.
Future matching can incorporate teaching style, student goals, ratings, repeat booking rate, response rate and availability.
20\. Favourites / Saved Tutors
Users should be able to save tutors to a personal list and return later to compare or book them.
21\. Reviews and Ratings
1–5 star rating
Optional written review
Possible categories: knowledge, communication, reliability and teaching ability
Only users with completed APlus Learn bookings can leave verified lesson reviews
Admin moderation and reporting workflow
22\. Parent / Student Dashboard
Upcoming lessons
Past lessons
My Tutors
Saved Tutors
Messages
Tutor Requests
Payments/receipts
Children/student profiles
Profile and account settings
23\. Tutor Dashboard
Dashboard overview
Next lesson
Calendar
Bookings / booking requests
Students
Messages
Earnings and payouts
Reviews
Tutor request opportunities
Profile editing
Verification status
24\. Lesson Confirmation and Notifications
After a booking is paid, both parties should receive clear confirmation.
Tutor
Course
Date
Time
Format
Location or online details
Amount paid
Cancellation policy
MVP notifications: email + in-site notifications. Future: SMS and mobile push notifications.
25\. Online Lessons
The MVP does not need a custom video classroom. It can support Zoom, Google Meet or Microsoft Teams links stored against the booking. A native virtual classroom can be a later phase.
26\. In-Person Lessons
Student’s home
Tutor’s location
Library
Public location
Other agreed location
Private addresses should only be shared at an appropriate point after booking, not on public profiles.
27\. Cancellations, Refunds and No-Shows
Configurable cancellation window
Student cancellation workflow
Tutor cancellation workflow
Full/partial refund rules
No-show reporting
Administrator dispute review
Track repeated no-shows/cancellations
Warnings, suspension or removal for repeated abuse
28\. Administrator Dashboard
User Management
View parents, students and tutors
Suspend/ban/restore accounts
View user history as permitted
Tutor Applications and Verification
Review applications
View secure documents
Approve/reject
Request more information
Assign/remove verification badges
Curriculum Management
Add/edit provinces
Grades
Subjects
Courses
Course codes
Bookings and Payments
View upcoming/completed/cancelled bookings
Transactions
Commissions
Tutor earnings
Refunds
Payout status
Disputes and Reviews
Review complaints
No-shows
Refund disputes
Reported reviews
Reported tutor requests
Analytics
Registered and approved tutors
Active students
Bookings
Gross tutoring sales
Platform revenue
Average booking value
Most searched subjects/courses
Most active cities
Online vs. in-person bookings
New registrations
29\. Location and Distance Search
In-person search should support postal code/city and approximate distance calculations using a mapping/geocoding service.
The platform should never expose exact tutor residential addresses in search results.
30\. Security and Privacy
HTTPS
Secure password hashing
Role-based access controls
Secure authentication
Secure verification document storage
Payment details handled by payment provider
Privacy controls for minors
Secure administrator dashboard
Audit logging for important administrative actions
Defined data retention/deletion processes
Canadian privacy and legal requirements should be reviewed before launch.
31\. Mobile Responsiveness and Future Apps
The website must be fully responsive on desktop, tablet and smartphone. The backend should be designed so future iOS and Android apps can use the same accounts, tutor profiles, search, curriculum data, messaging, booking, payments and reviews.
32\. SEO and Public Landing Pages
Public tutor and course pages should be indexable and optimized for high-intent searches.
MHF4U tutor Toronto
Grade 12 math tutor Scarborough
ENG4U tutor Toronto
Ontario math tutor
Calculus tutor near me
Example URL structures: /ontario/grade-12/math/mhf4u and /tutors/mhf4u/scarborough.
Each tutor should also have a shareable public profile URL.
33\. Customer Support and Legal Pages
Help Centre
Contact Support
About Us
How It Works
Find a Tutor
Become a Tutor
Pricing/Fees
Tutor Verification
Safety
FAQ
Terms of Service
Privacy Policy
Cookie Policy
Cancellation/Refund Policy
Community Standards
Tutor Agreement
34\. MVP – Required for Initial Launch
Parent/student registration
Tutor registration and application
Administrator access
Tutor profiles
Tutor approval and verification badges
Ontario curriculum/course-code database
Tutor search and filters
Location + online/in-person filtering
Availability calendar
Booking system
Secure payments
Tutor payouts
Messaging
Cancellations/refunds
Reviews
Parent/student dashboard
Tutor dashboard
Administrator dashboard
Secure verification document uploads
Basic reporting/dispute management
Responsive mobile design
SEO-friendly public pages
35\. Phase Two – Add After MVP
Advanced Post a Tutor Request workflow
Advanced tutor matching
Google/Outlook calendar synchronization
SMS notifications
Referral program
Tutor packages
Group tutoring
Progress reports
Promoted tutor profiles
Advanced analytics
Fraud/risk tools
36\. Phase Three – Long-Term Features
iOS app
Android app
Integrated video classroom
Interactive whiteboard
Homework/document sharing
AI tutor recommendations
AI search
AI lesson summaries
Student learning analytics
Tutor subscriptions
Group courses
Exam-preparation marketplace
Other Canadian provinces
University tutoring
37\. Core Parent Journey
Visit APlus Learn.
Select province.
Select grade.
Select course/course code.
Choose online or in person.
Enter location if relevant.
See matching tutors.
Filter by price, qualification, rating and availability.
Open tutor profile.
Review credentials, reviews and availability.
Select a lesson time.
Create or log into account.
Pay securely.
Receive booking confirmation.
Communicate with tutor.
Attend lesson.
Leave review.
Rebook easily.
38\. Core Tutor Journey
Visit APlus Learn and click Become a Tutor.
Create an account.
Complete profile.
Select courses taught.
Set price.
Set online/in-person options and service area.
Set availability.
Upload verification documents.
Submit application.
Administrator reviews application.
Profile becomes searchable after approval.
Receive booking.
Teach lesson.
Lesson becomes eligible for payout.
Receive review.
Build reputation and repeat bookings.
39\. Product Differentiators
Canadian curriculum and course-code search
Strong local + online tutoring support
Education-specific tutor verification
No subscription required simply to search
Parent-focused experience
Integrated availability, booking and payment
Tutor request feature
Long-term family tutoring management rather than a simple directory
40\. Development Priority
Search and matching
Tutor profiles
Curriculum/course-code structure
Availability and booking
Payments/payouts
Tutor onboarding and verification
Parent/student and tutor dashboards
Messaging
Reviews
Administrator management
41\. Final Development Objective
A parent should be able to arrive knowing only that their child needs help with a specific subject or course, find tutors who specifically teach it, compare qualifications, pricing, reviews and availability, determine whether they teach online or nearby, book and pay securely, communicate with the tutor, attend the lesson, review the experience and rebook — all within APlus Learn.
At the same time, a tutor should be able to join, create a professional profile, select exactly what they teach, set pricing and availability, receive bookings and get paid without needing to operate their own website, booking system or payment infrastructure.
The website should feel like a modern service marketplace, not a classified-ad directory.