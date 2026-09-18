/** #341: Timekeep license terms. Rendered publicly at GET /terms (no auth,
 *  same public chrome as /changelog) and linked from Settings → License.
 *
 *  Terms (approved 2026-09-18): $59 one-time, one key per user, valid for
 *  the current major version (new major needs a new key), 30-day refunds,
 *  fully offline verification (no PII in keys, can't be revoked, never
 *  phones home).
 */

export interface TermsSection {
  heading: string;
  body: string;
}

export function licenseTerms(): TermsSection[] {
  return [
    {
      heading: "One-time purchase",
      body: "Timekeep costs $59 once. There is no subscription, no renewal, and no recurring charge — pay once and it's yours.",
    },
    {
      heading: "One key per user",
      body: "Your license key covers you personally. Use it on every machine you run Timekeep on. Please don't publish it — if a key leaks publicly it still works (there's nothing to revoke), but you'd be sharing your purchase with the internet.",
    },
    {
      heading: "Major versions",
      body: "Your key is valid for the current major version of Timekeep (v1.x), including all v1 updates. If a new major version is ever released (v2), it requires a new key — v1 keys keep working on v1 forever.",
    },
    {
      heading: "Refunds",
      body: "30 days from purchase, no questions asked. Just reply to the email your key arrived in and you'll get a full refund.",
    },
    {
      heading: "Privacy",
      body: "License verification happens entirely on your machine. Your key contains no personal information, is never transmitted anywhere, and cannot be revoked — there is nothing to phone home to, so there is nothing that can break or be taken away.",
    },
    {
      heading: "The honesty bit",
      body: "Timekeep keeps working with or without a key — the unlicensed reminder is a nudge, not a lockout. Buying a license removes the reminder and supports continued development. That's the whole deal.",
    },
  ];
}
