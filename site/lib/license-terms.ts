/** #341: Timekeep terms of service. Rendered publicly at GET /terms (no auth,
 *  same public chrome as /changelog).
 *
 *  Terms (license model approved 2026-09-18): $59 one-time, one key per user,
 *  valid for the current major version, 30-day refunds, fully offline
 *  verification.
 *
 *  #730: rewritten for the hosted model — $12/month subscription, 14-day
 *  free trial, one tier; the old license-key sections are gone.
 */

export interface TermsSection {
  heading: string;
  body: string;
}

export function licenseTerms(): TermsSection[] {
  return [
    {
      heading: "Subscription",
      body: "Timekeep costs $12/month, one tier. The first 14 days are a free trial. Cancel anytime — you keep access until the end of the paid period.",
    },
    {
      heading: "Your account",
      body: "Your account covers you personally. Keep your login to yourself — you're responsible for everything done under it.",
    },
    {
      heading: "Refunds",
      body: "30 days from payment, no questions asked. Email support@klectr.dev and you'll get a full refund.",
    },
    {
      heading: "Privacy",
      body: "Your email, a hash of your password, and everything you track live on our server. We don't sell your data. Want it all deleted? Email support@klectr.dev. See the full privacy policy at /privacy.",
    },
    {
      heading: "Self-host",
      body: "Prefer to run it yourself? The self-hosted version is free forever and always will be — these hosted terms don't apply to it.",
    },
    {
      heading: "Changes",
      body: "If these terms change, we'll say so in the changelog. The terms in effect when you paid are the terms that apply.",
    },
  ];
}
