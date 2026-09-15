/**
 * Realistic development people (§40).
 *
 * Names, biographies, qualifications and rates reflect the mix you would
 * actually find across the GTA and Ottawa — certified OCT teachers, graduate
 * students and subject specialists at different price points.
 */

export const TUTORS = [
  {
    firstName: "Priya", lastName: "Sharma", email: "priya.sharma@example.com",
    city: "Toronto", postalCode: "M5V 2K3", rate: 7500, years: 11,
    headline: "OCT-certified math teacher — Advanced Functions & Calculus specialist",
    bio: "I have taught senior mathematics in the Toronto District School Board for eleven years and have marked provincial assessments for six. Most of my students come to me part-way through MHF4U or MCV4U, worried about a mark that has slipped below what their university offer requires.\n\nMy approach is diagnostic: in the first session we work through a past unit test together so I can see exactly where the reasoning breaks down. It is almost never the new material — it is usually factoring, function notation, or a shaky grasp of transformations from Grade 11. We fix the foundation, then the new work stops feeling impossible.\n\nI provide a written summary after every lesson so parents can see what we covered and what to practise before next time.",
    qualifications: ["CERTIFIED_TEACHER", "OCT_MEMBER", "GRADUATE", "SUBJECT_SPECIALIST"],
    oct: "482915",
    education: [
      { institution: "University of Toronto", credential: "Bachelor of Education", fieldOfStudy: "Intermediate/Senior Mathematics", startYear: 2011, endYear: 2013 },
      { institution: "University of Waterloo", credential: "BMath", fieldOfStudy: "Pure Mathematics", startYear: 2007, endYear: 2011 },
    ],
    experience: [
      { title: "Secondary Mathematics Teacher", organisation: "Toronto District School Board", startYear: 2013, current: true, description: "Teaching MHF4U, MCV4U and MDM4U; department lead for numeracy since 2019." },
      { title: "Provincial Assessment Marker", organisation: "EQAO", startYear: 2018, endYear: 2024, description: "Marked Grade 9 mathematics assessments each summer." },
    ],
    courses: ["MHF4U", "MCV4U", "MDM4U", "MCR3U", "MPM2D"],
    modes: ["ONLINE", "IN_PERSON"], radius: 20,
    badges: ["IDENTITY", "OCT", "EDUCATION", "BACKGROUND_CHECK"],
    languages: ["English", "Hindi", "Punjabi"],
    availability: [
      { weekday: 1, start: "16:00", end: "21:00" }, { weekday: 2, start: "16:00", end: "21:00" },
      { weekday: 3, start: "16:00", end: "21:00" }, { weekday: 4, start: "16:00", end: "20:00" },
      { weekday: 6, start: "09:00", end: "15:00" }, { weekday: 0, start: "10:00", end: "16:00" },
    ],
    freeIntro: true,
  },
  {
    firstName: "Daniel", lastName: "Okonkwo", email: "daniel.okonkwo@example.com",
    city: "Scarborough", postalCode: "M1B 2K9", rate: 5500, years: 6,
    headline: "Physics & Chemistry tutor — PhD candidate who makes the hard parts obvious",
    bio: "I am finishing a PhD in condensed matter physics at the University of Toronto, and I have been tutoring senior science throughout. SPH4U and SCH4U are the two courses where students most often tell me the textbook 'explains it but doesn't make sense', and that gap is exactly what I work on.\n\nI teach physics through problem-solving rather than formula memorisation. We draw the free-body diagram every single time, even when it seems unnecessary, because that habit is what separates a 70 from a 90 on the final. For chemistry, I lean heavily on reaction mechanisms — once you can see where the electrons go, organic chemistry stops being a list to memorise.\n\nI am happy to work around lab reports and test schedules, and I keep a bank of past unit tests from several Ontario boards.",
    qualifications: ["POSTGRADUATE", "UNIVERSITY_STUDENT", "SUBJECT_SPECIALIST"],
    education: [
      { institution: "University of Toronto", credential: "PhD", fieldOfStudy: "Physics", startYear: 2020, inProgress: true },
      { institution: "McMaster University", credential: "BSc (Honours)", fieldOfStudy: "Physics and Mathematics", startYear: 2015, endYear: 2019 },
    ],
    experience: [
      { title: "Teaching Assistant", organisation: "University of Toronto, Department of Physics", startYear: 2020, current: true, description: "Leading first-year mechanics and electromagnetism tutorials for classes of 30." },
      { title: "Private Tutor", organisation: "Self-employed", startYear: 2018, current: true, description: "Over 400 hours of senior physics and chemistry tutoring." },
    ],
    courses: ["SPH4U", "SCH4U", "SPH3U", "SCH3U", "MCV4U"],
    modes: ["ONLINE", "IN_PERSON"], radius: 25,
    badges: ["IDENTITY", "EDUCATION", "UNIVERSITY_STUDENT"],
    languages: ["English", "Igbo"],
    availability: [
      { weekday: 1, start: "17:00", end: "21:00" }, { weekday: 3, start: "17:00", end: "21:00" },
      { weekday: 5, start: "15:00", end: "20:00" }, { weekday: 6, start: "10:00", end: "17:00" },
    ],
  },
  {
    firstName: "Sarah", lastName: "MacLeod", email: "sarah.macleod@example.com",
    city: "Ottawa", postalCode: "K1P 5G4", rate: 6800, years: 9,
    headline: "English & essay writing — from 'I don't know where to start' to a confident thesis",
    bio: "I taught senior English in the Ottawa-Carleton District School Board for nine years before moving to tutoring full-time. My students are usually capable readers who freeze when asked to produce an argument — they can tell you what a text means, but not how to build 1,200 words around it.\n\nWe work on structure first. I use a thesis-first method: before writing a single body paragraph, we get the argument onto one line and stress-test it. Students are often surprised how much faster the essay comes once the claim is genuinely arguable.\n\nI also prepare students for university-level writing, including the transition from the five-paragraph format that ENG4U still rewards to the looser structures first-year courses expect. I return marked work within 48 hours with comments you can actually act on.",
    qualifications: ["CERTIFIED_TEACHER", "OCT_MEMBER", "POSTGRADUATE"],
    oct: "391204",
    education: [
      { institution: "Queen's University", credential: "Bachelor of Education", fieldOfStudy: "Intermediate/Senior English", startYear: 2013, endYear: 2015 },
      { institution: "Carleton University", credential: "MA", fieldOfStudy: "English Literature", startYear: 2011, endYear: 2013 },
      { institution: "University of Ottawa", credential: "BA (Honours)", fieldOfStudy: "English", startYear: 2007, endYear: 2011 },
    ],
    experience: [
      { title: "Secondary English Teacher", organisation: "Ottawa-Carleton District School Board", startYear: 2015, endYear: 2024, description: "ENG4U, ENG3U and The Writer's Craft; led the school's writing centre." },
      { title: "Full-time Tutor", organisation: "Self-employed", startYear: 2024, current: true },
    ],
    courses: ["ENG4U", "ENG3U", "ENG2D", "EWC4U"],
    modes: ["ONLINE"], radius: 0,
    badges: ["IDENTITY", "OCT", "EDUCATION", "BACKGROUND_CHECK"],
    languages: ["English", "French"],
    availability: [
      { weekday: 1, start: "09:00", end: "15:00" }, { weekday: 2, start: "09:00", end: "15:00" },
      { weekday: 3, start: "09:00", end: "15:00" }, { weekday: 4, start: "09:00", end: "15:00" },
      { weekday: 2, start: "18:00", end: "21:00" }, { weekday: 4, start: "18:00", end: "21:00" },
    ],
    freeIntro: true,
  },
  {
    firstName: "Wei", lastName: "Zhang", email: "wei.zhang@example.com",
    city: "Markham", postalCode: "L3R 1A2", rate: 6200, years: 7,
    headline: "Biology & Chemistry — med-school applicant who remembers what SBI4U feels like",
    bio: "I am in my second year of medicine at the University of Toronto, and I tutor the courses that got me there. SBI4U is deceptively hard: the content is not conceptually difficult, but the volume is enormous and the tests reward precision in a way that catches strong students off guard.\n\nI teach with active recall and spaced repetition rather than re-reading notes. We build a question bank as we go, and I check retention from earlier units at the start of each lesson — which students hate for the first two weeks and are grateful for by the final exam.\n\nI also coach students through the biology and chemistry content on university applications and supplementary essays, since I went through that process recently enough to remember exactly how opaque it feels.",
    qualifications: ["UNIVERSITY_STUDENT", "GRADUATE", "SUBJECT_SPECIALIST"],
    education: [
      { institution: "University of Toronto", credential: "Doctor of Medicine (MD)", fieldOfStudy: "Medicine", startYear: 2024, inProgress: true },
      { institution: "University of Toronto", credential: "BSc (Honours)", fieldOfStudy: "Human Biology", startYear: 2019, endYear: 2023 },
    ],
    experience: [
      { title: "Peer Tutor", organisation: "University of Toronto Academic Success Centre", startYear: 2021, endYear: 2024, description: "Supported first- and second-year biology and organic chemistry students." },
      { title: "Private Tutor", organisation: "Self-employed", startYear: 2018, current: true },
    ],
    courses: ["SBI4U", "SCH4U", "SBI3U", "SCH3U", "SNC2D"],
    modes: ["ONLINE", "IN_PERSON"], radius: 15,
    badges: ["IDENTITY", "EDUCATION", "UNIVERSITY_STUDENT", "BACKGROUND_CHECK"],
    languages: ["English", "Mandarin"],
    availability: [
      { weekday: 2, start: "18:00", end: "22:00" }, { weekday: 4, start: "18:00", end: "22:00" },
      { weekday: 6, start: "09:00", end: "16:00" }, { weekday: 0, start: "09:00", end: "16:00" },
    ],
  },
  {
    firstName: "Amara", lastName: "Bello", email: "amara.bello@example.com",
    city: "Brampton", postalCode: "L6Y 1N4", rate: 4800, years: 4,
    headline: "Grade 6–10 math and science — patient, structured, and good with anxious students",
    bio: "I specialise in the middle years, where confidence matters more than content. Most of the students I work with have decided they are 'bad at math', usually after one bad term, and everything after that is uphill.\n\nI start by rebuilding arithmetic and fraction fluency, because almost every Grade 9 struggle traces back to it. We use short, frequent practice rather than long sessions, and I set work that a student can actually finish, which matters enormously for someone who has got used to failing.\n\nI have worked with several students with ADHD and test anxiety, and I am comfortable adapting pacing and session structure. Parents get a short note after each lesson with one specific thing to practise — never a long list.",
    qualifications: ["GRADUATE", "UNIVERSITY_STUDENT"],
    education: [
      { institution: "Toronto Metropolitan University", credential: "BSc", fieldOfStudy: "Mathematics", startYear: 2018, endYear: 2022 },
      { institution: "York University", credential: "Bachelor of Education", fieldOfStudy: "Primary/Junior", startYear: 2023, inProgress: true },
    ],
    experience: [
      { title: "Math Instructor", organisation: "Community learning centre, Brampton", startYear: 2021, current: true, description: "Small-group instruction for Grades 5 to 9." },
    ],
    courses: ["MTH1W", "MPM2D", "MFM2P", "SNC1W", "SNC2D"],
    modes: ["ONLINE", "IN_PERSON"], radius: 18,
    badges: ["IDENTITY", "EDUCATION", "UNIVERSITY_STUDENT"],
    languages: ["English", "Yoruba"],
    availability: [
      { weekday: 1, start: "15:30", end: "20:00" }, { weekday: 2, start: "15:30", end: "20:00" },
      { weekday: 3, start: "15:30", end: "20:00" }, { weekday: 5, start: "15:30", end: "19:00" },
      { weekday: 6, start: "10:00", end: "14:00" },
    ],
    freeIntro: true,
  },
  {
    firstName: "Jean-Luc", lastName: "Tremblay", email: "jeanluc.tremblay@example.com",
    city: "Ottawa", postalCode: "K2P 1L4", rate: 5800, years: 13,
    headline: "French immersion and Core French — conversation-first, grammar when it's needed",
    bio: "I am a native Québécois speaker and have taught French in Ontario schools for thirteen years, most of that in immersion programs. The students who come to me are usually fine on paper and freeze when asked to speak — which is precisely backwards from how the language is actually assessed at the senior level.\n\nSessions are conducted mostly in French from the second lesson onward, pitched at whatever level the student can sustain. We do grammar, but in service of something the student is trying to say, not as an isolated drill.\n\nI prepare students for the DELF examinations and for the oral components of FSF3U and FSF4U, and I work with several families maintaining French at home alongside an English-language school.",
    qualifications: ["CERTIFIED_TEACHER", "OCT_MEMBER", "SUBJECT_SPECIALIST"],
    oct: "276843",
    education: [
      { institution: "Université Laval", credential: "Baccalauréat en enseignement", fieldOfStudy: "Français langue seconde", startYear: 2007, endYear: 2011 },
    ],
    experience: [
      { title: "French Immersion Teacher", organisation: "Conseil des écoles publiques de l'Est de l'Ontario", startYear: 2011, current: true },
      { title: "DELF Examiner", organisation: "Alliance Française", startYear: 2016, current: true },
    ],
    courses: ["FSF4U", "FSF2D"],
    modes: ["ONLINE", "IN_PERSON"], radius: 20,
    badges: ["IDENTITY", "OCT", "EDUCATION"],
    languages: ["French", "English"],
    availability: [
      { weekday: 1, start: "17:00", end: "20:30" }, { weekday: 3, start: "17:00", end: "20:30" },
      { weekday: 6, start: "09:00", end: "13:00" },
    ],
  },
  {
    firstName: "Rahul", lastName: "Patel", email: "rahul.patel@example.com",
    city: "Mississauga", postalCode: "L5B 3C2", rate: 7000, years: 5,
    headline: "Computer Science & senior math — working software engineer, teaches ICS4U properly",
    bio: "I work as a software engineer and tutor ICS3U and ICS4U evenings and weekends. Ontario computer science is taught unevenly between schools, and I see a lot of students who can follow a tutorial but cannot yet debug their own code — which is the actual skill.\n\nWe write real programs. Students finish the ISP with something they are willing to put on a university application, and along the way they learn to read a stack trace, use a debugger, and structure a program so it is possible to reason about.\n\nI also tutor MHF4U and MCV4U, which pairs naturally: most of my CS students are applying to engineering or computer science and need both marks. For students preparing for the Canadian Computing Competition, I have a separate problem set progression.",
    qualifications: ["GRADUATE", "SUBJECT_SPECIALIST"],
    education: [
      { institution: "University of Waterloo", credential: "BASc", fieldOfStudy: "Software Engineering", startYear: 2016, endYear: 2021 },
    ],
    experience: [
      { title: "Senior Software Engineer", organisation: "Financial technology company, Toronto", startYear: 2021, current: true },
      { title: "Instructional Apprentice", organisation: "University of Waterloo", startYear: 2019, endYear: 2021, description: "Ran labs and office hours for first-year programming courses." },
    ],
    courses: ["ICS4U", "ICS3U", "MHF4U", "MCV4U", "MDM4U"],
    modes: ["ONLINE"], radius: 0,
    badges: ["IDENTITY", "EDUCATION"],
    languages: ["English", "Gujarati", "Hindi"],
    availability: [
      { weekday: 2, start: "19:00", end: "22:00" }, { weekday: 4, start: "19:00", end: "22:00" },
      { weekday: 6, start: "10:00", end: "16:00" }, { weekday: 0, start: "13:00", end: "18:00" },
    ],
  },
  {
    firstName: "Fatima", lastName: "Haddad", email: "fatima.haddad@example.com",
    city: "Hamilton", postalCode: "L8P 1A1", rate: 5200, years: 8,
    headline: "Business, accounting and data management — real-world context for every concept",
    bio: "I am a CPA who moved into teaching after eight years in practice. BAF3M and MDM4U are the courses I know best, and they suit each other: both are about turning messy information into something you can make a decision from.\n\nAccounting students usually struggle with debits and credits for about two weeks and then it clicks permanently. I get them there faster by starting with the actual business event rather than the journal entry — what happened, who owes whom, and only then how it is recorded.\n\nFor MDM4U, the culminating investigation is where most marks are won or lost. I help students choose a question that is genuinely answerable with the data they can get, which is most of the battle.",
    qualifications: ["GRADUATE", "SUBJECT_SPECIALIST", "POSTGRADUATE"],
    education: [
      { institution: "Chartered Professional Accountants of Ontario", credential: "CPA, CA", fieldOfStudy: "Accounting", startYear: 2014, endYear: 2017 },
      { institution: "McMaster University", credential: "BCom", fieldOfStudy: "Accounting and Finance", startYear: 2010, endYear: 2014 },
    ],
    experience: [
      { title: "Senior Accountant", organisation: "Mid-size accounting firm, Hamilton", startYear: 2017, endYear: 2022 },
      { title: "Business Studies Tutor", organisation: "Self-employed", startYear: 2022, current: true },
    ],
    courses: ["BAF3M", "BBB4M", "MDM4U", "MAP4C"],
    modes: ["ONLINE", "IN_PERSON"], radius: 22,
    badges: ["IDENTITY", "EDUCATION", "BACKGROUND_CHECK"],
    languages: ["English", "Arabic"],
    availability: [
      { weekday: 1, start: "18:00", end: "21:00" }, { weekday: 3, start: "18:00", end: "21:00" },
      { weekday: 5, start: "16:00", end: "20:00" }, { weekday: 6, start: "11:00", end: "16:00" },
    ],
  },
  {
    firstName: "Grace", lastName: "Nakamura", email: "grace.nakamura@example.com",
    city: "North York", postalCode: "M2N 5W9", rate: 8500, years: 15,
    headline: "Department head, 15 years — senior math for students aiming at the top programs",
    bio: "I am the head of mathematics at a Toronto secondary school and have taught MCV4U and MHF4U for fifteen years. I take a small number of tutoring students, generally those aiming at engineering science, waterloo mathematics, or similar programs where a 95 is the entry price.\n\nAt that level the work is not about catching up — it is about precision, exam technique, and closing the gap between 'I understand this' and 'I can produce a full-mark solution under time pressure'. We work through problems harder than anything on the course, because that is what makes the actual test feel manageable.\n\nI also coach for the Euclid and CEMC contests. I am direct about whether I think I can help: if a student needs foundational work rather than enrichment, I will say so and suggest a better fit.",
    qualifications: ["CERTIFIED_TEACHER", "OCT_MEMBER", "POSTGRADUATE", "SUBJECT_SPECIALIST"],
    oct: "154302",
    education: [
      { institution: "University of Toronto", credential: "MEd", fieldOfStudy: "Curriculum, Teaching and Learning", startYear: 2016, endYear: 2018 },
      { institution: "University of Toronto", credential: "Bachelor of Education", fieldOfStudy: "Intermediate/Senior Mathematics", startYear: 2008, endYear: 2010 },
      { institution: "University of Waterloo", credential: "BMath (Honours)", fieldOfStudy: "Applied Mathematics", startYear: 2004, endYear: 2008 },
    ],
    experience: [
      { title: "Head of Mathematics", organisation: "Toronto secondary school", startYear: 2018, current: true },
      { title: "Mathematics Teacher", organisation: "Toronto District School Board", startYear: 2010, current: true },
      { title: "CEMC Contest Coach", organisation: "School mathematics club", startYear: 2012, current: true },
    ],
    courses: ["MCV4U", "MHF4U", "MDM4U", "MCR3U"],
    modes: ["ONLINE", "IN_PERSON"], radius: 12,
    badges: ["IDENTITY", "OCT", "EDUCATION", "BACKGROUND_CHECK"],
    languages: ["English", "Japanese"],
    availability: [
      { weekday: 2, start: "18:30", end: "21:00" }, { weekday: 4, start: "18:30", end: "21:00" },
      { weekday: 6, start: "09:00", end: "13:00" },
    ],
  },
  {
    firstName: "Michael", lastName: "Ferreira", email: "michael.ferreira@example.com",
    city: "Oshawa", postalCode: "L1H 7K4", rate: 4500, years: 3,
    headline: "History, geography and social sciences — essays, sources and exam preparation",
    bio: "I am completing a Master's in history at Queen's and tutor the Ontario humanities courses. Students often tell me history is 'just memorising dates', which is exactly why their essays score in the 60s: the marks are for argument and use of evidence, not recall.\n\nWe work on source analysis first — how to read a document for what it reveals about its author, not just its content — and then on building a thesis that takes a genuine position. CHY4U and CHC2D both reward this heavily and teach it unevenly.\n\nI am also comfortable with HSP3U and the social sciences more broadly, including research methods, which trips up a lot of otherwise strong students.",
    qualifications: ["UNIVERSITY_STUDENT", "GRADUATE"],
    education: [
      { institution: "Queen's University", credential: "MA", fieldOfStudy: "History", startYear: 2024, inProgress: true },
      { institution: "Trent University", credential: "BA (Honours)", fieldOfStudy: "History and Political Studies", startYear: 2019, endYear: 2023 },
    ],
    experience: [
      { title: "Teaching Assistant", organisation: "Queen's University, Department of History", startYear: 2024, current: true },
      { title: "Writing Centre Tutor", organisation: "Trent University", startYear: 2021, endYear: 2023 },
    ],
    courses: ["CHY4U", "CHC2D", "CGC1W", "HSP3U", "ENG3U"],
    modes: ["ONLINE", "IN_PERSON"], radius: 20,
    badges: ["IDENTITY", "UNIVERSITY_STUDENT"],
    languages: ["English", "Portuguese"],
    availability: [
      { weekday: 1, start: "16:00", end: "20:00" }, { weekday: 3, start: "16:00", end: "20:00" },
      { weekday: 5, start: "14:00", end: "19:00" }, { weekday: 0, start: "11:00", end: "17:00" },
    ],
    freeIntro: true,
  },
  {
    firstName: "Aisha", lastName: "Rahman", email: "aisha.rahman@example.com",
    city: "Toronto", postalCode: "M6H 1L5", rate: 5900, years: 6,
    headline: "Grade 9–11 math and science — building the habits senior courses assume",
    bio: "Most of my students are in Grades 9 to 11, at the point where school mathematics stops being about procedures and starts being about reasoning. That transition catches out a lot of students who did well in elementary school.\n\nI teach note-taking and problem-solving habits alongside content, because a student who cannot organise their own work will keep hitting the same wall regardless of how well any individual topic is explained. We use a consistent format for every problem, which feels pedantic for about a month and then pays off permanently.\n\nI work with several families where English is a second language and am happy to explain concepts in Bengali or Urdu where that helps.",
    qualifications: ["GRADUATE", "SUBJECT_SPECIALIST"],
    education: [
      { institution: "York University", credential: "BSc (Honours)", fieldOfStudy: "Applied Mathematics", startYear: 2016, endYear: 2020 },
    ],
    experience: [
      { title: "Mathematics Tutor", organisation: "Self-employed", startYear: 2019, current: true, description: "Over 700 hours with Grade 9 to 11 students across the GTA." },
    ],
    courses: ["MTH1W", "MPM2D", "MCR3U", "MCF3M", "SNC1W", "SNC2D", "SPH3U"],
    modes: ["ONLINE", "IN_PERSON"], radius: 16,
    badges: ["IDENTITY", "EDUCATION"],
    languages: ["English", "Bengali", "Urdu"],
    availability: [
      { weekday: 1, start: "16:00", end: "21:00" }, { weekday: 2, start: "16:00", end: "21:00" },
      { weekday: 4, start: "16:00", end: "21:00" }, { weekday: 6, start: "10:00", end: "15:00" },
    ],
  },
  {
    firstName: "Thomas", lastName: "Wright", email: "thomas.wright@example.com",
    city: "London", postalCode: "N6A 3K7", rate: 5000, years: 5,
    headline: "Elementary math and literacy — Grades 4 to 8, in person across London",
    bio: "I work with elementary students, mostly Grades 4 to 8, on mathematics and reading. At this age the most valuable thing tutoring provides is usually not content but attention: a patient adult who notices exactly where a student stopped following.\n\nFor mathematics I use manipulatives and visual models well past the age most textbooks abandon them, because fractions and ratios genuinely are easier to see than to state. For literacy I focus on comprehension strategies — predicting, questioning, summarising — that transfer to every subject.\n\nI am comfortable working in a family home or at a branch of the London Public Library, whichever suits. I give parents a short written note after each session rather than a verbal summary at the door.",
    qualifications: ["CERTIFIED_TEACHER", "OCT_MEMBER"],
    oct: "512987",
    education: [
      { institution: "Western University", credential: "Bachelor of Education", fieldOfStudy: "Primary/Junior", startYear: 2018, endYear: 2020 },
      { institution: "Western University", credential: "BA", fieldOfStudy: "Psychology", startYear: 2014, endYear: 2018 },
    ],
    experience: [
      { title: "Occasional Teacher", organisation: "Thames Valley District School Board", startYear: 2020, current: true },
    ],
    courses: ["Elementary Mathematics", "Elementary Language", "Elementary Science"],
    modes: ["IN_PERSON", "ONLINE"], radius: 25,
    badges: ["IDENTITY", "OCT", "EDUCATION", "BACKGROUND_CHECK"],
    languages: ["English"],
    availability: [
      { weekday: 1, start: "15:30", end: "19:30" }, { weekday: 2, start: "15:30", end: "19:30" },
      { weekday: 3, start: "15:30", end: "19:30" }, { weekday: 6, start: "09:00", end: "14:00" },
    ],
    freeIntro: true,
  },
];

