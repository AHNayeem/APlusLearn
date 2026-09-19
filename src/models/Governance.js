import mongoose from "mongoose";
import {
  DISPUTE_STATUS, DISPUTE_REASONS, AUDIT_ACTIONS, DEFAULT_SETTINGS,
} from "../constants/index.js";
import { MATCH_FACTOR_KEYS } from "../lib/matching/weights.js";
const DisputeSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    raisedByRole: { type: String, required: true },
    againstUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    reason: { type: String, enum: Object.values(DISPUTE_REASONS), required: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    requestedRefundCents: { type: Number, min: 0 },

    status: {
      type: String,
      enum: Object.values(DISPUTE_STATUS),
      default: DISPUTE_STATUS.OPEN,
      index: true,
    },

    adminNotes: {
      type: [
        new mongoose.Schema(
          {
            adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            note: { type: String, trim: true },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolutionNote: { type: String, trim: true },
    refundIssuedCents: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

DisputeSchema.index({ status: 1, createdAt: -1 });

export const Dispute = mongoose.models.Dispute || mongoose.model("Dispute", DisputeSchema);

/**
 * Append-only audit trail for security-relevant and admin actions (§35).
 */
const AuditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    actorRole: { type: String },
    action: { type: String, enum: Object.values(AUDIT_ACTIONS), required: true, index: true },

    entityType: { type: String, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },

    /** Before/after summary — never raw secrets. */
    metadata: { type: mongoose.Schema.Types.Mixed },

    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", AuditLogSchema);

/**
 * A stored branding file. The bytes live in the storage provider; only the key
 * and what is needed to serve and preview it are kept here.
 */
const BrandAssetSchema = new mongoose.Schema(
  {
    storageKey: { type: String, required: true, trim: true },
    contentType: { type: String, required: true, trim: true },
    fileName: { type: String, trim: true, maxlength: 200 },
    sizeBytes: { type: Number, min: 0 },
    width: { type: Number, min: 1 },
    height: { type: Number, min: 1 },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

const defaults = DEFAULT_SETTINGS;

/** Sub-document options shared by every settings group. */
const group = { _id: false, minimize: false };

const BrandingSchema = new mongoose.Schema(
  {
    appName: { type: String, trim: true, maxlength: 60, default: defaults.branding.appName },
    shortName: { type: String, trim: true, maxlength: 30, default: defaults.branding.shortName },
    tagline: { type: String, trim: true, maxlength: 120, default: defaults.branding.tagline },
    description: { type: String, trim: true, maxlength: 300, default: defaults.branding.description },
    logo: { type: BrandAssetSchema, default: null },
    logoDark: { type: BrandAssetSchema, default: null },
    favicon: { type: BrandAssetSchema, default: null },
    appleTouchIcon: { type: BrandAssetSchema, default: null },
    ogImage: { type: BrandAssetSchema, default: null },
  },
  group,
);

/** Colours are stored as the administrator typed them; the ramp is derived. */
const hex = (fallback) => ({
  type: String,
  trim: true,
  lowercase: true,
  match: [/^#[0-9a-f]{6}$/, "Use a 6-digit hex colour, like #2348d6."],
  default: fallback,
});

const ThemeSchema = new mongoose.Schema(
  {
    primaryColor: hex(defaults.theme.primaryColor),
    accentColor: hex(defaults.theme.accentColor),
    successColor: hex(defaults.theme.successColor),
    warningColor: hex(defaults.theme.warningColor),
    dangerColor: hex(defaults.theme.dangerColor),
    canvasColor: hex(defaults.theme.canvasColor),
    surfaceColor: hex(defaults.theme.surfaceColor),
    footerColor: hex(defaults.theme.footerColor),
  },
  group,
);

const SeoSchema = new mongoose.Schema(
  {
    metaTitle: { type: String, trim: true, maxlength: 70, default: "" },
    titleSuffix: { type: String, trim: true, maxlength: 40, default: "" },
    metaDescription: { type: String, trim: true, maxlength: 200, default: "" },
    keywords: { type: [String], default: () => [...defaults.seo.keywords] },
    ogTitle: { type: String, trim: true, maxlength: 90, default: "" },
    ogDescription: { type: String, trim: true, maxlength: 200, default: "" },
    twitterHandle: { type: String, trim: true, maxlength: 20, default: "" },
    canonicalBaseUrl: { type: String, trim: true, maxlength: 200, default: "" },
    allowIndexing: { type: Boolean, default: defaults.seo.allowIndexing },
  },
  group,
);

const ContactSchema = new mongoose.Schema(
  {
    supportEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: defaults.contact.supportEmail },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: defaults.contact.contactEmail },
    supportPhone: { type: String, trim: true, maxlength: 30, default: defaults.contact.supportPhone },
    addressLine: { type: String, trim: true, maxlength: 160, default: "" },
    city: { type: String, trim: true, maxlength: 80, default: defaults.contact.city },
    province: { type: String, trim: true, uppercase: true, maxlength: 2, default: defaults.contact.province },
    postalCode: { type: String, trim: true, uppercase: true, maxlength: 7, default: "" },
    websiteUrl: { type: String, trim: true, maxlength: 200, default: "" },
    businessHours: { type: String, trim: true, maxlength: 120, default: defaults.contact.businessHours },
    supportHours: { type: String, trim: true, maxlength: 120, default: defaults.contact.supportHours },
  },
  group,
);

const socialUrl = (fallback) => ({ type: String, trim: true, maxlength: 200, default: fallback });

const SocialSchema = new mongoose.Schema(
  {
    facebook: socialUrl(defaults.social.facebook),
    x: socialUrl(defaults.social.x),
    linkedin: socialUrl(defaults.social.linkedin),
    instagram: socialUrl(defaults.social.instagram),
    youtube: socialUrl(defaults.social.youtube),
  },
  group,
);

const FooterSchema = new mongoose.Schema(
  {
    description: { type: String, trim: true, maxlength: 400, default: "" },
    copyrightText: { type: String, trim: true, maxlength: 200, default: "" },
    showSocial: { type: Boolean, default: true },
    showNewsletter: { type: Boolean, default: true },
    showAppBadges: { type: Boolean, default: true },
  },
  group,
);

/** Every flag defaults to on: a fresh install is the whole product. */
const FeaturesSchema = new mongoose.Schema(
  Object.fromEntries(
    Object.keys(defaults.features).map((key) => [key, { type: Boolean, default: true }]),
  ),
  group,
);

/**
 * Tutor-request and matching controls (§22, §41 Phase 2).
 *
 * Bounded rather than free-form: a `minimumScore` above 100 would silently
 * empty every request's suggestions, and an unbounded `maxSuggestions` is a
 * denial-of-service against the matcher.
 */
const MatchingSchema = new mongoose.Schema(
  {
    minimumScore: { type: Number, default: defaults.matching.minimumScore, min: 0, max: 100 },
    maxSuggestions: { type: Number, default: defaults.matching.maxSuggestions, min: 1, max: 100 },
    notifyTopTutors: { type: Number, default: defaults.matching.notifyTopTutors, min: 0, max: 50 },
    requestTtlDays: { type: Number, default: defaults.matching.requestTtlDays, min: 1, max: 365 },
    requestExpiryWarningDays: {
      type: Number,
      default: defaults.matching.requestExpiryWarningDays,
      min: 0,
      max: 60,
    },
    maxOpenRequestsPerOwner: {
      type: Number,
      default: defaults.matching.maxOpenRequestsPerOwner,
      min: 1,
      max: 100,
    },
    maxInvitesPerRequest: {
      type: Number,
      default: defaults.matching.maxInvitesPerRequest,
      min: 1,
      max: 50,
    },
  },
  group,
);

/**
 * Relative importance of each matching factor. The scorer rescales these onto
 * a total of 100, so an operator can think in whatever units they like.
 */
const MatchWeightsSchema = new mongoose.Schema(
  Object.fromEntries(
    MATCH_FACTOR_KEYS.map((key) => [
      key,
      { type: Number, default: defaults.matchWeights[key], min: 0, max: 100 },
    ]),
  ),
  group,
);

/**
 * Notification switches. Every flag defaults to on except SMS, which is off
 * until an operator has a carrier behind it (§28, §41 Phase 2), and the
 * per-number ceiling, which is a number rather than a flag.
 */
const NOTIFICATION_NUMBER_KEYS = ["smsPerNumberHourlyLimit"];

/**
 * Referral rules (§41 Phase 2). The reward amounts ship at zero because the
 * requirements name the feature without pricing it; everything else works.
 */
const ReferralSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: defaults.referrals.enabled },
    referrerRewardCents: {
      type: Number,
      default: defaults.referrals.referrerRewardCents,
      min: 0,
      max: 100000,
    },
    refereeRewardCents: {
      type: Number,
      default: defaults.referrals.refereeRewardCents,
      min: 0,
      max: 100000,
    },
    qualifyingLessons: {
      type: Number,
      default: defaults.referrals.qualifyingLessons,
      min: 1,
      max: 20,
    },
    rewardExpiryDays: {
      type: Number,
      default: defaults.referrals.rewardExpiryDays,
      min: 0,
      max: 3650,
    },
    maxRewardsPerReferrer: {
      type: Number,
      default: defaults.referrals.maxRewardsPerReferrer,
      min: 1,
      max: 1000,
    },
  },
  group,
);

/** Tutor package rules (§41 Phase 2). */
const PackageSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: defaults.packages.enabled },
    minSessions: { type: Number, default: defaults.packages.minSessions, min: 1, max: 100 },
    maxSessions: { type: Number, default: defaults.packages.maxSessions, min: 1, max: 100 },
    defaultValidityDays: {
      type: Number,
      default: defaults.packages.defaultValidityDays,
      min: 1,
      max: 730,
    },
    maxValidityDays: { type: Number, default: defaults.packages.maxValidityDays, min: 1, max: 730 },
    maxActivePerTutor: {
      type: Number,
      default: defaults.packages.maxActivePerTutor,
      min: 1,
      max: 50,
    },
    expiryRefundPercent: {
      type: Number,
      default: defaults.packages.expiryRefundPercent,
      min: 0,
      max: 100,
    },
    expiryWarningDays: {
      type: Number,
      default: defaults.packages.expiryWarningDays,
      min: 0,
      max: 90,
    },
  },
  group,
);

