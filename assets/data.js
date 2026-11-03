// Formatting and series math. Dates are "YYYY-MM" strings throughout.

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const ym = (s) => ({ y: +s.slice(0, 4), m: +s.slice(5, 7) });
export const monthIndex = (s) => { const { y, m } = ym(s); return y * 12 + m - 1; };
export const fromIndex = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
export const addMonths = (s, n) => fromIndex(monthIndex(s) + n);

/** Period label. style: 'short' (ago 2026), 'long' (agosto de 2026), 'tick' (ago 26). */
export function periodLabel(date, freq = 'M', style = 'short') {
  const { y, m } = ym(date);
  if (freq === 'A') return String(y);
  if (freq === 'Q') {
    const q = Math.floor((m - 1) / 3) + 1;
    return style === 'long' ? `${q}.º trimestre de ${y}` : `${q}.º trim. ${y}`;
  }
  if (freq === 'S') {
    const s = m <= 6 ? 1 : 2;
    const ord = s === 1 ? '1.er' : '2.º';
    return style === 'long' ? `${ord} semestre de ${y}` : `${ord} sem. ${y}`;
  }
  if (style === 'long') return `${MONTHS[m - 1]} de ${y}`;
  if (style === 'tick') return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
  if (style === 'month') return MONTHS[m - 1];
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

const nf = (min, max) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: min, maximumFractionDigits: max });
const NF0 = nf(0, 0), NF1 = nf(1, 1), NF2 = nf(2, 2);

export const fmt = {
  int: (v) => NF0.format(v),
  dec1: (v) => NF1.format(v),
  pct: (v, d = 1) => `${(d === 2 ? NF2 : d === 0 ? NF0 : NF1).format(v)} %`,
  signedPct: (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${(d === 2 ? NF2 : NF1).format(Math.abs(v))} %`,
  pp: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${NF1.format(Math.abs(v))} p.p.`,
  pesos: (v) => `$ ${NF0.format(Math.round(v))}`,
  /** Compact pesos for tiles: $ 1,61 M, $ 519.578 */
  pesosCompact: (v) => (Math.abs(v) >= 1e6 ? `$ ${NF2.format(v / 1e6)} M` : `$ ${NF0.format(Math.round(v))}`),
  usdM: (v) => `US$ ${NF0.format(Math.round(v))} M`,
  usdMCompact: (v) => (Math.abs(v) >= 1000 ? `US$ ${NF1.format(v / 1000)} mil M` : `US$ ${NF0.format(Math.round(v))} M`),
  signedUsdM: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}US$ ${NF0.format(Math.abs(Math.round(v)))} M`,
  index: (v) => NF1.format(v),
  num: (v) => (Math.abs(v) >= 100 ? NF0.format(v) : NF1.format(v)),
  /** Axis ticks: full under 10.000, compact above. */
  axis: (v) => (Math.abs(v) >= 1e6 ? `${nf(0, 1).format(v / 1e6)} M` : Math.abs(v) >= 10000 ? `${NF0.format(v / 1000)} mil` : nf(0, 1).format(v)),
};

/** Value of a series at a date, or undefined. Series data is [[date, v], ...]. */
export function at(data, date) {
  const map = data._map || (data._map = new Map(data));
  return map.get(date);
}
export const last = (data) => data[data.length - 1];

/** Percent change against `months` earlier (1 = monthly, 12 = year on year). */
export function change(data, months) {
  const out = [];
  for (const [d, v] of data) {
    const prev = at(data, addMonths(d, -months));
    if (prev !== undefined && prev !== 0) out.push([d, (v / prev - 1) * 100]);
  }
  return out;
}
/** Difference in units (percentage points for rates) against `months` earlier. */
export function diff(data, months) {
  const out = [];
  for (const [d, v] of data) {
    const prev = at(data, addMonths(d, -months));
    if (prev !== undefined) out.push([d, v - prev]);
  }
  return out;
}
/** Change since December of the previous year. */
export function ytd(data) {
  const out = [];
  for (const [d, v] of data) {
    const base = at(data, `${ym(d).y - 1}-12`);
    if (base !== undefined) out.push([d, (v / base - 1) * 100]);
  }
  return out;
}
/** Rolling sum over `n` consecutive months. */
export function rollingSum(data, n) {
  const out = [];
  for (const [d] of data) {
    let s = 0, ok = true;
    for (let k = 0; k < n; k++) { const v = at(data, addMonths(d, -k)); if (v === undefined) { ok = false; break; } s += v; }
    if (ok) out.push([d, s]);
  }
  return out;
}
/** Keeps the points inside the last `months` months (inclusive of the latest). */
export function lastMonths(data, months) {
  if (!months || !data.length) return data;
  const from = addMonths(last(data)[0], -(months - 1));
  return data.filter(([d]) => d >= from);
}

/**
 * Adult-equivalent unit table used by INDEC to scale the basic baskets to a
 * household (Metodología INDEC N.º 22). [age from, age to, varón, mujer]
 */
export const ADULT_EQUIVALENT = [
  [0, 0, 0.35, 0.35], [1, 1, 0.37, 0.37], [2, 2, 0.46, 0.46], [3, 3, 0.51, 0.51],
  [4, 4, 0.55, 0.55], [5, 5, 0.60, 0.60], [6, 6, 0.64, 0.64], [7, 7, 0.66, 0.66],
  [8, 8, 0.68, 0.68], [9, 9, 0.69, 0.69], [10, 10, 0.79, 0.70], [11, 11, 0.82, 0.72],
  [12, 12, 0.85, 0.74], [13, 13, 0.90, 0.76], [14, 14, 0.96, 0.76], [15, 15, 1.00, 0.77],
  [16, 16, 1.03, 0.77], [17, 17, 1.04, 0.77], [18, 29, 1.02, 0.76], [30, 45, 1.00, 0.77],
  [46, 60, 1.00, 0.76], [61, 75, 0.83, 0.67], [76, 130, 0.74, 0.63],
];
export function adultEquivalent(age, sex) {
  const row = ADULT_EQUIVALENT.find(([a, b]) => age >= a && age <= b) ?? ADULT_EQUIVALENT[ADULT_EQUIVALENT.length - 1];
  return sex === 'm' ? row[3] : row[2];
}
