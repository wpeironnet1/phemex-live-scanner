import test from "node:test";
import assert from "node:assert/strict";
import { decodeApiSecret, sign } from "../src/auth.js";

test("decodes Phemex API secret as base64url bytes", () => {
  assert.deepEqual(decodeApiSecret("c2VjcmV0"), Buffer.from("secret"));
});

test("sign uses decoded API secret per Phemex REST spec", () => {
  const oldKey = process.env.PHEMEX_API_KEY;
  const oldSecret = process.env.PHEMEX_API_SECRET;

  process.env.PHEMEX_API_KEY = "test-key";
  process.env.PHEMEX_API_SECRET = "c2VjcmV0";

  try {
    const headers = sign(
      "/g-accounts/accountPositions",
      "currency=USDT",
      1700000000
    );

    assert.equal(headers["x-phemex-access-token"], "test-key");
    assert.equal(headers["x-phemex-request-expiry"], "1700000000");
    assert.equal(
      headers["x-phemex-request-signature"],
      "06d6999a7b6117a91724083051ce2d86fab68fef8377505494e85e0cab7c3dba"
    );
  } finally {
    if (oldKey === undefined) delete process.env.PHEMEX_API_KEY;
    else process.env.PHEMEX_API_KEY = oldKey;

    if (oldSecret === undefined) delete process.env.PHEMEX_API_SECRET;
    else process.env.PHEMEX_API_SECRET = oldSecret;
  }
});
