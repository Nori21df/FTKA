const env = require("../config/env");

function getSmtpConfigStatus() {
  const missing = [];
  if (!env.smtpHost) missing.push("SMTP_HOST");
  if (!Number.isFinite(env.smtpPort) || env.smtpPort <= 0) missing.push("SMTP_PORT");
  if (!env.mailFrom) missing.push("MAIL_FROM");
  const hasAnyAuth = Boolean(env.smtpUser || env.smtpPass);
  if (hasAnyAuth && !env.smtpUser) missing.push("SMTP_USER");
  if (hasAnyAuth && !env.smtpPass) missing.push("SMTP_PASS");
  return {
    configured: missing.length === 0 && Boolean(env.smtpHost),
    missing,
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    userConfigured: Boolean(env.smtpUser),
    passConfigured: Boolean(env.smtpPass),
    fromConfigured: Boolean(env.mailFrom)
  };
}

function loadNodemailer() {
  try {
    return require("nodemailer");
  } catch (error) {
    return null;
  }
}

function createTransport() {
  const nodemailer = loadNodemailer();
  if (!nodemailer) return null;
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser || env.smtpPass ? { user: env.smtpUser, pass: env.smtpPass } : undefined
  });
}

async function sendVerificationEmail(user, verificationUrl) {
  if (env.nodeEnv !== "production") {
    console.log(`[DEV VERIFY EMAIL URL] ${verificationUrl}`);
  }

  const status = getSmtpConfigStatus();
  if (!env.smtpHost) {
    console.warn(`[email] SMTP is not configured; verification email not sent for user ${user.id}.`);
    return { sent: false, reason: "smtp_not_configured" };
  }
  if (!status.configured) {
    console.warn(`[email] SMTP config incomplete (${status.missing.join(", ")}); verification email not sent for user ${user.id}.`);
    return { sent: false, reason: "smtp_config_incomplete", missing: status.missing };
  }

  const transport = createTransport();
  if (!transport) {
    console.warn(`[email] nodemailer is not installed; verification email not sent for user ${user.id}.`);
    return { sent: false, reason: "transport_not_installed" };
  }

  try {
    const info = await transport.sendMail({
      from: env.mailFrom,
      to: user.email,
      subject: "Verify your FTKA email",
      text: `Verify your email: ${verificationUrl}\n\nThis link expires in 30 minutes.`,
      html: `<p>Verify your email:</p><p><a href="${verificationUrl}">Verify email</a></p><p>This link expires in 30 minutes.</p>`
    });
    console.log(`[email] Verification email sent for user ${user.id}; messageId=${info.messageId || "unknown"}`);
    return { sent: true, messageId: info.messageId || "" };
  } catch (error) {
    console.error(`[email] Verification email failed for user ${user.id}: ${error.message}`);
    return { sent: false, reason: "send_failed", error: error.message };
  }
}

async function sendPasswordResetEmail(user, resetUrl) {
  if (env.nodeEnv !== "production") {
    console.log(`[DEV RESET PASSWORD URL] ${resetUrl}`);
  }

  const status = getSmtpConfigStatus();
  if (!env.smtpHost) {
    console.warn(`[email] SMTP is not configured; password reset email not sent for user ${user.id}.`);
    return { sent: false, reason: "smtp_not_configured" };
  }
  if (!status.configured) {
    console.warn(`[email] SMTP config incomplete (${status.missing.join(", ")}); password reset email not sent for user ${user.id}.`);
    return { sent: false, reason: "smtp_config_incomplete", missing: status.missing };
  }

  const transport = createTransport();
  if (!transport) {
    console.warn(`[email] nodemailer is not installed; password reset email not sent for user ${user.id}.`);
    return { sent: false, reason: "transport_not_installed" };
  }

  try {
    const info = await transport.sendMail({
      from: env.mailFrom,
      to: user.email,
      subject: "Reset your FTKA password",
      text: `Reset your password: ${resetUrl}\n\nThis link expires in 30 minutes.`,
      html: `<p>Reset your password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 30 minutes.</p>`
    });
    console.log(`[email] Password reset email sent for user ${user.id}; messageId=${info.messageId || "unknown"}`);
    return { sent: true, messageId: info.messageId || "" };
  } catch (error) {
    console.error(`[email] Password reset email failed for user ${user.id}: ${error.message}`);
    return { sent: false, reason: "send_failed", error: error.message };
  }
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  getSmtpConfigStatus,
  createTransport
};