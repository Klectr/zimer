/** Issue #304: one-time license gating for self-hosted distribution.
 *
 *  Model: free and full-featured through beta. After beta, the app runs in
 *  "launch mode" (`TIMEKEEP_BETA=0`) and shows an honesty-box banner on every
 *  page until a valid license key is entered in Settings. All features keep
 *  working either way — the banner is a nudge, not a lockout.
 *
 *  Keys are `tk1-<keyid>-<signature>`: Ed25519 over
 *  "timekeep:<major>:<keyid>" (#340), verified against Triston's public key.
 *  The `tk1` prefix is the *key format* version; `<major>` is the *license*
 *  major version (1 for v1.x). A v1 key validates only on a v1 app — a v2
 *  app needs a v2 key, which is how "new major needs a new key" is enforced.
 *  Validation is fully offline — node:crypto only, zero network I/O, so the
 *  privacy posture ("your data and your license check never leave the
 *  machine") holds. node:crypto is used instead of WebCrypto so verification
 *  stays synchronous and layout() never has to go async. Still zero
 *  dependencies.
 *
 *  Key issuance lives in scripts/mint-license.ts and runs offline on
 *  Triston's machine. The private key is NEVER in this repo, NEVER on a
 *  server. The public half is embedded below (or via
 *  TIMEKEEP_LICENSE_PUBLIC_KEY); until it's set, no key can validate and
 *  the banner simply persists in launch mode.
 */

import type { Database } from "bun:sqlite";
import { verify, createPublicKey } from "node:crypto";
import { getMeta, setMeta } from "../db.ts";
import { esc } from "./format.ts";
import { icon } from "./icons.ts";
import { appMajor } from "./version.ts"; /* #340 */

export const LICENSE_PRODUCT_ID = "timekeep";
export const LICENSE_META_KEY = "license_key";
/* Key id: 8 random bytes hex. Signature: 64-byte Ed25519 hex. */
const KEY_RE = /^tk1-([0-9a-f]{16})-([0-9a-f]{128})$/;

/* #304: fail-open default — TIMEKEEP_BETA unset (or anything but "0")
   means beta: no key required, no licensing UI, no nags anywhere. */
export function isLaunchMode(): boolean {
  return process.env.TIMEKEEP_BETA === "0";
}

/* Post-beta price shown in the banner. ~$49-69 was proposed, never approved;
   override with TIMEKEEP_LICENSE_PRICE without a code change. */
export function licensePrice(): string {
  return (process.env.TIMEKEEP_LICENSE_PRICE || "").trim() || "$59";
}

/* #339: where the "Buy license" button points. TIMEKEEP_BUY_URL overrides
   the baked-in default (Triston's Stripe Payment Link). Empty until he
   creates the link — the button hides itself when there's no URL, so the
   section never shows a dead purchase path. */
const EMBEDDED_BUY_URL = "";
export function licenseBuyUrl(): string {
  return (process.env.TIMEKEEP_BUY_URL || "").trim() || EMBEDDED_BUY_URL;
}

/* Triston's license public key (32 bytes hex). Ships empty until he runs
   `bun scripts/mint-license.ts gen` on his own machine and the public half
   lands here. TIMEKEEP_LICENSE_PUBLIC_KEY (hex) overrides the constant. */
const EMBEDDED_PUBLIC_KEY = "";

function publicKeyBytes(): Buffer | null {
  const hex = ((process.env.TIMEKEEP_LICENSE_PUBLIC_KEY || "").trim() || EMBEDDED_PUBLIC_KEY).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

function parseKey(key: string): { keyId: string; sig: Buffer } | null {
  const m = KEY_RE.exec(key.trim());
  if (!m) return null;
  return { keyId: m[1], sig: Buffer.from(m[2], "hex") };
}

/** Offline Ed25519 check. Never throws, never touches the network.
 *  #340: the signed payload includes the app's major version, so a key
 *  minted for v1 validates only on a v1 app. */
export function validateLicenseKey(key: string): boolean {
  const parsed = parseKey(key);
  const pub = publicKeyBytes();
  if (!parsed || !pub) return false;
  try {
    const pubKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: pub.toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(`${LICENSE_PRODUCT_ID}:${appMajor()}:${parsed.keyId}`), pubKey, parsed.sig);
  } catch {
    return false;
  }
}

