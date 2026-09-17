#!/usr/bin/env bun
/** Issue #304: offline license key tooling for Timekeep's one-time license.
 *
 *  Runs ONLY on Triston's own machine. The private key lives here and
 *  nowhere else — never in the repo, never on a server, never in chat.
 *
 *    bun scripts/mint-license.ts gen    # one-time: create the keypair
 *    bun scripts/mint-license.ts mint   # per sale: print a license key
 *
 *  `gen` prints the public key (embed it in site/lib/license.ts as
 *  EMBEDDED_PUBLIC_KEY, or ship it via TIMEKEEP_LICENSE_PUBLIC_KEY) and the
 *  private key (save it somewhere safe on this machine and delete this
 *  terminal scrollback).
 *
 *  `mint` reads the private key from TIMEKEEP_LICENSE_PRIVATE_KEY (96 hex
 *  chars of PKCS8 DER, as printed by `gen`) and prints one key:
 *  tk1-<keyid>-<signature>. Key ids are random and carry no PII.
 *
 *  Keys can't be revoked — they're verified offline, so there's nothing to
 *  phone home to. That's accepted and documented.
 */

import { generateKeyPairSync, sign, createPrivateKey, randomBytes } from "node:crypto";

const PRODUCT = "timekeep";

function usage(): never {
  console.error(`usage:
  bun scripts/mint-license.ts gen    # create the license keypair (once)
  bun scripts/mint-license.ts mint   # print one license key (per sale)

mint reads TIMEKEEP_LICENSE_PRIVATE_KEY from the environment.`);
  process.exit(1);
}

const [cmd] = Bun.argv.slice(2);
if (cmd !== "gen" && cmd !== "mint") usage();

if (cmd === "gen") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubHex = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url").toString("hex");
  const privHex = privateKey.export({ format: "der", type: "pkcs8" }).toString("hex");
  console.log("=== PUBLIC KEY ===");
  console.log("Embed in site/lib/license.ts (EMBEDDED_PUBLIC_KEY)");
  console.log("or ship via TIMEKEEP_LICENSE_PUBLIC_KEY:\n");
  console.log(pubHex);
  console.log("\n=== PRIVATE KEY — SAVE THIS, NEVER SHARE IT ===");
  console.log("Keep on this machine only. Never commit, never upload, never paste into chat.\n");
  console.log(privHex);
  process.exit(0);
}

/* mint */
const privHex = (process.env.TIMEKEEP_LICENSE_PRIVATE_KEY || "").trim().toLowerCase();
if (!/^[0-9a-f]{96}$/.test(privHex)) {
  console.error("TIMEKEEP_LICENSE_PRIVATE_KEY must be the 96-hex-char PKCS8 key from `gen`.");
  process.exit(1);
}
const privKey = createPrivateKey({ key: Buffer.from(privHex, "hex"), format: "der", type: "pkcs8" });
const keyId = randomBytes(8).toString("hex");
const sig = sign(null, Buffer.from(`${PRODUCT}:${keyId}`), privKey);
console.log(`tk1-${keyId}-${sig.toString("hex")}`);
