// Hand-built SVG/HTML charts. Specs follow one system:
// 2px lines, <=24px bars with a 4px rounded data end, hairline solid grid,
// one shared tooltip per figure, a table view for every chart, text in ink
// tokens (never in series colors).

import { monthIndex, fromIndex, periodLabel, fmt } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
export const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) n.style.setProperty(p, val); else n.style[p] = val; }
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return n;
};

/** Clean tick values covering [min, max]. */
function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

const textWidth = (() => {
  let ctx;
  return (text, font = '500 12px "Encode Sans", system-ui, sans-serif') => {
    ctx ??= document.createElement('canvas').getContext('2d');
    ctx.font = font;
    return ctx.measureText(text).width;
  };
})();

// ------------------------------------------------------------------ figure
/**
 * Card shell shared by every chart: title, optional subtitle, legend slot,
 * plot slot, source line and a "Ver tabla" toggle that reveals the table twin.
 */
export function figure({ title, subtitle, source, table, wide, className }) {
  const plot = h('div', { class: 'plot' });
  const legend = h('div', { class: 'legend', hidden: true });
  const tooltip = h('div', { class: 'tooltip', role: 'status', hidden: true });
  const tableWrap = h('div', { class: 'table-wrap', hidden: true });
  const tableBtn = table
    ? h('button', {
        class: 'linkish', type: 'button', 'aria-expanded': 'false',
        onclick: (e) => {
          const open = tableWrap.hidden;
          tableWrap.hidden = !open;
          e.currentTarget.setAttribute('aria-expanded', String(open));
          e.currentTarget.textContent = open ? 'Ocultar tabla' : 'Ver tabla';
          if (open && !tableWrap.firstChild) tableWrap.append(buildTable(table()));
        },
      }, 'Ver tabla')
    : null;
  const node = h('figure', { class: `card fig${wide ? ' wide' : ''}${className ? ` ${className}` : ''}` },
    h('header', { class: 'fig-head' },
      h('h3', { text: title }),
      subtitle ? h('p', { class: 'fig-sub', text: subtitle }) : null),
    legend,
    h('div', { class: 'plot-wrap' }, plot, tooltip),
    h('figcaption', { class: 'fig-foot' }, h('span', { class: 'source', text: source ?? '' }), tableBtn),
    tableWrap);
  return { node, plot, legend, tooltip, refreshTable: () => { if (!tableWrap.hidden) { tableWrap.replaceChildren(buildTable(table())); } else tableWrap.replaceChildren(); } };
}

function buildTable({ columns, rows }) {
  return h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c, i) => h('th', { scope: 'col', class: i ? 'num' : '', text: c })))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => (i ? h('td', { class: 'num', text: c }) : h('th', { scope: 'row', text: c })))))));
}

export function setLegend(legendEl, items, kind = 'line') {
  legendEl.hidden = items.length < 2;
  legendEl.replaceChildren(...items.map((it) => h('span', { class: 'key' },
    h('i', { class: `swatch ${kind}`, style: { '--c': `var(${it.color})` } }), it.label)));
}

