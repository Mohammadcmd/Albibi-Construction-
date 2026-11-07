import { createLoginCode, normalizeEmail } from "../lib/auth.mjs";
import { sendLoginCode } from "../lib/email.mjs";
import { handler, json, readJson } from "../lib/http.mjs";

export default handler("POST", async (req) => {
  const { username } = await readJson(req);
  const email = normalizeEmail(username);
  const code = await createLoginCode(email);
  await sendLoginCode(email, code);
  return json({ ok: true, email });
});

export const config = { path: "/api/auth/request" };
