// Small helpers shared by every function.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export async function readJson(req, maxBytes = 200_000) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request is too large.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

// Wraps a handler: enforces the HTTP method and turns thrown errors into JSON responses.
export function handler(method, fn) {
  return async (req, context) => {
    if (req.method !== method) return json({ error: "Method not allowed" }, 405);
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong on our side. Please try again." }, 500);
    }
  };
}
