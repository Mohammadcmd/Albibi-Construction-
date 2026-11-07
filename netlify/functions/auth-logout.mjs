import { clearSessionCookie, isSecure } from "../lib/auth.mjs";
import { handler, json } from "../lib/http.mjs";

export default handler("POST", async (req) => json({ ok: true }, 200, { "set-cookie": clearSessionCookie(isSecure(req)) }));

export const config = { path: "/api/auth/logout" };