function showTip(fig, x, y, content, plotRect) {
  const tip = fig.tooltip;
  tip.replaceChildren(...content);
  tip.hidden = false;
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  const W = plotRect.width;
  let left = x + 14;
  if (left + w > W) left = x - w - 14;
  if (left < 0) left = Math.max(0, Math.min(W - w, x - w / 2));
  let top = Math.max(0, y - hgt - 10);
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
const hideTip = (fig) => { fig.tooltip.hidden = true; };
const tipRow = (color, value, label, kind = 'line') => h('div', { class: 'tip-row' },
  h('i', { class: `swatch ${kind}`, style: { '--c': `var(${color})` } }),
  h('strong', { text: value }), h('span', { text: label }));

/** Re-renders `draw(width)` whenever the plot's width changes. */
function responsive(plot, draw) {
  let lastW = 0;
  const run = () => {
    const w = Math.round(plot.clientWidth);
    if (!w || w === lastW) return;
    lastW = w;
    draw(w);
  };
  new ResizeObserver(run).observe(plot);
  requestAnimationFrame(run);
}

// --------------------------------------------------------------- line chart
/**
 * series: [{ label, color: '--s1', data: [[date, v]] }]
 * opts: { freq, format, axisFormat, area, zeroLine, height }
 */
export function lineChart(fig, series, opts = {}) {
  const { freq = 'M', format = fmt.num, axisFormat = fmt.axis, area = series.length === 1, height = 260 } = opts;
  setLegend(fig.legend, series);
  const all = series.flatMap((s) => s.data);
  if (!all.length) { fig.plot.replaceChildren(h('p', { class: 'empty', text: 'Sin datos para este período.' })); return; }

  responsive(fig.plot, (W) => {
    const xs = all.map(([d]) => monthIndex(d));
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let lo = Math.min(...all.map((p) => p[1])), hi = Math.max(...all.map((p) => p[1]));
    if (opts.zeroLine || area) lo = Math.min(lo, 0);
    if (opts.zeroLine) hi = Math.max(hi, 0);
    const ticks = niceTicks(lo, hi, 4);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];

    const labelW = Math.max(...ticks.map((t) => textWidth(axisFormat(t), '500 11px "Encode Sans", system-ui, sans-serif'))) + 10;
    const endTexts = series.map((s) => (s.data.length ? `${series.length > 1 ? `${s.label} ` : ''}${format(s.data[s.data.length - 1][1])}` : ''));
    const endW = Math.min(170, Math.max(...endTexts.map((t) => textWidth(t, '600 12px "Encode Sans", system-ui, sans-serif'))) + 14);
    const narrow = W < 520;
    const ph = height - 14 - 26;
    const endYs = series.filter((s) => s.data.length).map((s) => 14 + (1 - (s.data[s.data.length - 1][1] - yMin) / (yMax - yMin)) * ph).sort((a, b) => a - b);
    const collide = endYs.some((y, k) => k && y - endYs[k - 1] < 15);
    const m = { t: 14, r: narrow || collide ? 12 : endW, b: 26, l: labelW };
    const pw = Math.max(40, W - m.l - m.r);
    const X = (i) => m.l + (x1 === x0 ? pw / 2 : ((i - x0) / (x1 - x0)) * pw);
    const Y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin)) * ph;

    const root = svg('svg', { width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img', tabindex: 0, class: 'chart' });
    root.setAttribute('aria-label', `${fig.node.querySelector('h3').textContent}. ${series.map((s, i) => endTexts[i] && `${s.label}: último dato ${format(s.data[s.data.length - 1][1])} (${periodLabel(s.data[s.data.length - 1][0], freq, 'long')})`).join('. ')}`);

    // grid + y labels
    for (const t of ticks) {
      svg('line', { x1: m.l, x2: m.l + pw, y1: Y(t), y2: Y(t), class: t === 0 && yMin < 0 ? 'baseline' : 'grid' }, root);
      svg('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick' }, root).textContent = axisFormat(t);
    }
    // x labels: years, or months for short spans
    const spanMonths = x1 - x0;
    const xTicks = [];
    if (spanMonths <= 20) {
      const step = Math.max(1, Math.ceil(spanMonths / Math.max(2, Math.floor(pw / 64))));
      for (let i = x0; i <= x1; i += freq === 'M' ? step : Math.max(step, freq === 'Q' ? 3 : 6)) xTicks.push([i, periodLabel(fromIndex(i), freq === 'M' ? 'M' : freq, freq === 'M' ? 'tick' : 'short')]);
    } else {
      const years = [];
      for (let y = Math.ceil(x0 / 12); y * 12 <= x1; y++) years.push(y);
      const every = Math.max(1, Math.ceil(years.length / Math.max(2, Math.floor(pw / 48))));
      years.filter((y, k) => (years.length - 1 - k) % every === 0).forEach((y) => xTicks.push([y * 12, String(y)]));
    }
    for (const [i, label] of xTicks) {
      svg('line', { x1: X(i), x2: X(i), y1: m.t + ph, y2: m.t + ph + 4, class: 'axis' }, root);
      svg('text', { x: X(i), y: height - 6, 'text-anchor': 'middle', class: 'tick' }, root).textContent = label;
    }
    svg('line', { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph, class: yMin < 0 ? 'grid' : 'baseline' }, root);

    // marks
    const ends = [];
    series.forEach((s, si) => {
      if (!s.data.length) return;
      const pts = s.data.map(([d, v]) => [X(monthIndex(d)), Y(v)]);
      // break the line where a period is missing
      const step = freq === 'Q' ? 3 : freq === 'S' ? 6 : freq === 'A' ? 12 : 1;
      let dStr = '';
      s.data.forEach(([d], k) => {
        const gap = k === 0 || monthIndex(d) - monthIndex(s.data[k - 1][0]) > step;
        dStr += `${gap ? 'M' : 'L'}${pts[k][0].toFixed(1)},${pts[k][1].toFixed(1)}`;
      });
      if (area && series.length === 1) {
        const base = Y(Math.max(yMin, 0));
        svg('path', { d: `${dStr}L${pts[pts.length - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`, class: 'area', style: `fill:var(${s.color})` }, root);
      }
      svg('path', { d: dStr, class: 'line', style: `stroke:var(${s.color})` }, root);
      const [ex, ey] = pts[pts.length - 1];
      svg('circle', { cx: ex, cy: ey, r: 4, class: 'dot', style: `fill:var(${s.color})` }, root);
      ends.push({ y: ey, x: ex, text: endTexts[si] });
    });
    // end labels, dropped when they would collide (legend + tooltip carry them)
    if (!narrow && !collide) {
      for (const e of ends) svg('text', { x: e.x + 9, y: e.y + 4, class: 'end-label' }, root).textContent = e.text;
    } else if (ends.length === 1) {
      // phone width: no right gutter, so the value sits above the end dot
      const e = ends[0];
      svg('text', { x: e.x - 2, y: Math.max(12, e.y - 10), 'text-anchor': 'end', class: 'end-label' }, root).textContent = e.text;
    }

    // hover layer: crosshair snaps to the nearest period
    const cross = svg('line', { y1: m.t, y2: m.t + ph, class: 'crosshair', visibility: 'hidden' }, root);
    const hoverDots = series.map((s) => svg('circle', { r: 4, class: 'dot', style: `fill:var(${s.color})`, visibility: 'hidden' }, root));
    const periods = [...new Set(all.map(([d]) => d))].sort();
    let cur = -1;
    const show = (k) => {
      cur = Math.max(0, Math.min(periods.length - 1, k));
      const d = periods[cur];
      const px = X(monthIndex(d));
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      const rows = [h('div', { class: 'tip-date', text: periodLabel(d, freq, 'long') })];
      let topY = m.t + ph;
      series.forEach((s, si) => {
        const p = s.data.find(([dd]) => dd === d);
        const dot = hoverDots[si];
        if (!p) { dot.setAttribute('visibility', 'hidden'); return; }
        const py = Y(p[1]);
        topY = Math.min(topY, py);
        dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
        rows.push(tipRow(s.color, format(p[1]), series.length > 1 ? s.label : ''));
      });
      showTip(fig, px, topY, rows, { width: W });
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); hoverDots.forEach((d) => d.setAttribute('visibility', 'hidden')); hideTip(fig); };
    const hit = svg('rect', { x: m.l, y: 0, width: pw, height, fill: 'transparent' }, root);
    hit.addEventListener('pointermove', (e) => {
      const r = root.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const idx = x0 + ((mx - m.l) / pw) * (x1 - x0);
      let best = 0, bd = Infinity;
      periods.forEach((d, k) => { const dd = Math.abs(monthIndex(d) - idx); if (dd < bd) { bd = dd; best = k; } });
      show(best);
    });
    hit.addEventListener('pointerleave', hide);
    root.addEventListener('focus', () => show(periods.length - 1));
    root.addEventListener('blur', hide);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { show(cur - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { show(cur + 1); e.preventDefault(); }
      if (e.key === 'Escape') hide();
    });
    fig.plot.replaceChildren(root);
  });
}

