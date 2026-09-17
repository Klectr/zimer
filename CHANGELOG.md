# Timekeep changelog

What's new in Timekeep, newest first.

## 2026-09-17

- **Immutable invoices.** Once an invoice is sent, its PDF and on-screen copy are frozen snapshots — later changes to clients or your business profile can't silently alter what a client sees.
- **Internal-only invoice notes.** A private notes field on invoices that appears in the app but never on the PDF or the client's page.
- **First-run onboarding.** Fresh installs get guided empty states and a one-click fictional workspace, with a straight path from sample data to a prefilled draft invoice.
- **Invoice this period.** Jump from the timer or calendar straight to a new invoice with the week prefilled — two clicks from tracked time to draft.
- **Rate limiting.** The public invoice page and login are now rate-limited against abuse.
- **Custom not-found pages.** Bad invoice links get a clean "this invoice doesn't exist" page; every other unknown address on the public subdomain gets a playful dead-end.

## 2026-09-16

- **Public invoice links, locked down.** Client links moved to invoices.tristonarmstrong.com, which serves only invoice pages — nothing else from the app is reachable there.
- **Per-client payment terms.** Due on receipt, Net 7/15/30/45/60, or pay-when-paid: each client can carry its own terms, and invoices pick them up automatically.
- **Manage rebuilt.** Clients and projects are now one clean expandable list.
- **Copy link fixed.** The client-link copy button works over plain HTTP without insecure fallbacks.
