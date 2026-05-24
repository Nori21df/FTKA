const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const env = require("../src/config/env");
const { getSmtpConfigStatus, createTransport } = require("../src/services/emailService");

async function main() {
  const to = process.argv[2] || process.env.TEST_EMAIL_TO;
  const status = getSmtpConfigStatus();
  console.log("SMTP config", {
    configured: status.configured,
    missing: status.missing,
    host: status.host,
    port: status.port,
    secure: status.secure,
    userConfigured: status.userConfigured,
    passConfigured: status.passConfigured,
    fromConfigured: status.fromConfigured
  });

  if (!status.configured) {
    throw new Error(`SMTP config incomplete: ${status.missing.join(", ")}`);
  }
  if (!to) {
    throw new Error("Provide recipient: node scripts/test-email.js you@example.com or TEST_EMAIL_TO=you@example.com");
  }

  const transport = createTransport();
  if (!transport) {
    throw new Error("nodemailer is not installed. Install it to send SMTP mail: npm install nodemailer");
  }

  await transport.verify();
  await transport.sendMail({
    from: env.mailFrom,
    to,
    subject: "FTKA SMTP test",
    text: "FTKA SMTP test email. No secrets included."
  });
  console.log(`SMTP test email sent to ${to}`);
}

main().catch((error) => {
  console.error("SMTP test failed:", error.message);
  process.exit(1);
});