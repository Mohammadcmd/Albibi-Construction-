// Email delivery through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
import { config } from "./config.mjs";
import { HttpError } from "./http.mjs";

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function send(message) {
  if (!config.resendApiKey) {
    if (config.devLogin) {
      console.log("\n[dev email] to:", message.to, "\nsubject:", message.subject, "\n" + message.text + "\n");
      return { dev: true };
    }
    throw new HttpError(500, "Email is not set up yet (RESEND_API_KEY is missing).");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.emailFrom, ...message }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, await res.text());
    throw new HttpError(502, "The email could not be sent. Please try again.");
  }
  return res.json();
}

export function sendLoginCode(to, code) {
  const name = config.company.name;
  return send({
    to: [to],
    subject: `${code} is your ${name} sign-in code`,
    text: `Your ${name} sign-in code is ${code}\n\nIt expires in ${config.codeTtlMinutes} minutes. If you did not try to sign in, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#1b2a3a">
      <h2 style="margin:0 0 12px">${escapeHtml(name)}</h2>
      <p>Your sign-in code is:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0">${code}</p>
      <p style="color:#5b6b7b;font-size:13px">It expires in ${config.codeTtlMinutes} minutes. If you did not try to sign in, you can ignore this email.</p>
    </div>`,
  });
}

export function sendDocument({ to, cc, replyTo, subject, message, filename, pdf }) {
  const html = `<div style="font-family:Arial,sans-serif;color:#1b2a3a;white-space:pre-wrap">${escapeHtml(message)}</div>`;
  return send({
    to,
    ...(cc?.length ? { cc } : {}),
    reply_to: replyTo,
    subject,
    text: message,
    html,
    attachments: [{ filename, content: Buffer.from(pdf).toString("base64") }],
  });
}
