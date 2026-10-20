/** #988: webhook signature verification, incl. multi-v1 headers sent
 *  during a Stripe secret rotation. */
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "./stripe.ts";

const SECRET = "whsec_test_988";
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "payment_link.updated" });

function sig(secret: string, t: number): string {
  return createHmac("sha256", secret).update(`${t}.${PAYLOAD}`).digest("hex");
}
const now = () => Math.floor(Date.now() / 1000);

describe("verifyWebhookSignature", () => {
  test("accepts a single matching v1", () => {
    const t = now();
    expect(verifyWebhookSignature(PAYLOAD, `t=${t},v1=${sig(SECRET, t)}`, SECRET)).toBe(true);
  });

  test("rejects a wrong signature", () => {
    const t = now();
    expect(verifyWebhookSignature(PAYLOAD, `t=${t},v1=${sig("whsec_other", t)}`, SECRET)).toBe(false);
  });

  test("#988: accepts when the matching v1 is first of several", () => {
    const t = now();
    const header = `t=${t},v1=${sig(SECRET, t)},v1=${sig("whsec_old", t)}`;
    expect(verifyWebhookSignature(PAYLOAD, header, SECRET)).toBe(true);
  });

  test("#988: accepts when the matching v1 is last of several", () => {
    const t = now();
    const header = `t=${t},v1=${sig("whsec_old", t)},v1=${sig(SECRET, t)}`;
    expect(verifyWebhookSignature(PAYLOAD, header, SECRET)).toBe(true);
  });

  test("#988: rejects when no v1 matches", () => {
    const t = now();
    const header = `t=${t},v1=${sig("whsec_a", t)},v1=${sig("whsec_b", t)}`;
    expect(verifyWebhookSignature(PAYLOAD, header, SECRET)).toBe(false);
  });

  test("rejects a stale timestamp even with a matching v1", () => {
    const t = now() - 3600;
    expect(verifyWebhookSignature(PAYLOAD, `t=${t},v1=${sig(SECRET, t)}`, SECRET)).toBe(false);
  });

  test("rejects malformed headers without throwing", () => {
    expect(verifyWebhookSignature(PAYLOAD, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, "garbage", SECRET)).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, `t=${now()}`, SECRET)).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, `t=${now()},v1=zz`, SECRET)).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, `t=${now()},v1=${sig(SECRET, now())}`, "")).toBe(false);
  });
});