// ------------------------------------------------------------ column chart
/** Vertical bars over time from a zero baseline. Negative bars hang below it. */
export function columnChart(fig, data, opts = {}) {
  const { freq = 'M', format = fmt.num, axisFormat = fmt.axis, height = 240, color = '--s1', negColor = color, label = '' } = opts;
  fig.legend.hidden = true;
  if (!data.length) { fig.plot.replaceChildren(h('p', { class: 'empty', text: 'Sin datos para este período.' })); return; }
  responsive(fig.plot, (W) => {
    const vals = data.map((d) => d[1]);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const lastText = format(vals[vals.length - 1]);
    const m = { t: 22, r: 8, b: 26, l: Math.max(...ticks.map((t) => textWidth(axisFormat(t), '500 11px "Encode Sans", system-ui, sans-serif'))) + 10 };
    const pw = W - m.l - m.r, ph = height - m.t - m.b;
    const n = data.length;
    const band = pw / n;
    const bw = Math.max(1, Math.min(24, band - 2));
    const Y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin)) * ph;
    const root = svg('svg', { width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img', tabindex: 0, class: 'chart' });
    root.setAttribute('aria-label', `${fig.node.querySelector('h3').textContent}. Último dato ${lastText} (${periodLabel(data[n - 1][0], freq, 'long')}).`);
    for (const t of ticks) {
      svg('line', { x1: m.l, x2: m.l + pw, y1: Y(t), y2: Y(t), class: t === 0 ? 'baseline' : 'grid' }, root);
      svg('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick' }, root).textContent = axisFormat(t);
    }
    // x labels
    const span = monthIndex(data[n - 1][0]) - monthIndex(data[0][0]);
    if (span > 20) {
      const years = [...new Set(data.map(([d]) => d.slice(0, 4)))];
      const every = Math.max(1, Math.ceil(years.length / Math.max(2, Math.floor(pw / 48))));
      years.forEach((y, k) => {
        if ((years.length - 1 - k) % every) return;
        const idx = data.findIndex(([d]) => d.startsWith(y));
        const x = m.l + band * idx + band / 2;
        if (idx < 0 || (idx === 0 && !data[0][0].endsWith('-01'))) return;
        svg('text', { x, y: height - 6, 'text-anchor': 'middle', class: 'tick' }, root).textContent = y;
      });
    } else {
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 52))));
      data.forEach(([d], k) => {
        if ((n - 1 - k) % every) return;
        svg('text', { x: m.l + band * k + band / 2, y: height - 6, 'text-anchor': 'middle', class: 'tick' }, root).textContent = periodLabel(d, freq, freq === 'M' ? 'tick' : 'short');
      });
    }
    const zero = Y(0);
    const bars = data.map(([d, v], k) => {
      const cx = m.l + band * k + band / 2;
      const y = Y(v);
      const hgt = Math.abs(y - zero);
      const r = Math.min(4, bw / 2, hgt);
      const x = cx - bw / 2;
      const up = v >= 0;
      // square at the baseline, rounded at the data end
      const p = up
        ? `M${x},${zero}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${zero}Z`
        : `M${x},${zero}V${y - r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y - r}V${zero}Z`;
      return svg('path', { d: p, class: 'bar', style: `fill:var(${up ? color : negColor})` }, root);
    });
    // value on the last bar's cap
    const lx = m.l + band * (n - 1) + band / 2, lv = vals[n - 1];
    const tw = textWidth(lastText, '600 12px "Encode Sans", system-ui, sans-serif');
    const tx = Math.min(lx, W - tw / 2 - 2);
    const spanned = data.slice(-Math.ceil((tw + 8) / band) - 1).map((p) => p[1]);
    const ty = lv >= 0 ? Math.min(...spanned.map((x) => Y(Math.max(x, 0)))) - 6 : Math.max(...spanned.map((x) => Y(Math.min(x, 0)))) + 15;
    svg('text', { x: tx, y: ty, 'text-anchor': 'middle', class: 'end-label' }, root).textContent = lastText;

    let cur = -1;
    const show = (k) => {
      cur = Math.max(0, Math.min(n - 1, k));
      bars.forEach((b, i) => b.classList.toggle('dim', i !== cur));
      const [d, v] = data[cur];
      showTip(fig, m.l + band * cur + band / 2, Math.min(Y(v), zero), [h('div', { class: 'tip-date', text: periodLabel(d, freq, 'long') }), tipRow(v >= 0 ? color : negColor, format(v), label, 'bar')], { width: W });
    };
    const hide = () => { bars.forEach((b) => b.classList.remove('dim')); hideTip(fig); };
    const hit = svg('rect', { x: m.l, y: 0, width: pw, height, fill: 'transparent' }, root);
    hit.addEventListener('pointermove', (e) => { const r = root.getBoundingClientRect(); show(Math.floor((e.clientX - r.left - m.l) / band)); });
    hit.addEventListener('pointerleave', hide);
    root.addEventListener('focus', () => show(n - 1));
    root.addEventListener('blur', hide);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { show(cur - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { show(cur + 1); e.preventDefault(); }
      if (e.key === 'Escape') hide();
    });
    fig.plot.replaceChildren(root);
  });
}