/** Families and self-serve students. */
export const PARENTS = [
  {
    firstName: "Jennifer", lastName: "Chen", email: "jennifer.chen@example.com",
    city: "Toronto", postalCode: "M4W 1A8",
    children: [
      { firstName: "Emily", lastName: "Chen", birthYear: 2008, grade: 12, school: "North Toronto Collegiate", notes: "Applying to life sciences at UofT and McMaster. Needs to bring SBI4U up from a 78." },
      { firstName: "Lucas", lastName: "Chen", birthYear: 2011, grade: 9, school: "North Toronto Collegiate", notes: "Struggling with the transition to de-streamed Grade 9 math." },
    ],
  },
  {
    firstName: "David", lastName: "Thompson", email: "david.thompson@example.com",
    city: "Mississauga", postalCode: "L5B 4A5",
    children: [
      { firstName: "Olivia", lastName: "Thompson", birthYear: 2009, grade: 11, school: "Port Credit Secondary", notes: "Confident in class, loses marks on tests. Wants to get MCR3U above 85 before applying." },
    ],
  },
  {
    firstName: "Maria", lastName: "Santos", email: "maria.santos@example.com",
    city: "Brampton", postalCode: "L6Y 2P4",
    children: [
      { firstName: "Gabriel", lastName: "Santos", birthYear: 2010, grade: 10, school: "Turner Fenton Secondary", notes: "Diagnosed with ADHD. Works best in 45-minute sessions with breaks." },
      { firstName: "Sofia", lastName: "Santos", birthYear: 2013, grade: 7, school: "Fletcher's Meadow", notes: "Enjoys science, needs support with written work." },
    ],
  },
  {
    firstName: "Ahmed", lastName: "Khalil", email: "ahmed.khalil@example.com",
    city: "Ottawa", postalCode: "K2P 2E5",
    children: [
      { firstName: "Yusuf", lastName: "Khalil", birthYear: 2008, grade: 12, school: "Lisgar Collegiate", notes: "Aiming for engineering. Needs MCV4U and SPH4U both above 90." },
    ],
  },
  {
    firstName: "Rebecca", lastName: "Osei", email: "rebecca.osei@example.com",
    city: "Scarborough", postalCode: "M1K 3T2",
    children: [
      { firstName: "Daniel", lastName: "Osei", birthYear: 2012, grade: 8, school: "Cedarbrae Junior Public", notes: "Preparing for the jump to Grade 9 mathematics." },
    ],
  },
];