/** Group tutoring rules (§41 Phase 2). */
const GroupSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: defaults.groups.enabled },
    minParticipants: { type: Number, default: defaults.groups.minParticipants, min: 1, max: 100 },
    maxParticipants: { type: Number, default: defaults.groups.maxParticipants, min: 1, max: 100 },
    confirmationDeadlineHours: {
      type: Number,
      default: defaults.groups.confirmationDeadlineHours,
      min: 0,
      max: 336,
    },
    underMinimumRefundPercent: {
      type: Number,
      default: defaults.groups.underMinimumRefundPercent,
      min: 0,
      max: 100,
    },
    maxWaitlist: { type: Number, default: defaults.groups.maxWaitlist, min: 0, max: 100 },
    maxOpenPerTutor: { type: Number, default: defaults.groups.maxOpenPerTutor, min: 1, max: 100 },
  },
  group,
);

const NotificationSettingsSchema = new mongoose.Schema(
  {
    ...Object.fromEntries(
      Object.keys(defaults.notifications)
        .filter((key) => !NOTIFICATION_NUMBER_KEYS.includes(key))
        .map((key) => [key, { type: Boolean, default: defaults.notifications[key] }]),
    ),
    smsPerNumberHourlyLimit: {
      type: Number,
      default: defaults.notifications.smsPerNumberHourlyLimit,
      min: 0,
      max: 50,
    },
  },
  group,
);

