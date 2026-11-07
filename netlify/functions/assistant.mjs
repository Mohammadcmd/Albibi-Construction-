import { runAssistant } from "../lib/assistant.mjs";
import { requireSession } from "../lib/auth.mjs";
import { handler, json, readJson } from "../lib/http.mjs";

export default handler("POST", async (req) => {
  const { email } = requireSession(req);
  const { history, document } = await readJson(req);
  const result = await runAssistant({ history, document, userEmail: email });
  return json(result);
});

export const config = { path: "/api/assistant" };
