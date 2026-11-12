import { DetailPage } from './page-navigation';
import { useEffect, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import type { EmailDelivery, EmailPreview } from './types';
import type { Action } from './ProductEditor';
import { api } from './lib';

export function EmailHistory({ deliveries = [] }: { deliveries?: EmailDelivery[] }) {
  if (!deliveries.length) return null;
  const labels = { sending: 'Versand läuft', accepted: 'Vom Mailserver angenommen', failed: 'Nicht versendet', unknown: 'Versandstatus unklar' };
  return <details className="ticket-history"><summary>Versandprotokoll ({deliveries.length})</summary>{deliveries.slice().reverse().map(d => <div key={d.id}><small>{new Date(d.sentAt || d.startedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} · {d.debug ? 'Testversand' : 'Echter Versand'}</small><strong>{labels[d.status]} · {d.recipient}</strong><p>{d.subject}</p>{d.error && <p>{d.error}</p>}</div>)}</details>;
}

export default function SendEmailDialog({ orderId, kind, configured, action, onClose }: { orderId: string; kind: 'order' | 'discrepancy'; configured: boolean; action: Action; onClose: () => void }) {
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState<EmailDelivery | null>(null);
  const load = async () => { setError(''); try { setPreview(await api<EmailPreview>(`/orders/${orderId}/email-preview?kind=${kind}`)); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, [orderId, kind]);
  const accepted = result?.status === 'accepted' || preview?.previous?.status === 'accepted';
  return <DetailPage title={preview?.debug ? 'Testmail direkt senden' : 'E-Mail direkt senden'} eyebrow="EMPFÄNGER UND INHALT PRÜFEN" onClose={busy ? () => {} : onClose} wide>
    {error && <div className="notice error" role="alert">{error}</div>}
    {!preview && !error && <p>Versandvorschau wird geladen …</p>}
    {preview && <>
      {preview.debug && <div className="notice amber"><div><strong>Debugmodus: Testversand an {preview.recipient}</strong><p>Ursprünglicher Empfänger: {preview.originalRecipient || 'Nicht hinterlegt'}. Der Bestellstatus bleibt unverändert; es entsteht kein neues Lagerticket.</p></div></div>}
      {!configured && <div className="notice amber">Der Direktversand ist noch nicht eingerichtet. Hinterlege die fehlenden SMTP-Daten in .env und starte den Server neu. Den Einrichtungsstatus findest du unter „Einstellungen“.</div>}
      <dl className="execution-destination"><div><dt>Absender</dt><dd>{preview.from || 'Noch nicht eingerichtet'}</dd></div><div><dt>Einziger Empfänger</dt><dd>{preview.recipient}</dd></div></dl>
      <div className="execution-message execution-send-preview"><div><strong>{preview.subject}</strong><p>{preview.body}</p></div></div>
      {!preview.debug && <p className="execution-send-note">{kind === 'discrepancy' ? 'Die Nachricht wird direkt versendet. Die Klärung der Fehlmenge bleibt beim Einkauf.' : preview.intent === 'quote' ? 'Nach Annahme durch den Mailserver wird die Anfrage als „Angefragt“ geführt. Ein Lagerticket entsteht erst bei der späteren Bestellung.' : 'Nach Annahme durch den Mailserver wird die Bestellung als „Bestellt“ geführt und das Lagerticket erstellt.'}</p>}
      {preview.previous?.status === 'sending' && <div className="notice amber">Diese Nachricht wird gerade versendet. Bitte warten und den Status aktualisieren.</div>}
      {preview.previous?.status === 'unknown' && !accepted && <div className="notice amber"><div><p>Der letzte Versandstatus ist unklar. Prüfe den Postausgang beim Mailanbieter. Wenn die Mail dort vorhanden ist, löse keinen weiteren Versand aus.</p><label className="checkbox-field"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>Ich habe geprüft: Die Nachricht wurde nicht gesendet.</label></div></div>}
      {accepted && <div className="notice" role="status">{preview.debug ? 'Testmail vom Mailserver angenommen. Der Bestellstatus bleibt unverändert.' : 'E-Mail vom Mailserver angenommen. Das bedeutet noch keine bestätigte Zustellung im Postfach.'}</div>}
    </>}
    <footer className="detail-actions"><button className="button" disabled={busy} onClick={onClose}>{accepted ? 'Schließen' : 'Zurück'}</button>{!accepted && <><button className="button" disabled={busy} onClick={() => void load()}><RefreshCw size={15}/>Vorschau aktualisieren</button><button className="button primary" disabled={busy || !configured || !preview || preview.previous?.status === 'sending' || (preview.previous?.status === 'unknown' && !checked)} onClick={async () => {
      if (!preview) return;
      setBusy(true);
      const ok = await action(async () => { const sent = await api<{delivery: EmailDelivery}>(`/orders/${orderId}/send-email`, 'POST', { kind, fingerprint: preview.fingerprint, retryConfirmed: checked }); setResult(sent.delivery); }, preview.debug ? 'Testmail vom Mailserver angenommen.' : 'E-Mail vom Mailserver angenommen.');
      if (!ok) await load();
      setBusy(false);
    }}><Mail size={16}/>{busy ? 'Wird versendet …' : preview?.debug ? 'Testmail jetzt senden' : 'Jetzt verbindlich senden'}</button></>}</footer>
  </DetailPage>;
}
