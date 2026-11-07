// Central configuration. Everything is read from environment variables so the
// same code runs on Netlify and on a laptop (see .env.example).

const env = (name, fallback = "") => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

export const config = {
  // Only mailboxes on this domain can sign in.
  emailDomain: env("ALLOWED_EMAIL_DOMAIN", "albibiconstruction.com").toLowerCase(),

  // Used to sign session cookies and hash login codes. Must be long and random.
  sessionSecret: env("SESSION_SECRET"),
  sessionDays: Number(env("SESSION_DAYS", "30")),

  // Login codes
  codeTtlMinutes: 10,
  codeMaxAttempts: 5,
  codeMaxRequestsPer15Min: 5,

  // Email delivery (https://resend.com). EMAIL_FROM must be on a domain verified in Resend.
  resendApiKey: env("RESEND_API_KEY"),
  emailFrom: env("EMAIL_FROM", "Albibi Construction <no-reply@albibiconstruction.com>"),

  // Local development only: print login codes to the server console instead of emailing them.
  devLogin: env("ALLOW_DEV_LOGIN") === "true",

  // Claude
  anthropicModel: env("ANTHROPIC_MODEL", "claude-opus-5-5"),
  anthropicEffort: env("ANTHROPIC_EFFORT", "low"),

  // Letterhead printed on every PDF
  company: {
    name: env("COMPANY_NAME", "Albibi Construction"),
    address: env("COMPANY_ADDRESS"),
    phone: env("COMPANY_PHONE"),
    email: env("COMPANY_EMAIL", "office@albibiconstruction.com"),
    website: env("COMPANY_WEBSITE", "albibiconstruction.com"),
    license: env("COMPANY_LICENSE"),
    currency: env("CURRENCY", "USD"),
    defaultTaxRate: Number(env("DEFAULT_TAX_RATE", "0")),
    defaultTerms: env(
      "DEFAULT_TERMS",
      "Payment is due within 30 days of the invoice date. Thank you for your business."
    ),
    estimateTerms: env(
      "ESTIMATE_TERMS",
      "This estimate is valid for 30 days. Prices may change if the scope of work changes."
    ),
  },
};

export function requireSecret() {
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  }
  return config.sessionSecret;
}
