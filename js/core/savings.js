// Besparingsadviseur. Elk advies heeft een onderbouwing en een soort:
//   'gerealiseerd'  = feitelijk bespaard (kortingen op bonnen)
//   'theoretisch'   = schatting als u iets anders gaat doen
// Er wordt alleen een bedrag berekend als er genoeg gegevens zijn.

import { addDays, daysBetween } from './dates.js';
import { groupBy, priceHistory, priceIncreases, inRange, total } from './analytics.js';
import { categoryName } from './categories.js';

const DAYS_PER_MONTH = 30.44;

function monthsCovered(facts, from, to) {
  const first = facts.reduce((m, f) => (!m || f.date < m ? f.date : m), null);
  if (!first) return 0;
  const start = first > from ? first : from;
  return Math.max(0, (daysBetween(start, to) + 1) / DAYS_PER_MONTH);
}

/**
 * @param {object[]} facts
 * @param {Map<string, object>} products
 * @param {string} today
 * @param {{ predictions?: Map<string, object> }} extra
 */
export function savingsAdvice(facts, products, today, extra = {}) {
  const from = addDays(today, -180);
  const window = inRange(facts, from, today);
  const months = monthsCovered(facts, from, today);
  const advice = [];
  const realized = { discounts: 0, months: 0 };

  // 1. Gerealiseerd: kortingen in de afgelopen 180 dagen.
  realized.discounts = -window.reduce((t, f) => t + Math.min(0, f.discount) + (f.category === 'korting' ? f.net : 0), 0);
  // Online facturen (AH) vermelden het voordeel apart; het zit al in de artikelprijzen verwerkt.
  realized.reported = (extra.receipts || []).filter((r) => r.date >= from && r.date <= today && r.reportedSavings).reduce((t, r) => t + r.reportedSavings, 0);
  realized.discounts += realized.reported;
  realized.months = months;

  if (months < 1) {
    return { advice, realized, enoughData: false, reason: 'Minimaal één maand aan bonnen nodig voor besparingsadvies.' };
  }

  const byProduct = groupBy(window.filter((f) => f.productId && f.gross > 0), (f) => f.productId);

  for (const g of byProduct) {
    const product = products.get(g.key);
    if (!product) continue;
    const hist = priceHistory(g.facts, g.key);
    const perMonthCount = g.count / months;

    // 2. Huismerk / goedkoper alternatief uit eigen aankopen (zelfde basisproduct, vergelijkbare eenheidsprijs).
    const withBase = hist.filter((h) => h.perBaseNormal != null && !h.normalUnknown);
    if (withBase.length >= 3) {
      const byBrand = new Map();
      for (const h of withBase) {
        const k = h.brand || 'onbekend';
        if (!byBrand.has(k)) byBrand.set(k, []);
        byBrand.get(k).push(h);
      }
      if (byBrand.size >= 2) {
        const stats = [...byBrand.entries()].map(([brand, rows]) => {
          const amount = rows.reduce((t, r) => t + r.qty * (r.weighed ? 1000 : (r.sizeAmount || 0)), 0);
          const avgBase = rows.reduce((t, r) => t + r.perBaseNormal, 0) / rows.length;
          return { brand, rows, amount, avgBase, house: rows[0].house };
        });
        stats.sort((a, b) => a.avgBase - b.avgBase);
        const cheapest = stats[0];
        for (const s of stats.slice(1)) {
          if (s.rows.length < 2) continue;
          const diff = s.avgBase - cheapest.avgBase; // centen per kilo/liter/stuk
          if (diff / s.avgBase < 0.1) continue;
          const unitIsPiece = s.rows[0].sizeUnit === 'st' && !s.rows[0].weighed;
          const baseAmountPerMonth = (unitIsPiece ? s.amount : s.amount / 1000) / months;
          const monthly = Math.round(diff * baseAmountPerMonth);
          if (monthly < 50) continue;
          advice.push({
            type: 'alternatief', kind: 'theoretisch', productId: product.id, monthly,
            title: `${product.name}: kies vaker ${cheapest.brand}`,
            explanation: `U kocht ${s.rows.length}× ${s.brand} (gem. ${fmt(s.avgBase)} per ${unitWord(s.rows[0])}) en ${cheapest.rows.length}× ${cheapest.brand} (gem. ${fmt(cheapest.avgBase)}). Overstappen bij gelijk verbruik scheelt naar schatting ${fmt(monthly)} per maand.`,
            confidence: s.rows.length + cheapest.rows.length >= 6 ? 'redelijk' : 'laag',
          });
        }
      }
    }

    // 3. Vaak gekocht zonder korting, terwijl het product wel vaak in de aanbieding is.
    if (hist.length >= 6) {
      const promo = hist.filter((h) => h.discounted && !h.normalUnknown && h.paidPerUnit < h.normalPerUnit);
      const regular = hist.filter((h) => !h.discounted);
      const knownPct = promo.length >= 2;
      if (promo.length >= 2 && regular.length >= 3) {
        const avgPromoPct = promo.reduce((t, h) => t + (h.normalPerUnit - h.paidPerUnit) / h.normalPerUnit, 0) / promo.length;
        const regularSpendPerMonth = regular.reduce((t, h) => t + h.normalPerUnit * h.qty, 0) / months;
        // Realistisch: hooguit de helft van de normale aankopen is te verschuiven naar een actieweek.
        const monthly = Math.round(regularSpendPerMonth * avgPromoPct * 0.5);
        if (monthly >= 50) {
          advice.push({
            type: 'aanbieding', kind: 'theoretisch', productId: product.id, monthly,
            title: `${product.name}: vaker in de aanbieding kopen`,
            explanation: `${regular.length} van ${hist.length} aankopen waren zonder korting. In de aanbieding betaalde u gemiddeld ${Math.round(avgPromoPct * 100)}% minder. Als de helft van de normale aankopen in een actieweek valt (en u dan inslaat), scheelt dat ongeveer ${fmt(monthly)} per maand.`,
            confidence: 'laag',
          });
        }
      }
    }

    // 4. Terugkerende dure gewoonte: snacks/dranken ≥ 2× per maand en ≥ €15 per maand.
    if ((product.category === 'snacks' || product.category === 'dranken') && perMonthCount >= 2) {
      const perMonth = g.net / months;
      if (perMonth >= 1500) {
        advice.push({
          type: 'gewoonte', kind: 'inzicht', productId: product.id, monthly: null,
          title: `${product.name}: ${fmt(Math.round(perMonth))} per maand`,
          explanation: `Gemiddeld ${perMonthCount.toFixed(1).replace('.', ',')}× per maand gekocht (${categoryName(product.category).toLowerCase()}). Dit is een keuze, geen fout; halveren scheelt ${fmt(Math.round(perMonth / 2))} per maand.`,
          confidence: 'feit',
        });
      }
    }

    // 5. Mogelijke overvoorraad (uit voorraadmodel).
    const pred = extra.predictions?.get(product.id);
    if (pred && pred.status?.id === 'voldoende' && pred.estimatedStock > 3 * pred.typicalQty && pred.perWeek > 0 && pred.daysLeft > 60) {
      advice.push({
        type: 'overvoorraad', kind: 'inzicht', productId: product.id, monthly: null,
        title: `${product.name}: mogelijk overvoorraad`,
        explanation: `Geschatte voorraad ±${pred.estimatedStock.toFixed(0)} stuks; bij uw verbruik is dat ruim ${Math.round(pred.daysLeft)} dagen. Even niet kopen houdt geld vrij.`,
        confidence: 'schatting',
      });
    }
  }

  // 6. Prijsstijgingen
  for (const inc of priceIncreases(facts, products, today).slice(0, 10)) {
    const g = byProduct.find((x) => x.key === inc.productId);
    const perMonthQty = g ? g.qty / months : 0;
    advice.push({
      type: 'prijsstijging', kind: 'inzicht', productId: inc.productId, monthly: null,
      title: `${inc.name}${inc.brand ? ` (${inc.brand})` : ''}: +${Math.round(inc.change * 100)}%`,
      explanation: `Normale prijs steeg van ${fmt(inc.before)} naar ${fmt(inc.after)}${inc.perBase ? ' per kilo/liter/stuk' : ' per stuk'} (mediaan, ${inc.samples} aankopen).`
        + (!inc.perBase && perMonthQty >= 1 ? ` Bij uw verbruik is dat ±${fmt(Math.round((inc.after - inc.before) * perMonthQty))} extra per maand.` : ''),
      confidence: 'feit',
    });
  }

  // 7. Categorieën die deze periode duidelijk boven het eigen gemiddelde liggen.
  const recentFrom = addDays(today, -30);
  const recent = inRange(facts, recentFrom, today);
  const prev = inRange(facts, addDays(today, -180), addDays(recentFrom, -1));
  const prevMonths = monthsCovered(prev, addDays(today, -180), addDays(recentFrom, -1));
  if (prevMonths >= 2) {
    const prevByCat = new Map(groupBy(prev, (f) => f.category).map((g) => [g.key, g.net / prevMonths]));
    for (const g of groupBy(recent, (f) => f.category)) {
      const avg = prevByCat.get(g.key);
      if (!avg || g.key === 'korting') continue;
      const ratio = g.net / avg;
      if (ratio >= 1.3 && g.net - avg >= 2000) {
        advice.push({
          type: 'categorie', kind: 'inzicht', category: g.key, monthly: null,
          title: `${categoryName(g.key)}: ${Math.round((ratio - 1) * 100)}% boven uw gemiddelde`,
          explanation: `Afgelopen 30 dagen ${fmt(g.net)}, tegen gemiddeld ${fmt(Math.round(avg))} per maand daarvoor.`,
          confidence: 'feit',
        });
      }
    }
  }

  advice.sort((a, b) => (b.monthly || 0) - (a.monthly || 0));
  const theoreticalMonthly = advice.filter((a) => a.kind === 'theoretisch').reduce((t, a) => t + a.monthly, 0);
  return { advice, realized, enoughData: true, theoreticalMonthly, months };
}

/** Meest gekochte producten (aantal aankopen) in de laatste 180 dagen. */
export function frequentProducts(facts, products, today, limit = 10) {
  const window = inRange(facts, addDays(today, -180), today).filter((f) => f.productId && f.gross > 0);
  return groupBy(window, (f) => f.productId)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((g) => ({ productId: g.key, name: products.get(g.key)?.name || g.facts[0].name, count: g.count, net: g.net }));
}

function unitWord(row) {
  if (row.weighed) return 'kilo';
  return row.sizeUnit === 'ml' ? 'liter' : row.sizeUnit === 'g' ? 'kilo' : 'stuk';
}

function fmt(cents) {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export { total };