// ------------------------------------------------------------ ranked bars
/**
 * Horizontal bars, one per category, largest first. HTML so long Spanish
 * labels wrap. Negative values extend left of a shared zero line.
 * rows: [{ label, value, note? }]; opts: { format, color, negColor, reference: { value, label } }
 */
export function rankedBars(fig, rows, opts = {}) {
  const { format = fmt.num, color = '--s1', negColor = '--neg', reference, sort = true } = opts;
  fig.legend.hidden = true;
  const list = sort ? [...rows].sort((a, b) => b.value - a.value) : rows;
  if (!list.length) { fig.plot.replaceChildren(h('p', { class: 'empty', text: 'Sin datos para este período.' })); return; }
  const vals = list.map((r) => r.value).concat(reference ? [reference.value] : []);
  // One value far outside the rest (e.g. +400 % on a tiny base) would flatten
  // every other bar: cap the scale and mark that bar as clipped.
  const mags = vals.map(Math.abs).sort((a, b) => b - a);
  const cap = opts.clip !== false && mags.length > 2 && mags[0] > 3 * mags[1] ? mags[1] * 1.25 : Infinity;
  const clampV = (v) => Math.max(-cap, Math.min(cap, v));
  const lo = Math.min(0, ...vals.map(clampV)), hi = Math.max(0, ...vals.map(clampV));
  const span = hi - lo || 1;
  const pos = (v) => ((v - lo) / span) * 100;
  const zero = pos(0);
  const wrap = h('div', { class: 'ranked', role: 'list' });
  if (reference) {
    const p = pos(reference.value);
    wrap.classList.add('has-ref');
    wrap.style.setProperty('--ref', `${p}%`);
    wrap.append(h('div', { class: 'rrow ref-row', 'aria-hidden': 'true' },
      h('span', {}),
      h('div', { class: 'ref-label-track' }, h('span', { class: `ref-label${p > 60 ? ' flip' : ''}`, text: `${reference.label} ${format(reference.value)}` })),
      h('span', {})));
  }
  for (let r of list) {
    const neg = r.value < 0;
    const clipped = Math.abs(r.value) > cap;
    const cv = clampV(r.value);
    const left = neg ? pos(cv) : zero;
    const width = Math.abs(pos(cv) - zero);
    if (clipped) r = { ...r, note: `${r.note ? `${r.note} · ` : ''}barra recortada: supera la escala` };
    const bar = h('div', { class: `rbar${neg ? ' neg' : ''}${clipped ? ' clipped' : ''}`, style: { left: `${left}%`, width: `${Math.max(width, 0.4)}%`, '--c': `var(${neg ? negColor : color})` } });
    const valueEl = h('span', { class: 'rval', text: format(r.value) });
    const row = h('div', { class: 'rrow', role: 'listitem', tabindex: 0 },
      h('span', { class: 'rlabel', text: r.label }),
      h('div', { class: 'rtrack', style: { '--zero': `${zero}%` } }, bar),
      valueEl);
    const tip = () => {
      const pr = fig.plot.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      showTip(fig, rr.left - pr.left + rr.width * 0.55, rr.top - pr.top, [h('div', { class: 'tip-date', text: r.label }), tipRow(neg ? negColor : color, format(r.value), r.note ?? '', 'bar')], { width: pr.width });
    };
    row.addEventListener('pointerenter', tip);
    row.addEventListener('focus', tip);
    row.addEventListener('pointerleave', () => hideTip(fig));
    row.addEventListener('blur', () => hideTip(fig));
    wrap.append(row);
  }
  fig.plot.replaceChildren(wrap);
}