/* A valid TIMEKEEP_LICENSE_KEY env var licenses the install without
   touching the DB (handy for headless deploys); otherwise the stored key. */
export function isLicensed(db: Database): boolean {
  const envKey = (process.env.TIMEKEEP_LICENSE_KEY || "").trim();
  if (envKey && validateLicenseKey(envKey)) return true;
  const stored = getMeta(db, LICENSE_META_KEY).trim();
  return stored !== "" && validateLicenseKey(stored);
}

export function storedKeyId(db: Database): string | null {
  const parsed = parseKey(getMeta(db, LICENSE_META_KEY));
  return parsed ? parsed.keyId : null;
}

/* #304: honesty-box banner, launch mode only, rendered by layout() so it
   appears on every app page until licensed. #345: persistent — no dismiss
   button, no per-session hiding. Never rendered in beta. Public invoice
   pages use publicShell(), not layout(), so client-facing pages never show
   licensing UI. */
export function licenseBannerHtml(licensed: boolean): string {
  if (!isLaunchMode() || licensed) return "";
  return `<div class="license-banner" id="license-banner" data-enter="1" role="note">
    ${icon("info")}
    <span><strong>Timekeep is ${esc(licensePrice())} one-time.</strong> Enter your license key in Settings — everything keeps working either way.</span>
    <button class="md-text-button" type="button" id="license-banner-settings">Open Settings</button>
  </div>
  <script>(function(){
    var b=document.getElementById('license-banner'); if(!b) return;
    document.getElementById('license-banner-settings').addEventListener('click',function(){
      var item=document.getElementById('settings-menu-item'); if(item) item.click();
    });
  })();</script>`;
}

/* #304: License section inside the Settings modal (launch mode only).
   Posts to /license and swaps itself in place. An invalid key is rejected
   with a specific message and the previously stored key is left untouched. */
export function licenseSectionHtml(db: Database, licensed: boolean, error = ""): string {
  const keyId = licensed ? storedKeyId(db) : null;
  /* #339: buy button sits right above the key field — the buyer is already
     here. Hidden until a buy URL is configured (env or baked-in). */
  const buyUrl = licenseBuyUrl();
  const buy = buyUrl
    ? `<p style="margin:0 0 12px"><a class="md-filled-button" href="${esc(buyUrl)}" target="_blank" rel="noopener">${icon("card")}<span>Buy license — ${esc(licensePrice())}</span></a></p>`
    : "";
  const body = licensed
    ? `<p class="licensed-ok">${icon("check")}<span><strong>Licensed.</strong>${keyId ? ` Key <code>${esc(keyId)}</code> verified` : ""} — thanks for supporting Timekeep.</span></p>`
    : `<p class="muted" style="margin:0 0 12px">One key per user — use it on all your machines. Keys never leave this machine — validation is fully offline, no network calls. <a href="/terms" target="_blank" rel="noopener">License terms</a></p>
      ${buy}
      <form method="post" action="/license" class="manage-form" hx-post="/license" hx-target="#license-section" hx-swap="outerHTML">
        <div class="md-text-field">
          <input type="text" name="license_key" placeholder=" " autocomplete="off" spellcheck="false" aria-label="License key">
          <label>License key</label>
        </div>
        ${error ? `<p class="license-error" role="alert">${esc(error)}</p>` : ""}
        <div class="manage-form-row">
          <span class="manage-form-spacer"></span>
          <button class="md-filled-button" type="submit">${icon("save")}Save</button>
        </div>
      </form>`;
  return `<section id="license-section">
      <h2 class="md-headline-small">License</h2>
      ${body}
    </section>`;
}

/** Persist a key only after it validates. Returns false (storing nothing)
    when the key is invalid — previous state unchanged. */
export function storeLicenseKey(db: Database, key: string): boolean {
  if (!validateLicenseKey(key)) return false;
  setMeta(db, LICENSE_META_KEY, key.trim());
  return true;
}
