// Voorspellende voorraad op basis van aankoopgeschiedenis.
//
// Kern: het verbruik per dag wordt geschat uit de tijd tussen aankopen (wat je bij aankoop i kocht,
// is ongeveer op bij aankoop i+1). Recente intervallen tellen zwaarder mee (halfwaardetijd per model).
// Vakantiedagen tellen niet als verbruiksdagen. Correcties van de gebruiker ("op", "bijna op", "genoeg")
// zetten de geschatte voorraad op dat moment vast en sturen het verbruikstempo bij.
//
// Bewust géén schijnzekerheid: bij te weinig of te onregelmatige gegevens is de status 'onvoldoende'.

import { daysBetween, effectiveDays, addDays } from './dates.js';

export const STATUS = {
  voldoende: { id: 'voldoende', label: 'Waarschijnlijk voldoende', tone: 'good' },
  bijna: { id: 'bijna', label: 'Mogelijk bijna op', tone: 'warn' },
  op: { id: 'op', label: 'Waarschijnlijk op', tone: 'bad' },
  onvoldoende: { id: 'onvoldoende', label: 'Onvoldoende gegevens', tone: 'muted' },
};

export const MODELS = {
  snel: { label: 'Snelle verbruiksproducten', halfLife: 28, minMargin: 1, lead: 2, maxCv: 0.9 },
  houdbaar: { label: 'Houdbare producten', halfLife: 90, minMargin: 4, lead: 5, maxCv: 1.1 },
  huishoud: { label: 'Huishoudelijke producten', halfLife: 120, minMargin: 5, lead: 5, maxCv: 1.1 },
  onregelmatig: { label: 'Onregelmatige aankopen', halfLife: 60, minMargin: 3, lead: 3, maxCv: 0.6 },
};

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param {{date:string, qty:number}[]} purchases  aankopen (alle winkels)
 * @param {{date:string, level:'op'|'bijna'|'genoeg'}[]} adjustments  correcties van de gebruiker
 * @param {{model?:string, today:string, vacations?:{from:string,to:string}[]}} opts
 */