// ---------------------------------------------------------- segmented bar
/** One whole split into <=6 parts. Tall (28px) with shares printed where they fit. */
export function segmentedBar(fig, parts, opts = {}) {
  const { format = fmt.num } = opts;
  const total = parts.reduce((s, p) => s + p.value, 0);
  setLegend(fig.legend, parts.map((p) => ({ label: p.label, color: p.color })), 'bar');
  fig.legend.hidden = false;
  const bar = h('div', { class: 'segbar', role: 'img', 'aria-label': parts.map((p) => `${p.label}: ${format(p.value)} (${fmt.pct((p.value / total) * 100, 0)})`).join('; ') });
  responsive(fig.plot, (W) => {
    bar.replaceChildren(...parts.map((p) => {
      const share = (p.value / total) * 100;
      const txt = fmt.pct(share, 0);
      const fits = (share / 100) * W - 12 > textWidth(txt, '600 12px "Encode Sans", system-ui, sans-serif');
      const seg = h('div', { class: `seg${p.darkText ? ' dark-text' : ''}`, tabindex: 0, style: { flexGrow: String(p.value), '--c': `var(${p.color})` } }, fits ? txt : '');
      const tip = () => {
        const pr = fig.plot.getBoundingClientRect(), sr = seg.getBoundingClientRect();
        showTip(fig, sr.left - pr.left + sr.width / 2, 0, [h('div', { class: 'tip-date', text: p.label }), tipRow(p.color, format(p.value), txt, 'bar')], { width: pr.width });
      };
      seg.addEventListener('pointerenter', tip); seg.addEventListener('focus', tip);
      seg.addEventListener('pointerleave', () => hideTip(fig)); seg.addEventListener('blur', () => hideTip(fig));
      return seg;
    }));
    if (!bar.isConnected) fig.plot.replaceChildren(bar);
  });
  fig.plot.replaceChildren(bar);
}

