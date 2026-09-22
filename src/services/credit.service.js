import "server-only";
import { User, CreditEntry } from "@/models";
import { CREDIT_REASONS, NOTIFICATION_TYPES, AUDIT_ACTIONS, PAGE_SIZES } from "@/constants";
import { NotFoundError, BusinessRuleError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { formatMoney } from "@/lib/utils/format";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Account credit (§41 Phase 2).
 *
 * Credit is money the platform owes a person — a referral reward, a welcome
 * bonus, an adjustment an administrator made. It is spent at checkout and
 * reduces what the card is charged.
 *
 * The one hard problem here is spending it twice. Two checkouts opened in two
 * tabs, a retried request, a webhook replayed: any of them can ask to spend
 * the same balance at the same moment, and this platform is expected to run
 * against a standalone MongoDB where multi-document transactions are not
 * available.
 *
 * So the balance is a single field on the user document and every spend is
 * one conditional update:
 *
 *     findOneAndUpdate(
 *       { _id, creditBalanceCents: { $gte: amount } },
 *       { $inc: { creditBalanceCents: -amount } },
 *     )
 *
 * MongoDB guarantees that is atomic on one document. Whichever request gets
 * there second finds the balance below its condition and is told it has no
 * credit, which is the truth. A sum over a ledger could never give that
 * guarantee without a transaction, so the ledger here is the *explanation* of
 * the balance, not the balance itself.
 *
 * Nothing in this module reads an amount from a request. Every caller passes
 * a figure this application computed (§42).
 */

// --- Reading ---------------------------------------------------------------

export async function creditBalance(userId) {
  const user = await User.findById(userId).select("creditBalanceCents").lean();
  return user?.creditBalanceCents ?? 0;
}

/** The statement a person sees: balance plus how it got there. */
export async function creditStatement(userId, { page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;

  const [balanceCents, entries, total] = await Promise.all([
    creditBalance(userId),
    CreditEntry.find({ userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean(),
    CreditEntry.countDocuments({ userId }),
  ]);

  return { balanceCents, entries: toPlain(entries), total, page, pageSize: size };
}

// --- Writing ---------------------------------------------------------------

/**
 * Add credit to an account.
 *
 * `idempotencyKey` is what makes a grant exactly-once: the unique index on it
 * turns a second attempt — a job run twice, a webhook redelivered — into a
 * refusal rather than a second payout.
 *
 * @returns {Promise<{ granted: boolean, balanceCents: number, duplicate?: boolean }>}
 */
export async function grantCredit({
  userId,
  amountCents,
  reason,
  referralId,
  paymentId,
  bookingId,
  note,
  createdBy,
  idempotencyKey,
  notifyRecipient = true,
}) {
  if (!userId) throw new BusinessRuleError("Credit needs an account.", "NO_ACCOUNT");
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    // A zero reward is a legitimate configuration — the operator has not set
    // an amount — and is a no-op rather than an error.
    return { granted: false, balanceCents: await creditBalance(userId), reason: "ZERO_AMOUNT" };
  }

  // Same reasoning as a spend: a grant that has already happened is answered
  // from the record, so the guarantee does not depend on the unique index
  // having finished building.
  if (idempotencyKey) {
    const existing = await CreditEntry.exists({ idempotencyKey });
    if (existing) {
      return { granted: false, duplicate: true, balanceCents: await creditBalance(userId) };
    }
  }

  // The ledger row is written first, because it is the one that can be
  // refused. If the balance moved first and this insert were rejected as a
  // duplicate, the account would be credited twice with one explanation.
  let entry;
  try {
    entry = await CreditEntry.create({
      userId,
      amountCents,
      reason,
      referralId,
      paymentId,
      bookingId,
      note,
      createdBy,
      idempotencyKey,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return { granted: false, duplicate: true, balanceCents: await creditBalance(userId) };
    }
    throw error;
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { creditBalanceCents: amountCents } },
    { returnDocument: "after", select: "creditBalanceCents firstName" },
  );

  if (!user) {
    // The account vanished between the two writes. Take the entry back rather
    // than leaving an explanation for money nobody has.
    await CreditEntry.deleteOne({ _id: entry._id });
    throw new NotFoundError("We couldn't find that account.");
  }

  await CreditEntry.updateOne(
    { _id: entry._id },
    { $set: { balanceAfterCents: user.creditBalanceCents } },
  );

  if (notifyRecipient) {
    await notify({
      userId,
      type: NOTIFICATION_TYPES.CREDIT_GRANTED,
      title: `${formatMoney(amountCents)} credit added`,
      body: `${note ?? "It will come off your next booking automatically."}`,
      href: "/referrals",
      entityType: "CreditEntry",
      entityId: entry._id,
    });
  }

  return { granted: true, balanceCents: user.creditBalanceCents, entryId: String(entry._id) };
}

/**
 * Spend up to `maxCents` of an account's credit.
 *
 * Takes whatever is available rather than failing when the balance is smaller
 * than the bill — partial credit is the normal case, not an error.
 *
 * The conditional update is the whole safety property: see the module note.
 *
 * @returns {Promise<{ appliedCents: number, balanceCents: number }>}
 */
export async function spendCredit({ userId, maxCents, paymentId, bookingId, note }) {
  if (!userId || !Number.isInteger(maxCents) || maxCents <= 0) {
    return { appliedCents: 0, balanceCents: 0 };
  }

  // "Already applied to this payment" is asked first, before the balance is
  // even looked at. It has to be: once credit has been spent the balance is
  // smaller — often zero — and a balance check placed ahead of this would
  // return "nothing applied" for a payment that in fact had the full amount
  // taken off it. A retried checkout would then charge the card the full
  // price while the credit stayed spent.
  //
  // Answered from the record rather than from a duplicate-key error, so the
  // guarantee holds even while the unique index is still being built on a
  // newly created collection.
  if (paymentId) {
    const existing = await CreditEntry.findOne({ idempotencyKey: `spend:${paymentId}` }).lean();
    if (existing) {
      return {
        appliedCents: Math.abs(existing.amountCents ?? 0),
        balanceCents: await creditBalance(userId),
        duplicate: true,
      };
    }
  }

  const available = await creditBalance(userId);
  const amount = Math.min(available, maxCents);
  if (amount <= 0) return { appliedCents: 0, balanceCents: available };

  // Claim the spend before taking the money, for the same reason a grant
  // writes its entry first: the claim is the step that can be refused, and a
  // refused claim after a successful decrement would take credit with no
  // record of where it went.
  let entry;
  try {
    entry = await CreditEntry.create({
      userId,
      amountCents: -amount,
      reason: CREDIT_REASONS.SPEND,
      paymentId,
      bookingId,
      note,
      // Scoped to the payment, so a retried checkout spends once.
      idempotencyKey: paymentId ? `spend:${paymentId}` : undefined,
    });
  } catch (error) {
    if (error?.code === 11000) {
      // Credit was already applied to this payment. Report what it was,
      // rather than applying a second lot.
      const existing = await CreditEntry.findOne({ idempotencyKey: `spend:${paymentId}` }).lean();
      return {
        appliedCents: Math.abs(existing?.amountCents ?? 0),
        balanceCents: await creditBalance(userId),
        duplicate: true,
      };
    }
    throw error;
  }

  // Conditional on still having it. A concurrent checkout that got there
  // first leaves this one with nothing, which is the truth.
  const user = await User.findOneAndUpdate(
    { _id: userId, creditBalanceCents: { $gte: amount } },
    { $inc: { creditBalanceCents: -amount } },
    { returnDocument: "after", select: "creditBalanceCents" },
  );

  if (!user) {
    // Lost the race. Withdraw the claim; the purchaser pays full price and
    // keeps the credit for next time, which is the outcome that cannot go
    // wrong for them.
    await CreditEntry.deleteOne({ _id: entry._id });
    return { appliedCents: 0, balanceCents: await creditBalance(userId) };
  }

  await CreditEntry.updateOne(
    { _id: entry._id },
    { $set: { balanceAfterCents: user.creditBalanceCents } },
  );

  return { appliedCents: amount, balanceCents: user.creditBalanceCents };
}

/**
 * Give back credit that was applied to a payment which never settled, or was
 * refunded.
 *
 * Idempotent on the payment: a hold that expires and is then swept again puts
 * the credit back once.
 */
export async function releaseCredit({ userId, amountCents, paymentId, note }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { released: false };
  }

  return grantCredit({
    userId,
    amountCents,
    reason: CREDIT_REASONS.SPEND_RELEASED,
    paymentId,
    note: note ?? "Returned from a booking that was not completed.",
    idempotencyKey: paymentId ? `release:${paymentId}` : undefined,
    // Not worth a notification: from the person's point of view nothing
    // happened, the credit simply never left.
    notifyRecipient: false,
  });
}

/**
 * Take credit back.
 *
 * Bounded at the balance: credit that has already been spent on a lesson that
 * went ahead is gone, and clawing an account into debt would be a worse
 * outcome than writing off the difference. What could not be recovered is
 * recorded so it is visible rather than silently absorbed.
 */
export async function clawBackCredit({ userId, amountCents, reason, referralId, note, createdBy }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { recoveredCents: 0, writtenOffCents: 0 };
  }

  const available = await creditBalance(userId);
  const recovered = Math.min(available, amountCents);
  const writtenOff = amountCents - recovered;

  if (recovered > 0) {
    const user = await User.findOneAndUpdate(
      { _id: userId, creditBalanceCents: { $gte: recovered } },
      { $inc: { creditBalanceCents: -recovered } },
      { returnDocument: "after", select: "creditBalanceCents" },
    );

    if (user) {
      await CreditEntry.create({
        userId,
        amountCents: -recovered,
        reason: reason ?? CREDIT_REASONS.REFERRAL_REVERSAL,
        referralId,
        note,
        createdBy,
        balanceAfterCents: user.creditBalanceCents,
      });
    }
  }

  return { recoveredCents: recovered, writtenOffCents: writtenOff };
}

/** An administrator moving a balance by hand. Always audited (§35). */
export async function adjustCredit({ userId, amountCents, note }, admin) {
  if (!Number.isInteger(amountCents) || amountCents === 0) {
    throw new BusinessRuleError("Enter an amount to add or remove.", "NO_AMOUNT");
  }

  const result =
    amountCents > 0
      ? await grantCredit({
          userId,
          amountCents,
          reason: CREDIT_REASONS.ADMIN_ADJUSTMENT,
          note,
          createdBy: admin.id,
        })
      : await clawBackCredit({
          userId,
          amountCents: Math.abs(amountCents),
          reason: CREDIT_REASONS.ADMIN_ADJUSTMENT,
          note,
          createdBy: admin.id,
        });

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.CREDIT_ADJUSTED,
    entityType: "User",
    entityId: userId,
    metadata: { amountCents, note, result },
  });

  return { ...result, balanceCents: await creditBalance(userId) };
}