export function predictStock(purchases, adjustments, opts) {
  const { today, vacations = [] } = opts;
  const model = MODELS[opts.model] || MODELS.snel;

  // Aankopen per dag samenvoegen (meerdere bonnen op één dag = één aankoopmoment).
  const byDate = new Map();
  for (const p of purchases) {
    if (!p.date || !(p.qty > 0) || p.date > today) continue;
    byDate.set(p.date, (byDate.get(p.date) || 0) + p.qty);
  }
  const events = [...byDate.entries()].map(([date, qty]) => ({ date, qty })).sort((a, b) => a.date.localeCompare(b.date));
  const base = { model: opts.model || 'snel', purchases: events.length, lastPurchase: events.at(-1)?.date || null };

  if (events.length < 3) {
    return { ...base, status: STATUS.onvoldoende, reason: events.length ? `Pas ${events.length}× gekocht; minimaal 3 aankopen nodig.` : 'Nog niet gekocht.' };
  }
  const span = effectiveDays(events[0].date, events.at(-1).date, vacations);
  if (span < 10) {
    return { ...base, status: STATUS.onvoldoende, reason: 'Aankopen liggen te dicht bij elkaar om verbruik te schatten.' };
  }

  const intervals = [];
  for (let i = 1; i < events.length; i++) {
    const d = effectiveDays(events[i - 1].date, events[i].date, vacations);
    if (d <= 0) continue;
    intervals.push({ days: d, qty: events[i - 1].qty, end: events[i].date });
  }
  const typicalQty = median(events.map((e) => e.qty));
  const meanInterval = intervals.reduce((t, x) => t + x.days, 0) / intervals.length;
  const sd = Math.sqrt(intervals.reduce((t, x) => t + (x.days - meanInterval) ** 2, 0) / intervals.length);
  const cv = meanInterval ? sd / meanInterval : 0;

  // Gewogen verbruikstempo (eenheden per dag)
  let wq = 0;
  let wd = 0;
  for (const it of intervals) {
    const age = Math.max(0, daysBetween(it.end, today));
    const w = Math.pow(0.5, age / model.halfLife);
    wq += w * it.qty;
    wd += w * it.days;
  }
  let rate = wd > 0 ? wq / wd : 0;
  if (!(rate > 0)) {
    return { ...base, status: STATUS.onvoldoende, reason: 'Verbruik kon niet geschat worden.' };
  }

  // Correcties verwerken: tempo bijsturen en voorraad vastzetten.
  const sortedAdj = [...(adjustments || [])].filter((a) => a.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const timeline = [
    ...events.map((e) => ({ type: 'buy', date: e.date, qty: e.qty })),
    ...sortedAdj.map((a) => ({ type: 'adj', date: a.date, level: a.level })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'buy' ? -1 : 1));

  const levelValue = (level, current) => level === 'op' ? 0 : level === 'bijna' ? 0.2 * typicalQty : Math.max(current, 0.6 * typicalQty);
  let stock = 0;
  let last = timeline[0].date;
  let stockAfterLastBuy = 0;
  let lastBuyDate = null;
  let adjustedRate = rate;
  let learnedFrom = 0;
  let lastAdjLevel = null; // laatste correctie ná de laatste aankoop
  for (const ev of timeline) {
    const d = effectiveDays(last, ev.date, vacations);
    stock = Math.max(0, stock - adjustedRate * d);
    if (ev.type === 'buy') {
      stock += ev.qty;
      stockAfterLastBuy = stock;
      lastAdjLevel = null;
      lastBuyDate = ev.date;
    } else {
      // Leren: welk tempo past bij deze waarneming sinds de laatste aankoop?
      const since = lastBuyDate ? effectiveDays(lastBuyDate, ev.date, vacations) : 0;
      const target = levelValue(ev.level, stock);
      if (since >= 2 && stockAfterLastBuy > 0) {
        const implied = Math.max(0, (stockAfterLastBuy - target) / since);
        const plausible = implied > 0 && implied < adjustedRate * 4;
        if (plausible && !(ev.level === 'genoeg' && stock >= target)) {
          adjustedRate = adjustedRate * 0.5 + implied * 0.5;
          learnedFrom++;
        }
      }
      stock = target;
      lastAdjLevel = ev.level;
      stockAfterLastBuy = Math.max(stock, 0.0001);
      lastBuyDate = ev.date;
    }
    last = ev.date;
  }
  rate = adjustedRate;

  // Voorraad opnieuw opbouwen vanaf de 5e-laatste aankoop (aanname: toen was het ongeveer op).
  // Zo stapelen kleine afwijkingen in het tempo zich niet maandenlang op; het tempo zelf is
  // hierboven wél uit de hele historie geleerd.
  const startDate = events[Math.max(0, events.length - 5)].date;
  stock = 0;
  last = startDate;
  lastAdjLevel = null;
  for (const ev of timeline) {
    if (ev.date < startDate) continue;
    const d = effectiveDays(last, ev.date, vacations);
    stock = Math.max(0, stock - rate * d);
    if (ev.type === 'buy') { stock += ev.qty; lastAdjLevel = null; } else { stock = levelValue(ev.level, stock); lastAdjLevel = ev.level; }
    last = ev.date;
  }

  const elapsed = effectiveDays(last, today, vacations);
  const projected = stock - rate * elapsed; // mag negatief worden: "zou al x dagen op zijn"
  const daysLeft = projected / rate;
  const margin = Math.max(model.minMargin, cv * meanInterval * 0.5);

  if (cv > model.maxCv && learnedFrom === 0) {
    return {
      ...base, status: STATUS.onvoldoende, ratePerDay: rate, meanInterval, cv, typicalQty,
      reason: 'Aankopen zijn te onregelmatig voor een betrouwbare voorspelling.',
    };
  }
  // Lang niet meer gekocht én al ruim "op": waarschijnlijk veranderd gedrag, geen harde uitspraak.
  const sinceLastBuy = effectiveDays(events.at(-1).date, today, vacations);
  if (daysLeft < -Math.max(3 * meanInterval, 21) && sinceLastBuy > 3 * meanInterval) {
    return {
      ...base, status: STATUS.onvoldoende, ratePerDay: rate, meanInterval, cv, typicalQty,
      reason: `Al ${sinceLastBuy} dagen niet gekocht; mogelijk koopt u dit niet meer of elders.`,
    };
  }

  let status;
  if (lastAdjLevel === 'op') status = STATUS.op; // gebruiker gaf zelf aan: op (tot de volgende aankoop)
  else if (daysLeft > margin + model.lead) status = STATUS.voldoende;
  else if (daysLeft > -margin) status = STATUS.bijna;
  else status = STATUS.op;

  return {
    ...base,
    status,
    ratePerDay: rate,
    perWeek: rate * 7,
    estimatedStock: Math.max(0, projected),
    daysLeft,
    margin,
    meanInterval,
    cv,
    typicalQty,
    learnedFrom,
    expectedEmpty: addDays(today, Math.round(daysLeft)),
    confidence: cv < 0.35 && events.length >= 5 ? 'redelijk' : 'laag',
  };
}

/** Of een product binnen `days` dagen waarschijnlijk nodig is. */
export function neededWithin(prediction, days) {
  if (!prediction || prediction.status.id === 'onvoldoende') return false;
  if (prediction.status.id !== 'voldoende') return true;
  return prediction.daysLeft - prediction.margin <= days;
}
