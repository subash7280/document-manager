import nodemailer from 'nodemailer';

// ==================================================================
// EMAIL SENDING (SMTP)
// Uses the SMTP_* settings from .env (see .env.example). Returns null
// when SMTP is not set up; callers then print to the console instead.
// Tests pass their own fake mailer with the same { send } shape.
// ==================================================================
export function createMailer(smtp) {
  if (!smtp) return null;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure, // true = TLS from the start (port 465); false = STARTTLS (587)
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 10 * 1000,
    greetingTimeout: 10 * 1000
  });
  return {
    // message: { to, subject, text, html }
    send: (message) => transport.sendMail({ from: smtp.from, ...message })
  };
}
