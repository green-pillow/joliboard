# Jolifill Einkaufsdashboard

Lokale Webanwendung für Billbee-Bestände, Bestseller, Beschaffungsplanung, Lieferanten, Bestellungen und Wareneingänge. Voraussetzung: Node.js 24 oder neuer.

## Start

```powershell
npm install
npm run dev
```

Die Anwendung läuft standardmäßig unter http://127.0.0.1:3000. `npm run build` erstellt die Produktionsdateien, `npm start` startet diese Version, `npm test` prüft die Einkaufs- und Lagerabläufe.

Kurzzeitige Verbindungsfehler und Übertragungs-Timeouts beim Billbee-Import werden pro Seite bis zu viermal versucht. Bereits geladene Seiten bleiben im laufenden Import erhalten. Schlägt die Aktualisierung vollständig fehl, bleibt die letzte vollständige Auswertung verfügbar; „Abgleich erneut starten“ wiederholt die Synchronisierung.

Zugangsdaten in `.env` hinterlegen. Nach Änderungen den Node-Server neu starten; ein Vite-Neuladen allein lädt die serverseitigen Zugangsdaten nicht neu.

```dotenv
BILLBEE_API_KEY="..."
BILLBEE_USERNAME="..."
BILLBEE_API_PASSWORD="passwort#mitsonderzeichen"
DATA_MODE=auto
```

Passwörter mit `#` in Anführungszeichen schreiben. Billbee benötigt den API-Key, den Account-Benutzernamen und das separate API-Passwort. `DATA_MODE=demo` aktiviert Beispieldaten; `live` verwendet ausschließlich den echten Datenbestand. Optional schützen `APP_USERNAME` und `APP_PASSWORD` das gesamte Dashboard per HTTP Basic Auth. Standardmäßig ist der Server nur lokal erreichbar; eine Freigabe benötigt einen passenden `APP_ORIGIN` und HTTPS.

## Bestellungen und Lager

1. Produkte einem Lieferanten und einem seiner Bestellwege zuordnen.
2. Bestellvorschläge auswählen. Pro Lieferant und Bestellweg entsteht ein eigener Entwurf: E-Mail, Händlerportal oder persönlicher Kontakt. Angebotsanfragen sind von verbindlichen Bestellungen getrennt.
3. E-Mail-Entwurf prüfen und herunterladen oder über das Händlerportal / den persönlichen Kontakt bestellen. Das Dashboard versendet keine E-Mails.
4. Nach der tatsächlichen Bestellung „Bestellung aufgegeben“ bestätigen. Genau ein Lagerticket wird angelegt.
5. Unter **Lager** die kumuliert erhaltenen Mengen erfassen, Notizen hinterlegen und Positionen abhaken. Vollständige Lieferungen abschließen.
6. Bei Fehlmengen alle Positionen prüfen und das Ticket mit Begründung an den Einkauf zurückgeben. Die Bestellung erscheint unter **Klärung**, inklusive vorbereiteter Fehlmengen-Nachricht.
7. Im Einkauf eine Nachlieferung mit neuem Termin erfassen: Dasselbe Ticket wird wieder geöffnet, bisherige Mengen und Verlauf bleiben erhalten. Alternativ die Restmenge nach Klärung stornieren.
8. Tatsächliche Wareneingänge in Billbee buchen, synchronisieren und im Lagerticket den Bestandsabgleich bestätigen. Die Lagerprüfung kann schon vorher abgeschlossen werden; noch nicht abgeglichene Wareneingänge bleiben in der Planung berücksichtigt. Es werden keine Lagerbestände automatisch nach Billbee geschrieben.

Ticketrevisionen verhindern das unbemerkte Überschreiben paralleler Änderungen. Der Verlauf protokolliert Lagerprüfung, Rückgabe, Klärung, Nachlieferung und Bestandsabgleich.

## Kundenunterlagen importieren

Die Dateien aus `orderdata/` bleiben unverändert. Der Import liest die Markdown-Notizen und die CSV-Exporte mit einer Positivliste operativer Felder; Passwortfelder und Shop-Logins werden nicht übernommen.

```powershell
node --env-file-if-exists=.env scripts/import-orderdata.mjs
node --env-file-if-exists=.env scripts/import-orderdata.mjs --apply
```

Der erste Aufruf zeigt eine Vorschau, der zweite übernimmt die Lieferanten und eindeutigen Produktzuordnungen. Bestehende Produktzuordnungen werden beibehalten. Vor der Übernahme wird eine Sicherung des Anwendungszustands in `data/` gespeichert. Der Prüfbericht liegt unter `data/orderdata-match-report.md`.

Die Zuordnung nutzt explizite Produktfamilien, Namen und die vom Kunden angegebene Nordic-Regel für SKUs mit Präfix `A`. Das Präfix `MDCEU` wird als aus dem Artikelstamm abgeleitete Zuordnung zu MDceuticals gekennzeichnet. Mehrdeutige Bezugsquellen bleiben zur Auswahl offen. Generische Hinweise wie „alle Produkte“, „Collagen“ oder „Hydro“ erzeugen keine pauschalen Produktzuordnungen. Lieferzeiten sind mangels Angaben zunächst auf vorläufige 7 Tage gesetzt und müssen vom Einkauf gepflegt werden.

