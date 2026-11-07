// Sign-in with a one-time code emailed to an @albibiconstruction.com address,
// followed by a signed, HttpOnly session cookie.
import crypto from "node:crypto";
import { config, requireSecret } from "./config.mjs";
import { HttpError } from "./http.mjs";
import { getStore } from "./store.mjs";

const COOKIE = "albibi_session";

// Accepts "john", "John.Smith" or "john@albibiconstruction.com" and returns the full address.
export function normalizeEmail(input) {
  let value = String(input || "").trim().toLowerCase();
  const suffix = "@" + config.emailDomain;
  if (value.endsWith(suffix)) value = value.slice(0, -suffix.length);
  if (value.includes("@")) {
    throw new HttpError(400, `Only ${suffix} email addresses can sign in.`);
  }
  if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(value) || value.includes("..")) {
    throw new HttpError(400, "Please enter the first part of your work email, e.g. john.smith");
  }
  return value + suffix;
}

const hmac = (data) => crypto.createHmac("sha256", requireSecret()).update(data).digest();
const codeHash = (email, code) => hmac(`code:${email}:${code}`).toString("hex");

const safeEqual = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Creates a 6 digit code, stores its hash and returns the plain code (to be emailed).
export async function createLoginCode(email) {
  requireSecret();
  const store = await getStore();
  const key = `otp/${email}`;
  const now = Date.now();
  const existing = await store.get(key);

  const windowStart = now - 15 * 60_000;
  const recent = (existing?.requests || []).filter((t) => t > windowStart);
  if (recent.length >= config.codeMaxRequestsPer15Min) {
    throw new HttpError(429, "Too many codes requested. Please wait 15 minutes and try again.");
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await store.set(key, {
    hash: codeHash(email, code),
    expires: now + config.codeTtlMinutes * 60_000,
    attempts: 0,
    requests: [...recent, now],
  });
  return code;
}

export async function verifyLoginCode(email, code) {
  const store = await getStore();
  const key = `otp/${email}`;
  const record = await store.get(key);
  const clean = String(code || "").replace(/\D/g, "");

  if (!record || !record.hash || record.expires < Date.now()) {
    throw new HttpError(400, "That code has expired. Please request a new one.");
  }
  if (record.attempts >= config.codeMaxAttempts) {
    throw new HttpError(429, "Too many wrong attempts. Please request a new code.");
  }
  if (!safeEqual(codeHash(email, clean), record.hash)) {
    await store.set(key, { ...record, attempts: record.attempts + 1 });
    const left = config.codeMaxAttempts - record.attempts - 1;
    throw new HttpError(400, left > 0 ? `Wrong code. ${left} attempt(s) left.` : "Wrong code. Please request a new one.");
  }
  // Single use: keep only the rate-limit history.
  await store.set(key, { requests: record.requests || [] });
}

// ---- Session cookie ---------------------------------------------------------

export function createSessionCookie(email, secure = true) {
  const maxAge = config.sessionDays * 24 * 3600;
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + maxAge * 1000 })).toString("base64url");
  const token = `${payload}.${hmac(`session:${payload}`).toString("base64url")}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure = true) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function getSession(req) {
  const cookies = req.headers.get("cookie") || "";
  const match = cookies.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!match) return null;
  const [payload, sig] = match.slice(COOKIE.length + 1).split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(sig, hmac(`session:${payload}`).toString("base64url"))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.email || data.exp < Date.now()) return null;
    if (!data.email.endsWith("@" + config.emailDomain)) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

export function requireSession(req) {
  const session = getSession(req);
  if (!session) throw new HttpError(401, "Please sign in again.");
  return session;
}

// The Secure flag would stop cookies working on http://localhost during development.
export const isSecure = (req) => new URL(req.url).protocol === "https:";
