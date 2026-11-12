const calendarDay = day => Date.parse(`${day}T00:00:00Z`) / 86400000;

// A linear planning estimate in units, deliberately not an opaque 0–100 score.
// Confirmed arrivals can cover future demand, never a shortage before their ETA.
export function replenishmentRisk({ stock, stockKnown = true, avg, leadDays, safetyDays, arrivals = [], asOf, complete = true, bundle = false }) {
  const horizonDays = leadDays + safetyDays;
  const start = calendarDay(asOf);
  const overdueIncoming = arrivals.filter(a => calendarDay(a.expectedAt) < start).reduce((sum, a) => sum + a.quantity, 0);
  if (!complete || !stockKnown || bundle || !Number.isFinite(start)) return { atRiskUnits: null, gapDays: null, horizonDays, overdueIncoming };
  let available = Math.max(0, stock);
  let shortage = Math.max(0, -stock);
  let time = 0;
  const events = arrivals.map(a => ({ day: calendarDay(a.expectedAt) - start, quantity: a.quantity }))
    .filter(a => a.day >= 0 && a.day < horizonDays && a.quantity > 0).sort((a, b) => a.day - b.day);
  for (const event of [...events, { day: horizonDays, quantity: 0 }]) {
    const demand = avg * (event.day - time);
    shortage += Math.max(0, demand - available);
    available = Math.max(0, available - demand) + event.quantity;
    time = event.day;
  }
  // Tolerate floating point residues without rounding small positive demand away.
  const atRiskUnits = shortage < 1e-9 ? 0 : Number(shortage.toFixed(4));
  return { atRiskUnits, gapDays: avg > 0 ? Math.max(0, atRiskUnits - Math.max(0, -stock)) / avg : 0, horizonDays, overdueIncoming };
}
