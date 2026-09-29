# Timekeep changelog

What's new in Timekeep, newest first.

## 2026-09-29

- **Client links moved to invoice.klectr.dev.** The public invoice hostname changed — new client links use the new address, and old tristonarmstrong.com links keep working.
- **Online payments now reliably mark invoices paid.** The Stripe webhook verifies signatures and matches payments by payment-link ID instead of fragile metadata, so paying through the client's Pay button flips the invoice to paid.
- **Invoice detail starts at the top.** Switching invoices resets the detail pane's scroll position instead of leaving you wherever the last invoice was scrolled.
- **No more phantom scroll space.** Invoices with a client link had ~900px of invisible dead scroll area below the content, caused by the link's hover tooltip; the scroll area now ends where the content ends.
- **Paid PDFs drop the PAY ONLINE line.** Once an invoice is paid, the PDF no longer includes the pay-online prompt.
- **From email placement.** On the invoice PDF, the sender email now sits below the business address instead of above it.
- **Autotracker dedupes rules.** Saving an autotracker rule under an existing name updates it instead of creating a duplicate.

## 2026-09-28

- **Invoice sheet cleanup.** Header layout reworked — title alignment, parties order, dates placement; the dates line now sits directly above the table, and the redundant "Billing period:" line is gone from the PDF (the per-row Date column already states it).
- **Client contact details.** Clients can carry email, phone, website, and a multi-line address — address and email show in the invoice Bill-to block, on screen and on the PDF.
- **Client settings in one dialog.** Renaming a client and editing all its details moved into a cog-opened settings dialog on the Manage page; the cog sits at the right end of the detail header.
- **Copy link works everywhere.** The copy-client-link button now falls back cleanly on non-secure origins (like the Tailscale URL) instead of doing nothing.

## 2026-09-25

- **Repeat an entry.** Restart any finished entry from the Today list with one tap — description and project come along.
- **Confirm dialogs look like the app.** The six native browser confirms (deleting entries, draft invoices, clients, projects, client links) are now the app's own M3 confirm dialog. Deleting the running entry is off the table — stop it first.
- **Everything ticks.** The running entry's time ticks live in the Today list, and the browser tab shows elapsed time while a timer runs.
- **Keyboard and screen-reader pass.** A skip link, focus stays trapped inside dialogs, and closing a dialog puts focus back where you were.
- **Touch tooltips.** Press-and-hold shows tooltips on touch screens; the native browser tooltips are gone everywhere else too.
- **Phones.** Invoice line items stack instead of squeezing, and dates stay glued to their labels.

## 2026-09-18

- **Material 3 navigation.** The four destinations moved out of the top app bar into proper M3 navigation: a bottom bar on phones, a leading navigation rail on larger screens, and a slimmer app bar with just the brand mark and account menu.
- **Full-screen dialogs on phones.** The calendar entry and settings dialogs now fill the whole screen below 600px, with a title/close row at the top; larger screens keep the centered dialog.
- **Timer Start/Stop are card actions.** They were borrowing the extended-FAB class for its pill shape; per M3 (a FAB never attaches to a card) they are now regular filled buttons. No floating FAB on the Timer page.
- **License gating (dormant in beta).** The groundwork for post-beta licensing is in: a one-time license key checked fully offline (Ed25519, no network calls — your data never leaves the machine), an honesty-box banner, and a License section in Settings. While `TIMEKEEP_BETA` is set (the default), none of it appears and everything stays free.

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