// --------------------------------------------------------------- sparkline
export function sparkline(data, { color = '--s1', height = 36 } = {}) {
  const W = 160;
  const root = svg('svg', { viewBox: `0 0 ${W} ${height}`, preserveAspectRatio: 'none', class: 'spark', 'aria-hidden': 'true' });
  if (data.length < 2) return root;
  const vals = data.map((d) => d[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const X = (k) => 2 + (k / (data.length - 1)) * (W - 8);
  const Y = (v) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (height - 8);
  const d = data.map(([, v], k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  svg('path', { d: `${d}L${X(data.length - 1)},${height}L${X(0)},${height}Z`, class: 'spark-area' }, root);
  svg('path', { d, class: 'spark-line', 'vector-effect': 'non-scaling-stroke' }, root);
  const end = svg('circle', { cx: X(data.length - 1), cy: Y(vals[vals.length - 1]), r: 3.5, class: 'spark-end', style: `fill:var(${color})` }, root);
  end.setAttribute('vector-effect', 'non-scaling-stroke');
  return root;
}

// ----------------------------------------------------------------- pyramid
/** Population pyramid: varones left, mujeres right, by five-year band. */
export function pyramid(fig, bands, v, mj, opts = {}) {
  const { format = fmt.int } = opts;
  setLegend(fig.legend, [{ label: 'Varones', color: '--s1' }, { label: 'Mujeres', color: '--s2' }], 'bar');
  fig.legend.hidden = false;
  const max = Math.max(...v, ...mj);
  const total = v.reduce((a, b) => a + b, 0) + mj.reduce((a, b) => a + b, 0);
  const wrap = h('div', { class: 'pyramid' });
  for (let i = bands.length - 1; i >= 0; i--) {
    const row = h('div', { class: 'prow', tabindex: 0 },
      h('div', { class: 'pside left' }, h('div', { class: 'pbar', style: { width: `${(v[i] / max) * 100}%`, '--c': 'var(--s1)' } })),
      h('span', { class: 'page', text: bands[i] }),
      h('div', { class: 'pside' }, h('div', { class: 'pbar', style: { width: `${(mj[i] / max) * 100}%`, '--c': 'var(--s2)' } })));
    const tip = () => {
      const pr = fig.plot.getBoundingClientRect(), rr = row.getBoundingClientRect();
      showTip(fig, pr.width / 2, rr.top - pr.top, [h('div', { class: 'tip-date', text: `${bands[i]} años` }),
        tipRow('--s1', format(v[i]), `varones · ${fmt.pct((v[i] / total) * 100)}`, 'bar'),
        tipRow('--s2', format(mj[i]), `mujeres · ${fmt.pct((mj[i] / total) * 100)}`, 'bar')], { width: pr.width });
    };
    row.addEventListener('pointerenter', tip); row.addEventListener('focus', tip);
    row.addEventListener('pointerleave', () => hideTip(fig)); row.addEventListener('blur', () => hideTip(fig));
    wrap.append(row);
  }
  fig.plot.replaceChildren(wrap);
}
