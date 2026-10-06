/**
 * Phase Two remediation (P2.4).
 *
 * SMS delivery receipts: the status callback the admin form points operators
 * at is the same signed `/api/webhooks/sms` route that handles STOP/START.
 * These checks drive that route handler with real Twilio signatures and read
 * the result back through the admin delivery log's own service.
 *
 * Fixture rows only; nothing seeded is changed.
 */
import { createHmac } from "node:crypto";

export default async function phaseTwoSuite({ section, check, skip, connectForSuite, randomUUID }) {
  section("SMS — delivery receipts reach the delivery log (P2.4)");
  if (!(await connectForSuite())) return skip("SMS delivery receipts", "MongoDB is not reachable");

  const { SmsMessage, User } = await import("@/models");
  const sms = await import("@/services/sms.service");
  const { invalidateIntegrationCache } = await import("@/lib/config/integrations");
  const { envBaseUrl } = await import("@/lib/config/base-url");
  const { SMS_STATUS, USER_STATUS, INTEGRATION_MODULES } = await import("@/constants");

  const tag = randomUUID().slice(0, 8);
  const sid = (n) => `SMqa${tag}${n}`;
  const row = (n, extra = {}) =>
    SmsMessage.create({
      to: "+14165550123",
      kind: "NOTIFICATION",
      bodyPreview: "Lesson tomorrow",
      status: SMS_STATUS.SENT,
      provider: "TWILIO",
      providerMessageId: sid(n),
      providerStatus: "queued",
      sentAt: new Date(),
      ...extra,
    });
  const read = (n) => SmsMessage.findOne({ providerMessageId: sid(n) }).lean();

  const authToken = `qa-auth-token-${tag}`;
  const env = {
    SMS_PROVIDER: "twilio",
    TWILIO_ACCOUNT_SID: `ACqa${tag}`,
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_FROM_NUMBER: "+16475550123",
  };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  let user;

  try {
    // --- the service ----------------------------------------------------------
    await row(1);
    const delivered = await sms.applySmsDeliveryStatus({ messageId: sid(1), status: "delivered" });
    const afterDelivered = await read(1);
    check("a delivered receipt marks the message delivered",
      delivered.action === "UPDATED" && afterDelivered.status === SMS_STATUS.DELIVERED, JSON.stringify(delivered));
    check("and stamps when it arrived", afterDelivered.deliveredAt instanceof Date);

    const late = await sms.applySmsDeliveryStatus({ messageId: sid(1), status: "sent" });
    check("a late 'sent' receipt cannot move a delivered message backwards",
      late.action === "UNCHANGED" && (await read(1)).status === SMS_STATUS.DELIVERED);

    const replay = await sms.applySmsDeliveryStatus({ messageId: sid(1), status: "delivered" });
    check("a redelivered receipt changes nothing",
      replay.action === "UNCHANGED" &&
        (await read(1)).deliveredAt.getTime() === afterDelivered.deliveredAt.getTime());

    await row(2);
    await sms.applySmsDeliveryStatus({ messageId: sid(2), status: "undelivered", errorCode: "30003" });
    const undelivered = await read(2);
    check("an undelivered receipt marks the message failed with the carrier's code",
      undelivered.status === SMS_STATUS.FAILED && undelivered.errorCode === "TWILIO_30003", JSON.stringify(undelivered));

    check("a receipt for a message we never sent is reported as unknown",
      (await sms.applySmsDeliveryStatus({ messageId: sid("nope"), status: "delivered" })).action === "UNKNOWN");
    check("an intermediate carrier state is ignored",
      (await sms.applySmsDeliveryStatus({ messageId: sid(2), status: "sending" })).action === "IGNORED");

    const log = await sms.listSmsMessages({ status: SMS_STATUS.DELIVERED, pageSize: 100 });
    check("the admin delivery log lists the delivered message under Delivered",
      log.items.some((m) => m.providerMessageId === sid(1)));

    // --- the signed route -----------------------------------------------------
    Object.assign(process.env, env);
    invalidateIntegrationCache(INTEGRATION_MODULES.SMS);
    const { POST } = await import("@/app/api/webhooks/sms/route");
    const url = `${envBaseUrl()}/api/webhooks/sms`;
    const sign = (params, token = authToken) => {
      const payload = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
      return createHmac("sha1", token).update(Buffer.from(payload, "utf8")).digest("base64");
    };
    const post = (params, signature = sign(params)) =>
      POST(new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature },
        body: new URLSearchParams(params).toString(),
      }));

    await row(3);
    const receipt = { MessageSid: sid(3), SmsSid: sid(3), MessageStatus: "delivered", AccountSid: env.TWILIO_ACCOUNT_SID, To: "+14165550123" };

    const forged = await post(receipt, sign(receipt, "not-the-token"));
    check("a receipt with a forged signature is refused",
      forged.status === 403 && (await read(3)).status === SMS_STATUS.SENT, `status ${forged.status}`);

    const accepted = await post(receipt);
    check("a signed delivery receipt posted to the webhook is applied",
      accepted.status === 200 && (await read(3)).status === SMS_STATUS.DELIVERED, `status ${accepted.status}`);

    await row(4);
    const failedReceipt = { MessageSid: sid(4), MessageStatus: "failed", ErrorCode: "30005", AccountSid: env.TWILIO_ACCOUNT_SID };
    await post(failedReceipt);
    check("a signed failure receipt records the failure",
      (await read(4)).status === SMS_STATUS.FAILED && (await read(4)).errorCode === "TWILIO_30005");

    // The same URL still handles replies — the receipt branch must not swallow them.
    const phone = `+1416555${String(Date.now()).slice(-4)}`;
    user = await User.create({
      email: `qa-sms-${tag}@example.com`, firstName: "Sms", lastName: "Receipt", role: "PARENT",
      status: USER_STATUS.ACTIVE, emailVerifiedAt: new Date(), phoneE164: phone, phoneVerifiedAt: new Date(),
    });
    const stop = { From: phone, Body: "STOP", MessageSid: sid(5), AccountSid: env.TWILIO_ACCOUNT_SID };
    const stopped = await post(stop);
    check("a signed STOP on the same URL is still applied as an opt-out",
      stopped.status === 200 && Boolean((await User.findById(user._id).lean()).smsOptOutAt));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    invalidateIntegrationCache(INTEGRATION_MODULES.SMS);
    await SmsMessage.deleteMany({ providerMessageId: new RegExp(`^SMqa${tag}`) });
    if (user) await User.deleteOne({ _id: user._id });
  }
}
