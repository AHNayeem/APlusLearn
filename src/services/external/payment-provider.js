import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Payment provider abstraction (§20, §38).
 *
 * The interface is modelled on Stripe Connect's marketplace flow — checkout
 * session, payment intent, refund, transfer — so swapping `MockPaymentProvider`
 * for a real implementation is a constructor change and nothing more. No UI
 * or service code references a provider directly.
 *
 *   PaymentService
 *     ├── createCheckout()
 *     ├── calculateCommission()   <- lib/booking/pricing (always server-side)
 *     ├── processRefund()
 *     └── getPaymentStatus()
 */

export class PaymentProvider {
  get name() {
    throw new Error("not implemented");
  }
  async createCheckout() {
    throw new Error("not implemented");
  }
  async capturePayment() {
    throw new Error("not implemented");
  }
  async getPaymentStatus() {
    throw new Error("not implemented");
  }
  async processRefund() {
    throw new Error("not implemented");
  }
  async createConnectedAccount() {
    throw new Error("not implemented");
  }
  async createTransfer() {
    throw new Error("not implemented");
  }
}

/**
 * Development provider. Money never moves, but every state transition a real
 * provider produces is modelled, so the app's booking/payout flows are
 * exercised end to end without credentials.
 */
export class MockPaymentProvider extends PaymentProvider {
  get name() {
    return "MOCK";
  }

  async createCheckout({ bookingReference, amountCents, currency = "CAD", metadata = {} }) {
    return {
      provider: this.name,
      checkoutId: `cs_mock_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      paymentIntentId: `pi_mock_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      amountCents,
      currency,
      // A real provider returns a hosted URL; we keep checkout in-app.
      checkoutUrl: `/bookings/checkout/${bookingReference}`,
      status: "REQUIRES_PAYMENT",
      metadata,
    };
  }

  /**
   * Confirm a payment. The mock accepts any card whose number does not end in
   * the reserved failure suffix, which lets QA exercise the failure path.
   */
  async capturePayment({ paymentIntentId, card = {} }) {
    const number = String(card.number ?? "4242424242424242").replace(/\s/g, "");
    if (number.endsWith("0002")) {
      return {
        status: "FAILED",
        paymentIntentId,
        failureReason: "Your card was declined. Try a different payment method.",
      };
    }
    return {
      status: "PAID",
      paymentIntentId,
      paidAt: new Date().toISOString(),
      paymentMethodBrand: detectBrand(number),
      paymentMethodLast4: number.slice(-4),
      receiptNumber: `RCPT-${Date.now().toString(36).toUpperCase()}`,
    };
  }

  async getPaymentStatus({ paymentIntentId }) {
    return { paymentIntentId, status: "PAID" };
  }

  async processRefund({ paymentIntentId, amountCents, reason }) {
    return {
      refundId: `re_mock_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
      paymentIntentId,
      amountCents,
      reason,
      status: "SUCCEEDED",
      issuedAt: new Date().toISOString(),
    };
  }

  async createConnectedAccount({ email, country = "CA" }) {
    return {
      accountId: `acct_mock_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      email,
      country,
      onboardingStatus: "IN_PROGRESS",
      onboardingUrl: "/tutor/payouts?onboarding=1",
      payoutsEnabled: false,
      chargesEnabled: false,
      requirementsDue: ["bank_account", "identity_document"],
    };
  }

  async completeConnectedAccount({ accountId }) {
    return {
      accountId,
      onboardingStatus: "COMPLETE",
      payoutsEnabled: true,
      chargesEnabled: true,
      bankName: "Mock Bank of Canada",
      accountLast4: String(Math.floor(1000 + Math.random() * 8999)),
      requirementsDue: [],
    };
  }

  async createTransfer({ accountId, amountCents, currency = "CAD" }) {
    return {
      transferId: `tr_mock_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
      accountId,
      amountCents,
      currency,
      status: "PAID",
      arrivedAt: new Date().toISOString(),
    };
  }
}

function detectBrand(number) {
  if (/^4/.test(number)) return "Visa";
  if (/^5[1-5]/.test(number)) return "Mastercard";
  if (/^3[47]/.test(number)) return "Amex";
  return "Card";
}

let cached;

/**
 * Resolve the configured provider. Adding Stripe later means adding a branch
 * here — every caller already goes through this function.
 */
export function getPaymentProvider() {
  if (cached) return cached;
  // if (process.env.STRIPE_SECRET_KEY) cached = new StripePaymentProvider(...)
  cached = new MockPaymentProvider();
  return cached;
}