SQLite-Datenbank, Sicherungen, Importberichte, Kundendateien und `.env` sind über `.gitignore` ausgeschlossen. Die importierten Lieferanten werden durch spätere Billbee-Abgleiche nicht überschrieben.

## Absatz und Priorisierung

Eine Artikelplanung speichert Lieferant, Mindestbestand und Verpackungseinheiten. Im Artikeldialog erstellt **Bestellung vorbereiten** nach dem Speichern einen Entwurf aus dem neu berechneten Bedarf und öffnet ihn direkt. Alternativ lassen sich mehrere Artikel in der Produkttabelle markieren und zusammen vorbereiten. Je Lieferant und Bestellweg entsteht ein eigener Entwurf. Bereits reservierte Mengen werden berücksichtigt. Erst die Bestätigung **Bestellung aufgegeben** nach der tatsächlichen Bestellung beim Lieferanten erzeugt das Lagerticket; E-Mails werden nicht automatisch versendet.

Bestseller zählen direkte Verkäufe im gewählten Zeitraum von 7, 30 oder 90 vollständigen Kalendertagen. Verkäufe von Sets zählen dort als Sets; für die Beschaffung werden ihre Stücklisten aufgelöst. Gelöschte, stornierte, angebotene und retournierte Aufträge werden ausgeschlossen. Tage ohne Absatz zählen zum Durchschnitt, der laufende Tag nicht.

Die Nachschubpriorität ist der voraussichtlich ungedeckte Bedarf innerhalb von Lieferzeit plus Sicherheitspuffer. Bestätigter Zulauf wirkt erst ab dem Lieferdatum. Überfällige Lieferungen verdecken keinen prognostizierten Engpass. Entwürfe reservieren Einkaufsmengen, gelten aber noch nicht als bestätigter Zulauf. Die Schätzung bildet keine Saisonalität oder historischen Fehlbestände ab.

## E-Mail-Debug

`EMAIL_DEBUG_RECIPIENT=ms@greenpillow.de` in `.env` überschreibt den Empfänger aller Bestell-, Angebots- und Fehlmengen-E-Mail-Dateien. Das gilt auch für vorhandene Entwürfe und jeden Download-Einstieg. Die Dateien werden zentral auf dem Server erstellt; Empfängerparameter vom Browser werden nicht verwendet. Die Oberfläche zeigt die aktive Testadresse und die ursprüngliche Lieferantenadresse. Lieferanten und gespeicherte Originaladressen bleiben erhalten. Zum Abschalten den Wert leeren und den Server neu starten. Es erfolgt weiterhin kein automatischer E-Mail-Versand.

## Geführte Einführung

Der Einkaufsassistent führt in 20 Schritten durch Datenquelle, Kennzahlen, Artikelplanung, Lieferanten, Entwürfe, Versandwege und Lagerprüfung. Bei einem ersten Einstieg über eine Übersicht öffnet sich die Begrüßung automatisch. Eine bereits geöffnete Detailseite wird nicht automatisch unterbrochen. Der jeweils erklärte Bereich bleibt sichtbar; die übrige Oberfläche wird weich ausgeblendet und während der Führung gegen unbeabsichtigte Eingaben gesperrt. Die Führung öffnet nur vorhandene Ansichten und erstellt, verändert oder versendet keine Geschäftsvorgänge.

Der Assistent ist unten rechts sowie über **Geführte Einführung** in der Navigation erreichbar. **Weiter**, **Zurück**, die Inhaltsübersicht, Pausieren und Überspringen steuern die Führung. **Esc** pausiert sie. Der Fortschritt wird ausschließlich im aktuellen Browser unter `joliboard:onboarding:v1` gespeichert; ohne verfügbaren Browser-Speicher funktioniert die Einführung ohne dauerhafte Erinnerung. Nach einer Unterbrechung kann sie fortgesetzt, nach Abschluss erneut gestartet werden. Auch bei fehlenden Artikeln, Bestellungen oder Lagertickets bleibt sie durchführbar.

## Navigation im Dashboard

Artikelplanung, Lieferanten, Bestellungen, Lagertickets, Versandvorschauen und Bestätigungen öffnen als eigene Detailseiten innerhalb der Anwendung. Der Wechsel erfolgt ohne Dokument-Neuladen mit einem kurzen Übergang. Die „Zurück“-Schaltfläche und Browser-Zurück/-Vorwärts nutzen die Seitenhistorie; die Produktliste mit ihrer Auswahl und Scrollposition bleibt erhalten. Detail-URLs wie `#products/product/ARTIKEL-ID` lassen sich direkt öffnen. Änderungen im Formular erzeugen keine zusätzlichen Historieneinträge. Bei reduzierter Bewegung wird die Animation deaktiviert.

## Typografie

Die gemeinsamen Größen stehen in `src/typography.css`: Rubriklabels 10 px, ergänzende Hinweise 12 px, Inhalte und Bedienung 14 px, Untertitel 16 px, Kartentitel 18 px, Abschnittstitel 20 px und Dialogtitel 24 px. Seitentitel skalieren zwischen 30 und 36 px, Kennzahlen zwischen 32 und 40 px. Auf schmalen Ansichten brechen Inhalte um; die Schrift wird nicht verkleinert. Formulareingaben verwenden mobil 16 px.
