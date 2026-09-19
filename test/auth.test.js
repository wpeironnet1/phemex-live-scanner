import test from "node:test";
import assert from "node:assert/strict";
import { decodeApiSecret, secretDiagnostics, signingKeyForSecret, sign } from "../src/auth.js";

test("decodes Phemex API secret as base64url bytes", () => {
  assert.deepEqual(decodeApiSecret("c2VjcmV0"), Buffer.from("secret"));
});

test("reports safe credential-shape diagnostics without exposing secret", () => {
  assert.deepEqual(secretDiagnostics(" c2VjcmV0 "), {
    secretPresent: true,
    hasOuterWhitespace: true,
    hasQuotes: false,
    encodedLength: 8,
    decodedBytes: 6,
    base64UrlRoundTrip: true
  });
});

test("uses decoded bytes for canonical base64url secrets", () => {
  const result = signingKeyForSecret("c2VjcmV0");
  assert.equal(result.mode, "base64url-decoded");
  assert.deepEqual(result.key, Buffer.from("secret"));
});

test("uses raw utf8 for non-canonical/new-format secrets", () => {
  const value = "new-format-secret::abc_123-not-base64";
  const result = signingKeyForSecret(value);
  assert.equal(result.mode, "raw-utf8");
  assert.deepEqual(result.key, Buffer.from(value));
});

test("sign produces expected HMAC for canonical base64url secret", () => {
  const oldKey = process.env.PHEMEX_API_KEY;
  const oldSecret = process.env.PHEMEX_API_SECRET;

  process.env.PHEMEX_API_KEY = "test-key";
  process.env.PHEMEX_API_SECRET = "c2VjcmV0";

  try {
    const signed = sign(
      "/g-accounts/accountPositions",
      "currency=USDT",
      1700000000
    );

    assert.equal(signed.secretMode, "base64url-decoded");
    assert.equal(signed.headers["x-phemex-access-token"], "test-key");
    assert.equal(signed.headers["x-phemex-request-expiry"], "1700000000");
    assert.equal(
      signed.headers["x-phemex-request-signature"],
      "06d6999a7b6117a91724083051ce2d86fab68fef8377505494e85e0cab7c3dba"
    );
  } finally {
    if (oldKey === undefined) delete process.env.PHEMEX_API_KEY;
    else process.env.PHEMEX_API_KEY = oldKey;

    if (oldSecret === undefined) delete process.env.PHEMEX_API_SECRET;
    else process.env.PHEMEX_API_SECRET = oldSecret;
  }
});
