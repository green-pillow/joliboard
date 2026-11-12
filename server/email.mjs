const validAddress = value => /^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(value || '');

export function createEmailDelivery(env = process.env) {
  const debugRecipient = (env.EMAIL_DEBUG_RECIPIENT || '').trim();
  if (debugRecipient && !validAddress(debugRecipient)) throw new Error('EMAIL_DEBUG_RECIPIENT muss eine gültige einzelne E-Mail-Adresse sein.');
  const message = value => !value || !debugRecipient ? value : { ...value, originalRecipient: value.recipient || '', recipient: debugRecipient, debugRecipient };
  return {
    debugRecipient: debugRecipient || null,
    order(value) {
      return !debugRecipient ? value : { ...message(value), ...(value.discrepancyEmail ? { discrepancyEmail: message(value.discrepancyEmail) } : {}) };
    },
    draft(value) {
      const recipient = debugRecipient || value.recipient || '';
      if (!validAddress(recipient)) throw Object.assign(new Error('Bitte zuerst eine gültige Empfängeradresse hinterlegen.'), { status: 409 });
      const subject = Buffer.from(String(value.subject || '').replace(/[\r\n]/g, ' ')).toString('base64');
      const body = Buffer.from(String(value.body || '').replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
      return `To: ${recipient}\r\nSubject: =?UTF-8?B?${subject}?=\r\nX-Unsent: 1\r\n${debugRecipient ? 'X-Joliboard-Debug: 1\r\n' : ''}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}\r\n`;
    },
  };
}