/**
 * Singleton platform settings. Admin-editable values that business rules read
 * at runtime — commission, cancellation windows, booking guard rails (§20, §26)
 * — plus the application's own identity, appearance and feature availability.
 *
 * No credential, key or secret is ever stored here. Provider configuration
 * lives in the environment and is reported, never edited, by the admin panel
 * (§36, `src/lib/config/env.js`).
 */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "PLATFORM", unique: true, index: true },

    commissionPercent: { type: Number, default: DEFAULT_SETTINGS.commissionPercent, min: 0, max: 50 },
    freeCancellationWindowHours: {
      type: Number,
      default: DEFAULT_SETTINGS.freeCancellationWindowHours,
      min: 0,
    },
    lateCancellationRefundPercent: {
      type: Number,
      default: DEFAULT_SETTINGS.lateCancellationRefundPercent,
      min: 0,
      max: 100,
    },
    studentNoShowRefundPercent: {
      type: Number,
      default: DEFAULT_SETTINGS.studentNoShowRefundPercent,
      min: 0,
      max: 100,
    },
    tutorNoShowRefundPercent: {
      type: Number,
      default: DEFAULT_SETTINGS.tutorNoShowRefundPercent,
      min: 0,
      max: 100,
    },
    cancellationAbuseThreshold: {
      type: Number,
      default: DEFAULT_SETTINGS.cancellationAbuseThreshold,
      min: 1,
    },
    cancellationAbuseWindowDays: {
      type: Number,
      default: DEFAULT_SETTINGS.cancellationAbuseWindowDays,
      min: 1,
    },
    minimumBookingNoticeHours: {
      type: Number,
      default: DEFAULT_SETTINGS.minimumBookingNoticeHours,
      min: 0,
    },
    bookingHorizonDays: { type: Number, default: DEFAULT_SETTINGS.bookingHorizonDays, min: 1 },
    checkoutHoldMinutes: {
      type: Number,
      default: DEFAULT_SETTINGS.checkoutHoldMinutes,
      min: 0,
    },
    minHourlyRate: { type: Number, default: DEFAULT_SETTINGS.minHourlyRate, min: 0 },
    maxHourlyRate: { type: Number, default: DEFAULT_SETTINGS.maxHourlyRate, min: 1 },
    payoutHoldDays: { type: Number, default: DEFAULT_SETTINGS.payoutHoldDays, min: 0 },
    autoPayouts: { type: Boolean, default: DEFAULT_SETTINGS.autoPayouts },
    defaultSearchRadiusKm: { type: Number, default: DEFAULT_SETTINGS.defaultSearchRadiusKm, min: 1 },
    autoModerateReviews: { type: Boolean, default: DEFAULT_SETTINGS.autoModerateReviews },

    branding: { type: BrandingSchema, default: () => ({}) },
    theme: { type: ThemeSchema, default: () => ({}) },
    seo: { type: SeoSchema, default: () => ({}) },
    contact: { type: ContactSchema, default: () => ({}) },
    social: { type: SocialSchema, default: () => ({}) },
    footer: { type: FooterSchema, default: () => ({}) },
    features: { type: FeaturesSchema, default: () => ({}) },
    notifications: { type: NotificationSettingsSchema, default: () => ({}) },
    matching: { type: MatchingSchema, default: () => ({}) },
    matchWeights: { type: MatchWeightsSchema, default: () => ({}) },
    referrals: { type: ReferralSettingsSchema, default: () => ({}) },
    packages: { type: PackageSettingsSchema, default: () => ({}) },
    groups: { type: GroupSettingsSchema, default: () => ({}) },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const Settings = mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);
