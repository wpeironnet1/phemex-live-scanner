import crypto from "node:crypto";

const API = process.env.PHEMEX_API_URL || "https://api.phemex.com";

export function authStatus() {
  return {
    credentialsPresent: Boolean(process.env.PHEMEX_API_KEY && process.env.PHEMEX_API_SECRET),
    mode: (process.env.TRADING_MODE || "paper").toLowerCase(),
    apiHost: new URL(API).host
  };
}

export function decodeApiSecret(secret) {
  if (!secret) throw new Error("Phemex API secret is not configured");
  return Buffer.from(secret, "base64url");
}

export function secretDiagnostics(secret = process.env.PHEMEX_API_SECRET || "") {
  const raw = String(secret);
  const trimmed = raw.trim();
  const decoded = trimmed ? Buffer.from(trimmed, "base64url") : Buffer.alloc(0);
  const normalizedInput = trimmed.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const normalizedRoundTrip = decoded.toString("base64url");
  return {
    secretPresent: raw.length > 0,
    hasOuterWhitespace: raw !== trimmed,
    hasQuotes: /^["']|["']$/.test(trimmed),
    encodedLength: trimmed.length,
    decodedBytes: decoded.length,
    base64UrlRoundTrip: normalizedInput === normalizedRoundTrip
  };
}

export function signingKeyForSecret(secret) {
  const trimmed = String(secret || "").trim();
  if (!trimmed) throw new Error("Phemex API secret is not configured");

  const diagnostics = secretDiagnostics(trimmed);

  // Phemex docs describe legacy secrets as Base64URL encoded, while their
  // official Node example signs with the supplied secret directly. Support
  // both formats without needing the secret to be exposed or re-entered.
  if (diagnostics.base64UrlRoundTrip) {
    return { key: Buffer.from(trimmed, "base64url"), mode: "base64url-decoded" };
  }

  return { key: Buffer.from(trimmed, "utf8"), mode: "raw-utf8" };
}

export function sign(path, query = "", expiry = Math.floor(Date.now() / 1000) + 60, body = "") {
  const apiKey = process.env.PHEMEX_API_KEY;
  const secret = process.env.PHEMEX_API_SECRET;

  if (!apiKey || !secret) throw new Error("Phemex credentials are not configured");

  const { key: signingKey, mode } = signingKeyForSecret(secret);
  const payload = path + query + expiry + body;
  const sig = crypto.createHmac("sha256", signingKey).update(payload).digest("hex");

  return {
    headers: {
      "x-phemex-access-token": apiKey.trim(),
      "x-phemex-request-expiry": String(expiry),
      "x-phemex-request-signature": sig
    },
    secretMode: mode
  };
}

export async function privateRequest(method, path, { query = "", body = null } = {}) {
  if ((process.env.TRADING_MODE || "paper").toLowerCase() === "paper") {
    throw new Error("Private live execution disabled while TRADING_MODE=paper");
  }

  const text = body == null ? "" : JSON.stringify(body);
  const signed = sign(path, query, undefined, text);
  const headers = {
    ...signed.headers,
    "content-type": "application/json"
  };

  const r = await fetch(`${API}${path}${query ? `?${query}` : ""}`, {
    method,
    headers,
    body: text || undefined
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j?.code !== undefined && j.code !== 0)) {
    throw new Error(`Phemex request failed (${r.status}/${j?.code ?? "unknown"})`);
  }

  return j;
}

// Read-only connectivity diagnostics must remain separate from order execution.

function hmacHex(secretKey, payload) {
  return crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
}

async function probeSignatureVariant({ name, key, payload, expiryHeader, path, query }) {
  const response = await fetch(`${API}${path}?${query}`, {
    method: "GET",
    headers: {
      "x-phemex-access-token": (process.env.PHEMEX_API_KEY || "").trim(),
      "x-phemex-request-expiry": String(expiryHeader),
      "x-phemex-request-signature": hmacHex(key, payload)
    }
  });
  const data = await response.json().catch(() => ({}));
  return {
    name,
    authenticated: response.ok && (data?.code === 0 || data?.code === undefined),
    httpStatus: response.status,
    responseCode: data?.code ?? null,
    responseMessage: data?.msg
  };
}

export async function authDiagnosticStatus() {
  const path = "/g-accounts/accountPositions";
  const query = "currency=USDT";

  try {
    const apiKey = (process.env.PHEMEX_API_KEY || "").trim();
    const secret = (process.env.PHEMEX_API_SECRET || "").trim();
    if (!apiKey || !secret) throw new Error("Phemex credentials are not configured");

    const nowSec = Math.floor(Date.now() / 1000);
    const expirySec = nowSec + 60;
    const expiryMs = Date.now() + 60000;
    const rawKey = Buffer.from(secret, "utf8");
    const decodedKey = Buffer.from(secret, "base64url");

    const variants = [
      {
        name: "raw-standard",
        key: rawKey,
        expiryHeader: expirySec,
        payload: path + query + expirySec
      },
      {
        name: "decoded-standard",
        key: decodedKey,
        expiryHeader: expirySec,
        payload: path + query + expirySec
      },
      {
        name: "raw-query-question-mark",
        key: rawKey,
        expiryHeader: expirySec,
        payload: path + "?" + query + expirySec
      },
      {
        name: "raw-millisecond-expiry",
        key: rawKey,
        expiryHeader: expiryMs,
        payload: path + query + expiryMs
      },
      {
        name: "raw-no-leading-slash",
        key: rawKey,
        expiryHeader: expirySec,
        payload: path.slice(1) + query + expirySec
      }
    ];

    const probeResults = [];
    for (const variant of variants) {
      probeResults.push(await probeSignatureVariant({ ...variant, path, query }));
    }

    const winner = probeResults.find((r) => r.authenticated) || null;

    return {
      authenticated: Boolean(winner),
      configured: authStatus().credentialsPresent,
      readOnly: true,
      executionUnlocked: false,
      apiHost: new URL(API).host,
      winningVariant: winner?.name ?? null,
      credentialShape: {
        keyLooksUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apiKey),
        ...secretDiagnostics(secret)
      },
      probes: probeResults
    };
  } catch (error) {
    return {
      authenticated: false,
      configured: authStatus().credentialsPresent,
      readOnly: true,
      executionUnlocked: false,
      credentialShape: {
        keyLooksUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((process.env.PHEMEX_API_KEY || "").trim()),
        ...secretDiagnostics()
      },
      error: String(error?.message || "authentication test failed")
    };
  }
}
