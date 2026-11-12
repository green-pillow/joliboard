import nodemailer from 'nodemailer';
const address = value => /^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(value || '');
export function createSmtpSender(env = process.env, factory = nodemailer.createTransport) {
  const host = (env.SMTP_HOST || '').trim();
  const from = (env.EMAIL_FROM || '').trim();
  const fromName = (env.EMAIL_FROM_NAME || 'Jolifill Einkauf').replace(/[\r\n]/g, ' ').trim();
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'].filter(key => !env[key]);
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT muss zwischen 1 und 65535 liegen.');
  if (env.SMTP_SECURE && !['true', 'false'].includes(env.SMTP_SECURE)) throw new Error('SMTP_SECURE muss true oder false sein.');
  if (from && !address(from)) throw new Error('EMAIL_FROM muss eine einzelne E-Mail-Adresse sein.');
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
  const status = { configured: missing.length === 0, missing, from, fromName };
  let transport;
  function connection() {
    if (!status.configured) throw Object.assign(new Error('Direktversand noch nicht eingerichtet. Bitte die SMTP-Daten in .env hinterlegen und den Server neu starten.'), { status: 503 });
    return transport ||= factory({ host, port, secure, requireTLS: !secure, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
  }
  return { status,
    async verify() { await connection().verify(); },
    async send(message) {
      if (!address(message.recipient)) throw Object.assign(new Error('Ungültiger E-Mail-Empfänger.'), { status: 400 });
      const result = await connection().sendMail({ from: { name: fromName, address: from }, to: { address: message.recipient }, envelope: { from, to: [message.recipient] }, subject: message.subject, text: message.body, messageId: message.messageId, headers: message.debug ? { 'X-Joliboard-Debug': '1' } : {}, disableFileAccess: true, disableUrlAccess: true });
      if (!result.accepted?.some(value => String(value).toLowerCase() === message.recipient.toLowerCase()) || result.rejected?.length) throw Object.assign(new Error('Der Mailserver hat den Empfänger abgelehnt.'), { code: 'EENVELOPE', responseCode: 550 });
      return { messageId: result.messageId || message.messageId };
    },
  };
}
