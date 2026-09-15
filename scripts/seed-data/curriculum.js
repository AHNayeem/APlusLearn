/**
 * Ontario curriculum seed (§40).
 *
 * Real course codes and names from the Ontario secondary curriculum, plus the
 * elementary grades, so search by name and by code both return sensible
 * results out of the box.
 */

export const PROVINCES = [
  { code: "ON", name: "Ontario", isActive: true, usesCourseCodes: true, courseCodeHint: "e.g. MHF4U", displayOrder: 1 },
  { code: "BC", name: "British Columbia", isActive: false, usesCourseCodes: false, displayOrder: 2 },
  { code: "AB", name: "Alberta", isActive: false, usesCourseCodes: true, courseCodeHint: "e.g. Math 30-1", displayOrder: 3 },
  { code: "QC", name: "Quebec", isActive: false, usesCourseCodes: false, displayOrder: 4 },
  { code: "MB", name: "Manitoba", isActive: false, usesCourseCodes: false, displayOrder: 5 },
  { code: "SK", name: "Saskatchewan", isActive: false, usesCourseCodes: false, displayOrder: 6 },
  { code: "NS", name: "Nova Scotia", isActive: false, usesCourseCodes: false, displayOrder: 7 },
  { code: "NB", name: "New Brunswick", isActive: false, usesCourseCodes: false, displayOrder: 8 },
];

export const GRADES = [
  { name: "Kindergarten", level: 0, stage: "ELEMENTARY" },
  { name: "Grade 1", level: 1, stage: "ELEMENTARY" },
  { name: "Grade 2", level: 2, stage: "ELEMENTARY" },
  { name: "Grade 3", level: 3, stage: "ELEMENTARY" },
  { name: "Grade 4", level: 4, stage: "ELEMENTARY" },
  { name: "Grade 5", level: 5, stage: "ELEMENTARY" },
  { name: "Grade 6", level: 6, stage: "ELEMENTARY" },
  { name: "Grade 7", level: 7, stage: "MIDDLE" },
  { name: "Grade 8", level: 8, stage: "MIDDLE" },
  { name: "Grade 9", level: 9, stage: "SECONDARY" },
  { name: "Grade 10", level: 10, stage: "SECONDARY" },
  { name: "Grade 11", level: 11, stage: "SECONDARY" },
  { name: "Grade 12", level: 12, stage: "SECONDARY" },
];

export const SUBJECTS = [
  { name: "Mathematics", shortName: "Math", icon: "Sigma", colorKey: "brand", isPopular: true, displayOrder: 1,
    description: "Number sense, algebra, functions, calculus and data management." },
  { name: "English", shortName: "English", icon: "BookOpen", colorKey: "accent", isPopular: true, displayOrder: 2,
    description: "Reading, writing, media studies and literary analysis." },
  { name: "Science", shortName: "Science", icon: "FlaskConical", colorKey: "success", isPopular: true, displayOrder: 3,
    description: "General science for elementary and intermediate grades." },
  { name: "Physics", shortName: "Physics", icon: "Atom", colorKey: "info", isPopular: true, displayOrder: 4,
    description: "Mechanics, energy, waves, electricity and modern physics." },
  { name: "Chemistry", shortName: "Chemistry", icon: "TestTube", colorKey: "warning", isPopular: true, displayOrder: 5,
    description: "Matter, reactions, solutions, gases and organic chemistry." },
  { name: "Biology", shortName: "Biology", icon: "Dna", colorKey: "success", isPopular: true, displayOrder: 6,
    description: "Cells, genetics, evolution, anatomy and ecology." },
  { name: "French", shortName: "French", icon: "Languages", colorKey: "brand", isPopular: true, displayOrder: 7,
    description: "Core, extended and immersion French." },
  { name: "Computer Science", shortName: "CS", icon: "Code", colorKey: "ink", isPopular: true, displayOrder: 8,
    description: "Programming, data structures and software design." },
  { name: "Business Studies", shortName: "Business", icon: "Briefcase", colorKey: "accent", displayOrder: 9,
    description: "Accounting, marketing, entrepreneurship and economics." },
  { name: "History", shortName: "History", icon: "Landmark", colorKey: "warning", displayOrder: 10,
    description: "Canadian and world history." },
  { name: "Geography", shortName: "Geography", icon: "Globe", colorKey: "success", displayOrder: 11,
    description: "Physical, human and environmental geography." },
  { name: "Social Sciences", shortName: "Social Sci", icon: "Users", colorKey: "info", displayOrder: 12,
    description: "Psychology, sociology and anthropology." },
];

