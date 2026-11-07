import { createSessionCookie, isSecure, normalizeEmail, verifyLoginCode } from "../lib/auth.mjs";
import { handler, json, readJson } from "../lib/http.mjs";

export default handler("POST", async (req) => {
  const { username, code } = await readJson(req);
  const email = normalizeEmail(username);
  await verifyLoginCode(email, code);
  return json({ ok: true, email }, 200, { "set-cookie": createSessionCookie(email, isSecure(req)) });
});

export const config = { path: "/api/auth/verify" };