export const SELF_STUDENTS = [
  {
    firstName: "Nadia", lastName: "Petrov", email: "nadia.petrov@example.com",
    city: "Toronto", postalCode: "M5A 3C4", birthYear: 2006, grade: 12,
    notes: "Returning to finish ENG4U as a mature student while working full-time.",
  },
  {
    firstName: "Connor", lastName: "Walsh", email: "connor.walsh@example.com",
    city: "Hamilton", postalCode: "L8P 2B3", birthYear: 2007, grade: 12,
    notes: "Upgrading MHF4U over the summer to meet a conditional university offer.",
  },
];

/** Written reviews with genuine specificity (§40 — no placeholder text). */
export const REVIEW_TEMPLATES = [
  { rating: 5, title: "Turned the term around",
    body: "My daughter went into the MHF4U midterm with a 68 and finished the course at 88. What made the difference was that lessons were diagnostic rather than just re-teaching the chapter — the first session identified that her factoring was the actual problem, not the new material. Clear written summaries after every lesson too." },
  { rating: 5, title: "Explains the why, not just the method",
    body: "We had tried two other tutors who worked through problems with my son without ever addressing why he kept getting stuck. This was different from the first session. He now sets out his work properly and, more importantly, can tell when an answer is wrong before he checks it." },
  { rating: 5, title: "Excellent with an anxious student",
    body: "My son has real test anxiety and had stopped trying in math. Sessions were paced so that he could actually finish the work set, which rebuilt his confidence more than any amount of content review would have. He is not top of the class but he is trying again, which is what we wanted." },
  { rating: 4, title: "Strong teaching, scheduling took some work",
    body: "The tutoring itself is very good — well structured, and my daughter genuinely looks forward to sessions. Finding a regular slot took a few weeks of back and forth because evenings fill up quickly, so book ahead if you need a specific time." },
  { rating: 5, title: "Knows the Ontario curriculum inside out",
    body: "Having taught the course, they knew exactly which units the school would weight heavily and what the culminating task would demand. That saved a lot of wasted effort on topics that were never going to be assessed properly." },
  { rating: 5, title: "Worth the rate",
    body: "Not the cheapest option we looked at and we hesitated. In hindsight the higher rate bought fewer, better sessions — we did eight lessons rather than the twenty a cheaper tutor would have needed. The essay structure work in particular transferred straight to her other subjects." },
  { rating: 4, title: "Very good for exam preparation",
    body: "We booked six sessions before the final and it was clearly the right call. Practice problems were harder than the actual exam, which my son complained about at the time and was grateful for afterwards. Would have liked slightly more written feedback between sessions." },
  { rating: 5, title: "Patient and genuinely kind",
    body: "My daughter is in Grade 7 and had convinced herself she was bad at math. Four months in she is putting her hand up in class. The tutoring is good but the patience is what changed things — never made her feel slow for asking the same question twice." },
  { rating: 5, title: "Helped with the whole application, not just the course",
    body: "Beyond the SBI4U content, we got useful guidance on which programs actually needed which prerequisites and how supplementary applications are read. That context was not something we could have got anywhere else and it changed where my son applied." },
  { rating: 4, title: "Reliable and well prepared",
    body: "Always on time, always had material ready that matched what the class was covering that week. Lessons were productive rather than chatty. A slightly more structured plan across the term would have been useful but the results speak for themselves." },
];