/**
 * Ontario courses. `stream` follows the ministry's pathway letters:
 * U = University, C = College, M = University/College, D/P = Academic/Applied,
 * O = Open.
 */
export const COURSES = [
  // --- Grade 12 Mathematics ---
  { code: "MHF4U", name: "Advanced Functions", grade: 12, subject: "Mathematics", stream: "University", credits: 1, isPopular: true,
    description: "Polynomial, rational, logarithmic and trigonometric functions, and rates of change. A prerequisite for most university STEM programs." },
  { code: "MCV4U", name: "Calculus and Vectors", grade: 12, subject: "Mathematics", stream: "University", credits: 1, isPopular: true,
    description: "Derivatives, applications of calculus, and geometric and algebraic vectors in three dimensions." },
  { code: "MDM4U", name: "Mathematics of Data Management", grade: 12, subject: "Mathematics", stream: "University", credits: 1, isPopular: true,
    description: "Counting, probability, statistics and a culminating data management investigation." },
  { code: "MAP4C", name: "Foundations for College Mathematics", grade: 12, subject: "Mathematics", stream: "College", credits: 1,
    description: "Mathematical models, personal finance, measurement and statistics for college pathways." },

  // --- Grade 11 Mathematics ---
  { code: "MCR3U", name: "Functions", grade: 11, subject: "Mathematics", stream: "University", credits: 1, isPopular: true,
    description: "Quadratic, exponential and trigonometric functions, plus discrete sequences and series." },
  { code: "MCF3M", name: "Functions and Applications", grade: 11, subject: "Mathematics", stream: "University/College", credits: 1,
    description: "Quadratic, exponential and trigonometric functions with an applied emphasis." },

  // --- Grade 9 & 10 Mathematics ---
  { code: "MTH1W", name: "Mathematics", grade: 9, subject: "Mathematics", stream: "De-streamed", credits: 1, isPopular: true,
    description: "Ontario's de-streamed Grade 9 mathematics: number, algebra, data, geometry and financial literacy." },
  { code: "MPM2D", name: "Principles of Mathematics", grade: 10, subject: "Mathematics", stream: "Academic", credits: 1, isPopular: true,
    description: "Quadratic relations, analytic geometry and trigonometry." },
  { code: "MFM2P", name: "Foundations of Mathematics", grade: 10, subject: "Mathematics", stream: "Applied", credits: 1,
    description: "Measurement, proportional reasoning and linear and quadratic relations." },

  // --- English ---
  { code: "ENG4U", name: "English", grade: 12, subject: "English", stream: "University", credits: 1, isPopular: true,
    description: "Literary analysis, essay writing, media studies and the research process. Required for an OSSD." },
  { code: "ENG3U", name: "English", grade: 11, subject: "English", stream: "University", credits: 1, isPopular: true,
    description: "Canadian literature, analytical writing and oral communication." },
  { code: "ENG2D", name: "English", grade: 10, subject: "English", stream: "Academic", credits: 1,
    description: "Reading, writing and media literacy with a focus on analysis." },
  { code: "ENG1W", name: "English", grade: 9, subject: "English", stream: "De-streamed", credits: 1,
    description: "Ontario's de-streamed Grade 9 English." },
  { code: "EWC4U", name: "The Writer's Craft", grade: 12, subject: "English", stream: "University", credits: 1,
    description: "Creative and analytical writing for students pursuing writing-intensive programs." },

  // --- Sciences ---
  { code: "SBI4U", name: "Biology", grade: 12, subject: "Biology", stream: "University", credits: 1, isPopular: true,
    description: "Biochemistry, metabolic processes, molecular genetics, homeostasis and population dynamics." },
  { code: "SCH4U", name: "Chemistry", grade: 12, subject: "Chemistry", stream: "University", credits: 1, isPopular: true,
    description: "Organic chemistry, thermodynamics, equilibrium, electrochemistry and atomic structure." },
  { code: "SPH4U", name: "Physics", grade: 12, subject: "Physics", stream: "University", credits: 1, isPopular: true,
    description: "Dynamics, energy and momentum, gravitational and electromagnetic fields, and modern physics." },
  { code: "SBI3U", name: "Biology", grade: 11, subject: "Biology", stream: "University", credits: 1,
    description: "Diversity of living things, evolution, genetic processes, animals and plants." },
  { code: "SCH3U", name: "Chemistry", grade: 11, subject: "Chemistry", stream: "University", credits: 1,
    description: "Matter, chemical trends, reactions, quantities, solutions and gases." },
  { code: "SPH3U", name: "Physics", grade: 11, subject: "Physics", stream: "University", credits: 1,
    description: "Kinematics, forces, energy, waves, sound and electricity." },
  { code: "SNC2D", name: "Science", grade: 10, subject: "Science", stream: "Academic", credits: 1,
    description: "Biology, chemistry, earth and space science, and physics." },
  { code: "SNC1W", name: "Science", grade: 9, subject: "Science", stream: "De-streamed", credits: 1,
    description: "Ontario's de-streamed Grade 9 science." },

  // --- French ---
  { code: "FSF4U", name: "Core French", grade: 12, subject: "French", stream: "University", credits: 1,
    description: "Listening, speaking, reading and writing in French at the senior level." },
  { code: "FSF2D", name: "Core French", grade: 10, subject: "French", stream: "Academic", credits: 1,
    description: "Intermediate French communication and grammar." },

  // --- Computer Science ---
  { code: "ICS4U", name: "Computer Science", grade: 12, subject: "Computer Science", stream: "University", credits: 1, isPopular: true,
    description: "Object-oriented design, data structures, algorithm efficiency and software project management." },
  { code: "ICS3U", name: "Introduction to Computer Science", grade: 11, subject: "Computer Science", stream: "University", credits: 1,
    description: "Programming fundamentals, data types, control structures and software development." },

  // --- Business & Social Sciences ---
  { code: "BAF3M", name: "Financial Accounting Fundamentals", grade: 11, subject: "Business Studies", stream: "University/College", credits: 1,
    description: "The accounting cycle, financial statements and ethical accounting practice." },
  { code: "BBB4M", name: "International Business Fundamentals", grade: 12, subject: "Business Studies", stream: "University/College", credits: 1,
    description: "Global trade, marketing and business communication across cultures." },
  { code: "CHY4U", name: "World History Since the Fifteenth Century", grade: 12, subject: "History", stream: "University", credits: 1,
    description: "Social, political and economic change from 1450 to the present." },
  { code: "CHC2D", name: "Canadian History Since World War I", grade: 10, subject: "History", stream: "Academic", credits: 1,
    description: "Canadian identity, conflict, and social and political change since 1914." },
  { code: "CGC1W", name: "Issues in Canadian Geography", grade: 9, subject: "Geography", stream: "De-streamed", credits: 1,
    description: "Canada's physical environment, population, resources and sustainability." },
  { code: "HSP3U", name: "Introduction to Anthropology, Psychology and Sociology", grade: 11, subject: "Social Sciences", stream: "University", credits: 1,
    description: "Key theories and research methods across the three social sciences." },

  // --- Elementary (no course codes) ---
  { name: "Elementary Mathematics", grade: 6, subject: "Mathematics", stream: "Core",
    description: "Number sense, operations, patterning, measurement and data literacy." },
  { name: "Elementary Mathematics", grade: 8, subject: "Mathematics", stream: "Core", isPopular: true,
    description: "Integers, fractions, algebraic reasoning and preparation for Grade 9." },
  { name: "Elementary Language", grade: 6, subject: "English", stream: "Core",
    description: "Reading comprehension, writing structure and oral communication." },
  { name: "Elementary Language", grade: 8, subject: "English", stream: "Core",
    description: "Essay structure, literary response and media literacy." },
  { name: "Elementary Science", grade: 7, subject: "Science", stream: "Core",
    description: "Ecosystems, structures, pure substances and heat." },
  { name: "Elementary Mathematics", grade: 4, subject: "Mathematics", stream: "Core",
    description: "Multiplication, division, fractions and measurement." },
];
