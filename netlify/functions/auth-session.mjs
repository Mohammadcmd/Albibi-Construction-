import { getSession } from "../lib/auth.mjs";
import { config as appConfig } from "../lib/config.mjs";
import { handler, json } from "../lib/http.mjs";

export default handler("GET", async (req) => {
  const session = getSession(req);
  if (!session) return json({ error: "Not signed in" }, 401);
  const c = appConfig.company;
  return json({
    email: session.email,
    company: { name: c.name, currency: c.currency, defaultTaxRate: c.defaultTaxRate },
  });
});

export const config = { path: "/api/auth/session" };
