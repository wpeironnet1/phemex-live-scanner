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

export function sign(path, query = "", expiry = Math.floor(Date.now() / 1000) + 60, body = "") {
  const key = process.env.PHEMEX_API_KEY;
  const secret = process.env.PHEMEX_API_SECRET;

  if (!key || !secret) throw new Error("Phemex credentials are not configured");

  const signingKey = decodeApiSecret(secret);
  const payload = path + query + expiry + body;
  const sig = crypto.createHmac("sha256", signingKey).update(payload).digest("hex");

  return {
    "x-phemex-access-token": key,
    "x-phemex-request-expiry": String(expiry),
    "x-phemex-request-signature": sig
  };
}

export async function privateRequest(method, path, { query = "", body = null } = {}) {
  if ((process.env.TRADING_MODE || "paper").toLowerCase() === "paper") {
    throw new Error("Private live execution disabled while TRADING_MODE=paper");
  }

  const text = body == null ? "" : JSON.stringify(body);
  const headers = {
    ...sign(path, query, undefined, text),
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
export async function authDiagnosticStatus() {
  const path = "/g-accounts/accountPositions";
  const query = "currency=USDT";

  try {
    const headers = sign(path, query);

    const response = await fetch(`${API}${path}?${query}`, {
      method: "GET",
      headers
    });

    const data = await response.json().catch(() => ({}));

    const authenticated =
      response.ok && (data?.code === 0 || data?.code === undefined);

    return {
      authenticated,
      configured: authStatus().credentialsPresent,
      readOnly: true,
      executionUnlocked: false,
      apiHost: new URL(API).host,
      httpStatus: response.status,
      responseCode: data?.code ?? null,
      responseMessage: authenticated ? undefined : data?.msg
    };
  } catch (error) {
    return {
      authenticated: false,
      configured: authStatus().credentialsPresent,
      readOnly: true,
      executionUnlocked: false,
      error: String(error?.message || "authentication test failed")
    };
  }
}
