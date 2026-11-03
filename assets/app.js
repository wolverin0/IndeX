import { fmt, change, diff, ytd, rollingSum, lastMonths, last, at, addMonths, periodLabel, adultEquivalent } from './data.js';
import { h, figure, lineChart, columnChart, rankedBars, segmentedBar, sparkline, pyramid } from './charts.js';

let SNAP = null;
const S = (key) => SNAP.series[key];
const D = (key) => S(key)?.data ?? [];
const has = (...keys) => keys.every((k) => D(k).length);

const RANGES = [['1a', 12, '1 año'], ['3a', 36, '3 años'], ['5a', 60, '5 años'], ['10a', 120, '10 años'], ['todo', 0, 'Todo']];
const state = {
  range: { salarios: '3a', dolar: '3a', precios: '3a', canastas: '3a', trabajo: '10a', pobreza: 'todo', actividad: '5a', comercio: '5a' },
  measure: 'm',
  popYear: null,
  household: [{ age: 35, sex: 'v' }, { age: 31, sex: 'm' }, { age: 6, sex: 'v' }, { age: 8, sex: 'm' }],
  income: '',
  calc: { amount: 100000, from: null, to: null },
};
const months = (section) => RANGES.find((r) => r[0] === state.range[section])[1];
const win = (section, data) => lastMonths(data, months(section));

// ---------------------------------------------------------------- helpers
const SOURCE_LABEL = { indec: 'INDEC (API oficial)', 'datos.gob.ar': 'INDEC, vía datos.gob.ar', argentinadatos: 'ArgentinaDatos (cotizaciones de mercado)', bcra: 'Banco Central (BCRA)' };
const ORIGIN_LABEL = { indec: 'API INDEC', 'datos.gob.ar': 'datos.gob.ar', argentinadatos: 'ArgentinaDatos', bcra: 'BCRA' };
function sourceLine(...keys) {
  const srcs = [...new Set(keys.map((k) => S(k)?.source).filter(Boolean))];
  if (!srcs.length) return 'Fuente: INDEC';
  if (srcs.length === 2 && srcs.includes('indec') && srcs.includes('datos.gob.ar')) return 'Fuente: INDEC (API oficial y datos.gob.ar)';
  return `Fuente: ${srcs.map((x) => SOURCE_LABEL[x] ?? x).join(' y ')}`;
}
const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Series computed from published ones, added to the snapshot at load time. */
function derive() {
  const inf = D('eph.informalidad'), emp = D('eph.empleo');
  if (inf.length && emp.length) {
    // INDEC publishes informal employment over the total population; divide by
    // the employment rate to get the share of workers who are informal.
    SNAP.series['eph.informalidad.share'] = { title: 'Informalidad (% de las personas ocupadas)', short: 'Informalidad', unit: '%', freq: 'Q', source: S('eph.informalidad').source, sourceId: 'derivada: empleo informal / empleo',
      data: inf.filter(([d]) => at(emp, d)).map(([d, v]) => [d, (v / at(emp, d)) * 100]) };
  }
  const o = D('usd.oficial'), b = D('usd.blue');
  if (o.length && b.length) {
    SNAP.series['usd.brecha'] = { title: 'Brecha entre el dólar blue y el oficial', short: 'Brecha', unit: '%', freq: 'M', source: S('usd.blue').source, sourceId: 'derivada: blue / oficial − 1',
      data: b.filter(([d]) => at(o, d)).map(([d, v]) => [d, (v / at(o, d) - 1) * 100]) };
  }
}
const tableFor = (series, freq, format) => () => {
  const dates = [...new Set(series.flatMap((s) => s.data.map((d) => d[0])))].sort().reverse();
  return {
    columns: ['Período', ...series.map((s) => s.label)],
    rows: dates.map((d) => [periodLabel(d, freq, 'short'), ...series.map((s) => { const v = at(s.data, d); return v === undefined ? '…' : format(v); })]),
  };
};

/** Delta chip: arrow + signed text, colored by whether the move is good. */
function delta(value, text, vs, upIsGood) {
  const dir = Math.abs(value) < 1e-9 ? 'flat' : value > 0 ? 'up' : 'down';
  const tone = dir === 'flat' || upIsGood === null ? 'neutral' : (dir === 'up') === upIsGood ? 'good' : 'bad';
  const icon = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●';
  return h('p', { class: `delta ${tone}` }, h('span', { class: 'delta-icon', 'aria-hidden': 'true', text: icon }), h('span', { text }), h('span', { class: 'vs', text: ` ${vs}` }));
}

function tile({ label, value, period, deltaEl, spark, href, note }) {
  const inner = [
    h('p', { class: 'tile-label', text: label }),
    h('p', { class: 'tile-value', text: value }),
    deltaEl ?? null,
    spark ? h('div', { class: 'tile-spark' }, sparkline(spark)) : null,
    h('p', { class: 'tile-period', text: note ? `${period} · ${note}` : period }),
  ];
  return href ? h('a', { class: 'tile', href }, ...inner) : h('div', { class: 'tile' }, ...inner);
}

function unavailable(title, text) {
  return h('section', { class: 'card unavailable' },
    h('h3', { text: title }),
    h('p', { text }),
    h('p', { class: 'fine', text: 'Este dato se publica solo en la API oficial del INDEC. Aparece acá cuando el sitio se actualiza con una clave de acceso a esa API.' }));
}

function sectionHead(id, title, lede, controls = []) {
  return h('header', { class: 'section-head' },
    h('div', { class: 'section-title' }, h('h2', { id: `${id}-title`, tabindex: '-1', text: title }), lede ? h('p', { class: 'lede', text: lede }) : null),
    controls.length ? h('div', { class: 'controls', role: 'group', 'aria-label': 'Filtros de la sección' }, ...controls) : null);
}

function segmented(name, options, value, onChange) {
  return h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    h('span', { class: 'seg-name', text: name }),
    ...options.map(([v, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '',
      onclick: () => onChange(v),
    }, label)));
}
const rangeControl = (section) => segmented('Período', RANGES.map(([k, , l]) => [k, l]), state.range[section], (v) => { state.range[section] = v; render(); });

// ------------------------------------------------------------- calculators
function inflationCalculator(wide = false) {
  const ipc = D('ipc.ng.nac');
  if (!ipc.length) return unavailable('Actualizá un monto por inflación', 'Falta la serie del IPC.');
  const first = ipc[0][0], latest = last(ipc)[0];
  state.calc.to ??= latest;
  state.calc.from ??= addMonths(latest, -12);
  const out = h('div', { class: 'calc-out', 'aria-live': 'polite' });
  const amount = h('input', { id: 'calc-amount', type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: state.calc.amount });
  const from = h('input', { id: 'calc-from', type: 'month', min: first, max: latest, value: state.calc.from });
  const to = h('input', { id: 'calc-to', type: 'month', min: first, max: latest, value: state.calc.to });
  const update = () => {
    const a = Number(amount.value);
    const f = from.value, t = to.value;
    state.calc = { amount: amount.value, from: f, to: t };
    const vf = at(ipc, f), vt = at(ipc, t);
    if (!(a >= 0) || vf === undefined || vt === undefined) {
      out.replaceChildren(h('p', { class: 'calc-error', text: `Elegí meses entre ${periodLabel(first, 'M', 'long')} y ${periodLabel(latest, 'M', 'long')}, y un monto mayor a cero.` }));
      return;
    }
    const result = a * (vt / vf);
    const pct = (vt / vf - 1) * 100;
    out.replaceChildren(
      h('p', { class: 'calc-result', text: fmt.pesos(result) }),
      h('p', { class: 'calc-explain', text: `Lo que en ${periodLabel(f, 'M', 'long')} costaba ${fmt.pesos(a)}, en ${periodLabel(t, 'M', 'long')} cuesta ${fmt.pesos(result)}. ${pct >= 0 ? 'Los precios subieron' : 'Los precios bajaron'} ${fmt.pct(Math.abs(pct))} en ese período.` }));
  };
  [amount, from, to].forEach((i) => i.addEventListener('input', update));
  update();
  return h('section', { class: `card calc${wide ? ' wide' : ''}`, 'aria-labelledby': 'calc-ipc-title' },
    h('h3', { id: 'calc-ipc-title', text: 'Actualizá un monto por inflación' }),
    h('p', { class: 'fig-sub', text: 'Usa el IPC nacional. Sirve para comparar un sueldo, un alquiler o un precio en el tiempo.' }),
    h('div', { class: 'calc-form' },
      h('label', { for: 'calc-amount' }, h('span', { text: 'Monto en pesos' }), amount),
      h('label', { for: 'calc-from' }, h('span', { text: 'Desde' }), from),
      h('label', { for: 'calc-to' }, h('span', { text: 'Hasta' }), to)),
    out,
    h('p', { class: 'source', text: `${sourceLine('ipc.ng.nac')} · IPC base diciembre 2016 = 100` }));
}

function householdCalculator() {
  const cba = D('cba'), cbt = D('cbt');
  if (!cba.length || !cbt.length) return unavailable('¿Cuánto necesita tu hogar?', 'Faltan las series de canastas básicas.');
  const [date, cbaV] = last(cba);
  const cbtV = at(cbt, date) ?? last(cbt)[1];
  const list = h('ol', { class: 'members' });
  const out = h('div', { class: 'calc-out', 'aria-live': 'polite' });
  const income = h('input', { id: 'hh-income', type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: 'Opcional', value: state.income });
  const drawMembers = () => {
    list.replaceChildren(...state.household.map((p, i) => {
      const age = h('input', { id: `hh-age-${i}`, type: 'number', min: '0', max: '110', inputmode: 'numeric', value: p.age, 'aria-label': `Edad de la persona ${i + 1}` });
      const sex = h('select', { id: `hh-sex-${i}`, 'aria-label': `Sexo de la persona ${i + 1}` },
        h('option', { value: 'v', selected: p.sex === 'v' }, 'Varón'), h('option', { value: 'm', selected: p.sex === 'm' }, 'Mujer'));
      age.addEventListener('input', () => { p.age = Math.max(0, Math.min(110, Number(age.value) || 0)); compute(); });
      sex.addEventListener('change', () => { p.sex = sex.value; compute(); });
      return h('li', { class: 'member' },
        h('span', { class: 'member-n', text: `${i + 1}` }),
        h('label', { class: 'member-field' }, h('span', { text: 'Edad' }), age),
        h('label', { class: 'member-field' }, h('span', { text: 'Sexo' }), sex),
        h('button', { type: 'button', class: 'linkish remove', disabled: state.household.length === 1, onclick: () => { state.household.splice(i, 1); drawMembers(); compute(); } }, 'Quitar'));
    }));
  };
  const compute = () => {
    const ae = state.household.reduce((s, p) => s + adultEquivalent(p.age, p.sex), 0);
    const li = cbaV * ae, lp = cbtV * ae;
    state.income = income.value;
    const inc = Number(income.value);
    const kids = [
      h('dl', { class: 'calc-lines' },
        h('div', {}, h('dt', { text: 'Línea de pobreza (canasta básica total)' }), h('dd', { class: 'calc-result', text: fmt.pesos(lp) })),
        h('div', {}, h('dt', { text: 'Línea de indigencia (canasta alimentaria)' }), h('dd', { class: 'calc-second', text: fmt.pesos(li) })),
        h('div', {}, h('dt', { text: 'Adultos equivalentes' }), h('dd', { class: 'calc-second', text: new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ae) }))),
    ];
    if (income.value !== '' && inc >= 0) {
      const max = Math.max(inc, lp) * 1.25;
      const where = inc >= lp
        ? `Ese ingreso está ${fmt.pct((inc / lp - 1) * 100, 0)} por encima de la línea de pobreza.`
        : inc >= li
          ? `Ese ingreso está ${fmt.pct((1 - inc / lp) * 100, 0)} por debajo de la línea de pobreza y por encima de la de indigencia.`
          : 'Ese ingreso está por debajo de la línea de indigencia.';
      kids.push(h('div', { class: 'meter', role: 'img', 'aria-label': where },
        h('div', { class: 'meter-track' },
          h('i', { class: 'meter-fill', style: { width: `${(Math.min(inc, max) / max) * 100}%` } }),
          h('i', { class: 'meter-mark', style: { left: `${(li / max) * 100}%` }, 'data-label': 'Indigencia' }),
          h('i', { class: 'meter-mark', style: { left: `${(lp / max) * 100}%` }, 'data-label': 'Pobreza' }))),
      h('p', { class: 'calc-explain', text: where }));
    }
    out.replaceChildren(...kids);
  };
  income.addEventListener('input', compute);
  drawMembers();
  compute();
  return h('section', { class: 'card calc household', 'aria-labelledby': 'calc-hh-title' },
    h('h3', { id: 'calc-hh-title', text: '¿Cuánto necesita tu hogar?' }),
    h('p', { class: 'fig-sub', text: `Calcula las canastas básicas de ${periodLabel(date, 'M', 'long')} para las personas que viven en tu hogar. El ejemplo cargado es el hogar tipo que usa el INDEC: dos adultos y dos chicos.` }),
    h('div', { class: 'calc-cols' },
      h('div', {},
        list,
        h('button', { type: 'button', class: 'btn', onclick: () => { state.household.push({ age: 30, sex: 'm' }); drawMembers(); compute(); list.lastChild?.querySelector('input')?.focus(); } }, '+ Agregar persona'),
        h('label', { class: 'income', for: 'hh-income' }, h('span', { text: 'Ingreso mensual total del hogar' }), income),
        h('p', { class: 'fine', text: 'El ingreso no sale de tu navegador.' })),
      out),
    h('p', { class: 'source', text: `${sourceLine('cba', 'cbt')} · Valores del Gran Buenos Aires. Las otras regiones tienen canastas distintas.` }));
}

// ---------------------------------------------------------------- sections
function inicio() {
  const ipc = D('ipc.ng.nac');
  const mm = change(ipc, 1), yy = change(ipc, 12), acc = ytd(ipc);
  const [d, v] = last(mm);
  const hero = figure({ title: 'Inflación mensual, últimos 24 meses', source: sourceLine('ipc.ng.nac'), table: tableFor([{ label: 'Variación mensual', data: lastMonths(mm, 24) }], 'M', fmt.pct), className: 'hero-chart' });
  columnChart(hero, lastMonths(mm, 24), { format: (x) => fmt.pct(x), axisFormat: (x) => `${fmt.axis(x)} %`, height: 200, label: 'IPC nacional' });

  const tiles = [];
  tiles.push(tile({ label: 'Inflación interanual', value: fmt.pct(last(yy)[1]), period: periodLabel(last(yy)[0]),
    deltaEl: delta(last(yy)[1] - yy[yy.length - 2][1], fmt.pp(last(yy)[1] - yy[yy.length - 2][1]), 'vs. mes anterior', false),
    spark: lastMonths(yy, 24), href: '#precios' }));
  if (has('salarios.total')) {
    const yyW = change(D('salarios.total'), 12); const [wd, wv] = last(yyW); const inf = at(yy, wd);
    if (inf !== undefined) tiles.push(tile({ label: 'Salarios, interanual', value: fmt.signedPct(wv), period: periodLabel(wd),
      deltaEl: delta(wv - inf, fmt.pp(wv - inf), 'vs. la inflación', true), spark: lastMonths(yyW, 24), href: '#salarios' }));
  }
  if (has('cbt')) {
    const cbt = D('cbt'); const lp = cbt.map(([dd, x]) => [dd, x * 3.09]); const ch = last(change(cbt, 1))[1];
    tiles.push(tile({ label: 'Línea de pobreza, hogar tipo', value: fmt.pesosCompact(last(lp)[1]), period: periodLabel(last(lp)[0]), note: 'GBA',
      deltaEl: delta(ch, fmt.signedPct(ch), 'vs. mes anterior', null), spark: lastMonths(lp, 24), href: '#canastas' }));
  }
  if (has('pobreza.personas')) {
    const p = D('pobreza.personas'); const dd = last(diff(p, 12));
    tiles.push(tile({ label: 'Personas bajo la línea de pobreza', value: fmt.pct(last(p)[1]), period: periodLabel(last(p)[0], 'S'), note: '31 aglomerados',
      deltaEl: dd ? delta(dd[1], fmt.pp(dd[1]), 'vs. un año antes', false) : null, spark: p, href: '#pobreza' }));
  }
  if (has('eph.desocupacion')) {
    const u = D('eph.desocupacion'); const dd = last(diff(u, 12));
    tiles.push(tile({ label: 'Desocupación', value: fmt.pct(last(u)[1]), period: periodLabel(last(u)[0], 'Q'),
      deltaEl: dd ? delta(dd[1], fmt.pp(dd[1]), 'vs. un año antes', false) : null, spark: lastMonths(u, 60), href: '#trabajo' }));
  }
  if (has('emae.original', 'emae.desest')) {
    const yyE = change(D('emae.original'), 12); const mmE = last(change(D('emae.desest'), 1))[1];
    tiles.push(tile({ label: 'Actividad económica, interanual', value: fmt.signedPct(last(yyE)[1]), period: periodLabel(last(yyE)[0]),
      deltaEl: delta(mmE, fmt.signedPct(mmE), 'mensual, sin estacionalidad', true), spark: lastMonths(D('emae.desest'), 24), href: '#actividad' }));
  }
  if (has('expo.total', 'impo.total')) {
    const bal = balance(); const [bd, bv] = last(bal); const prev = at(bal, addMonths(bd, -12));
    tiles.push(tile({ label: 'Saldo comercial', value: fmt.signedUsdM(bv), period: periodLabel(bd),
      deltaEl: prev !== undefined ? delta(bv - prev, fmt.signedUsdM(bv - prev), 'vs. un año antes', true) : null, spark: lastMonths(bal, 24), href: '#comercio' }));
  }
  const usdO = SNAP.markets?.['usd.oficial'], usdB = SNAP.markets?.['usd.blue'];
  if (usdO) {
    tiles.push(tile({ label: 'Dólar oficial', value: fmt.pesos(usdO.valor), period: fmtDate(usdO.fecha), note: usdB ? `blue ${fmt.pesos(usdB.valor)}` : null,
      spark: lastMonths(D('usd.oficial'), 24), href: '#dolar' }));
  }

  const divs = divisionRows(1);
  const top = figure({ title: `Qué subió más en ${periodLabel(d, 'M', 'month')}`, subtitle: 'Variación mensual de precios por tipo de gasto, total del país', source: sourceLine('ipc.ng.nac', 'ipc.div.alimentos'), table: () => ({ columns: ['División', 'Variación mensual'], rows: [...divs].sort((a, b) => b.value - a.value).map((r) => [r.label, fmt.pct(r.value)]) }) });
  rankedBars(top, divs, { format: (x) => fmt.pct(x), reference: { value: v, label: 'Nivel general' } });

  return h('div', {},
    h('section', { class: 'hero', 'aria-labelledby': 'hero-title' },
      h('div', { class: 'hero-copy' },
        h('p', { class: 'eyebrow', id: 'hero-title', text: `Inflación de ${periodLabel(d, 'M', 'long')}` }),
        h('p', { class: 'hero-figure', text: fmt.pct(v) }),
        h('p', { class: 'hero-text', text: `Los precios subieron ${fmt.pct(v)} en el mes. En los últimos doce meses acumulan ${fmt.pct(last(yy)[1])} y en lo que va de ${d.slice(0, 4)}, ${fmt.pct(last(acc)[1])}.` }),
        h('a', { class: 'more', href: '#precios', text: 'Ver precios en detalle' })),
      hero.node),
    h('section', { class: `tiles${tiles.length === 8 ? ' four' : ''}`, 'aria-label': 'Indicadores principales' }, ...tiles),
    h('div', { class: 'grid' }, inflationCalculator(), top.node),
    h('div', { class: 'grid' }, householdCalculator()));
}

function divisionRows(lag) {
  const rows = [];
  for (const [key, s] of Object.entries(SNAP.series)) {
    if (!key.startsWith('ipc.div.')) continue;
    const c = change(s.data, lag); if (!c.length) continue;
    rows.push({ label: s.short, value: last(c)[1], note: periodLabel(last(c)[0]) });
  }
  return rows;
}
function balance() {
  const e = D('expo.total'), i = D('impo.total');
  return e.filter(([d]) => at(i, d) !== undefined).map(([d, v]) => [d, v - at(i, d)]);
}

function precios() {
  const lag = state.measure === 'm' ? 1 : 12;
  const mLabel = state.measure === 'm' ? 'mensual' : 'interanual';
  const ipc = D('ipc.ng.nac');
  const mm = change(ipc, 1), yy = change(ipc, 12), acc = ytd(ipc), core = change(D('ipc.nucleo'), 1);
  const ref = last(change(ipc, lag));
  const tiles = h('section', { class: 'tiles four' },
    tile({ label: 'Inflación mensual', value: fmt.pct(last(mm)[1]), period: periodLabel(last(mm)[0]), deltaEl: delta(last(mm)[1] - mm[mm.length - 2][1], fmt.pp(last(mm)[1] - mm[mm.length - 2][1]), 'vs. mes anterior', false), spark: lastMonths(mm, 24) }),
    tile({ label: 'Inflación interanual', value: fmt.pct(last(yy)[1]), period: periodLabel(last(yy)[0]), deltaEl: delta(last(yy)[1] - yy[yy.length - 2][1], fmt.pp(last(yy)[1] - yy[yy.length - 2][1]), 'vs. mes anterior', false), spark: lastMonths(yy, 24) }),
    tile({ label: `Acumulada en ${last(acc)[0].slice(0, 4)}`, value: fmt.pct(last(acc)[1]), period: `enero a ${periodLabel(last(acc)[0], 'M', 'month')}` }),
    core.length ? tile({ label: 'Inflación núcleo', value: fmt.pct(last(core)[1]), period: periodLabel(last(core)[0]), note: 'sin regulados ni estacionales', spark: lastMonths(core, 24) }) : null);

  const f1 = figure({ title: 'Inflación mensual', subtitle: 'Variación del IPC nacional respecto del mes anterior', source: sourceLine('ipc.ng.nac'), table: tableFor([{ label: 'Variación mensual', data: win('precios', mm) }], 'M', fmt.pct), wide: true });
  columnChart(f1, win('precios', mm), { format: (x) => fmt.pct(x), axisFormat: (x) => `${fmt.axis(x)} %`, label: 'IPC nacional' });

  const cats = [['ipc.nucleo', 'Núcleo', '--s1'], ['ipc.regulados', 'Regulados', '--s2'], ['ipc.estacionales', 'Estacionales', '--s3']]
    .filter(([k]) => has(k)).map(([k, label, color]) => ({ label, color, data: win('precios', change(D(k), 12)) }));
  const f2 = figure({ title: 'Inflación interanual por categoría', subtitle: 'Núcleo: precios sin estacionalidad ni regulación. Regulados: tarifas, combustibles, prepagas. Estacionales: frutas, verduras, ropa, turismo.', source: sourceLine('ipc.nucleo', 'ipc.regulados'), table: tableFor(cats, 'M', fmt.pct) });
  lineChart(f2, cats, { format: (x) => fmt.pct(x), axisFormat: (x) => `${fmt.axis(x)} %` });

  const divs = divisionRows(lag);
  const f3 = figure({ title: `Variación ${mLabel} por división`, subtitle: `Total del país, ${periodLabel(ref[0], 'M', 'long')}. La línea marca el nivel general.`, source: sourceLine('ipc.div.alimentos'), table: () => ({ columns: ['División', `Variación ${mLabel}`], rows: [...divs].sort((a, b) => b.value - a.value).map((r) => [r.label, fmt.pct(r.value)]) }) });
  rankedBars(f3, divs, { format: (x) => fmt.pct(x), reference: { value: ref[1], label: 'Nivel general' } });

  const regs = Object.entries(SNAP.series).filter(([k]) => k.startsWith('ipc.ng.') && k !== 'ipc.ng.nac')
    .map(([, s]) => ({ label: s.short, value: last(change(s.data, lag))?.[1] })).filter((r) => r.value !== undefined);
  const f4 = figure({ title: `Variación ${mLabel} por región`, subtitle: `Nivel general, ${periodLabel(ref[0], 'M', 'long')}. La línea marca el total del país.`, source: sourceLine('ipc.ng.gba'), table: () => ({ columns: ['Región', `Variación ${mLabel}`], rows: [...regs].sort((a, b) => b.value - a.value).map((r) => [r.label, fmt.pct(r.value)]) }) });
  rankedBars(f4, regs, { format: (x) => fmt.pct(x), reference: { value: ref[1], label: 'Total país' } });

  const wholesale = [{ label: 'Minoristas (IPC)', color: '--s1', data: win('precios', yy) }, { label: 'Mayoristas (IPIM)', color: '--s2', data: win('precios', change(D('ipim'), 12)) }]
    .concat(has('icc') ? [{ label: 'Construcción (ICC)', color: '--s3', data: win('precios', change(D('icc'), 12)) }] : []);
  const f5 = figure({ title: has('icc') ? 'Precios mayoristas, minoristas y de la construcción' : 'Precios mayoristas y minoristas', subtitle: `Variación interanual. Los mayoristas suelen anticipar lo que llega a las góndolas.${has('icc') ? ' La construcción se mide en el Gran Buenos Aires.' : ''}`, source: sourceLine('ipc.ng.nac', 'ipim'), table: tableFor(wholesale, 'M', fmt.pct) });
  lineChart(f5, wholesale, { format: (x) => fmt.pct(x), axisFormat: (x) => `${fmt.axis(x)} %` });

  return h('div', {},
    sectionHead('precios', 'Precios', 'Cuánto cambian los precios al consumidor (IPC) y los mayoristas, mes a mes y en el año.', [
      rangeControl('precios'),
      segmented('Variación', [['m', 'Mensual'], ['y', 'Interanual']], state.measure, (x) => { state.measure = x; render(); }),
    ]),
    tiles,
    h('div', { class: 'grid' }, f1.node, f3.node, f4.node, f2.node, f5.node, inflationCalculator(true)));
}

function canastas() {
  const cba = D('cba'), cbt = D('cbt');
  const tiles = [];
  if (cba.length && cbt.length) {
    const mk = (label, data, mult, note) => {
      const ch = last(change(data, 1))[1];
      return tile({ label, value: fmt.pesos(last(data)[1] * mult), period: periodLabel(last(data)[0]), note, deltaEl: delta(ch, fmt.signedPct(ch), 'vs. mes anterior', null), spark: lastMonths(data, 24) });
    };
    tiles.push(mk('Canasta alimentaria, por adulto', cba, 1, 'GBA'), mk('Canasta total, por adulto', cbt, 1, 'GBA'),
      mk('Línea de indigencia, hogar tipo', cba, 3.09, '4 personas'), mk('Línea de pobreza, hogar tipo', cbt, 3.09, '4 personas'));
  }
  const vs = [
    { label: 'Canasta alimentaria', color: '--s1', data: win('canastas', change(cba, 12)) },
    { label: 'Canasta total', color: '--s2', data: win('canastas', change(cbt, 12)) },
    { label: 'IPC GBA', color: '--s3', data: win('canastas', change(D('ipc.ng.gba'), 12)) },
  ].filter((s) => s.data.length);
  const f1 = figure({ title: 'Canastas e inflación', subtitle: 'Variación interanual. Cuando las canastas suben más que el IPC, a los hogares de menores ingresos les rinde menos la plata.', source: sourceLine('cba', 'cbt', 'ipc.ng.gba'), table: tableFor(vs, 'M', fmt.pct) });
  lineChart(f1, vs, { format: (x) => fmt.pct(x), axisFormat: (x) => `${fmt.axis(x)} %` });
  const f2 = figure({ title: 'Variación mensual de la canasta total', subtitle: 'Por adulto equivalente, Gran Buenos Aires', source: sourceLine('cbt'), table: tableFor([{ label: 'Variación mensual', data: win('canastas', change(cbt, 1)) }], 'M', fmt.pct) });
  columnChart(f2, win('canastas', change(cbt, 1)), { format: (x) => fmt.pct(x), axisFormat: (x) => `${fmt.axis(x)} %`, label: 'Canasta total' });

  let crianza;
  const tramos = [['men1', 'Menores de 1 año'], ['1a3', 'De 1 a 3 años'], ['4a5', 'De 4 a 5 años'], ['6a12', 'De 6 a 12 años']];
  if (has('crianza.tot.men1')) {
    const dt = last(D('crianza.tot.men1'))[0];
    const rows = tramos.map(([c, l]) => ({ label: l, value: at(D(`crianza.tot.${c}`), dt) ?? 0, note: `bienes y servicios ${fmt.pesos(at(D(`crianza.bys.${c}`), dt) ?? 0)} · cuidado ${fmt.pesos(at(D(`crianza.cuid.${c}`), dt) ?? 0)}` }));
    const f = figure({ title: 'Canasta de crianza', subtitle: `Costo mensual de criar a un chico, por edad. ${periodLabel(dt, 'M', 'long')}, GBA. Suma bienes y servicios y el tiempo de cuidado.`, source: sourceLine('crianza.tot.men1'), table: () => ({ columns: ['Edad', 'Bienes y servicios', 'Cuidado', 'Total'], rows: tramos.map(([c, l]) => [l, fmt.pesos(at(D(`crianza.bys.${c}`), dt) ?? 0), fmt.pesos(at(D(`crianza.cuid.${c}`), dt) ?? 0), fmt.pesos(at(D(`crianza.tot.${c}`), dt) ?? 0)]) }) });
    rankedBars(f, rows, { format: fmt.pesos, sort: false });
    crianza = f.node;
  } else {
    crianza = unavailable('Canasta de crianza', 'Cuánto cuesta criar a un chico según su edad, incluido el tiempo de cuidado.');
  }

  return h('div', {},
    sectionHead('canastas', 'Canastas básicas', 'Lo mínimo que necesita un hogar para comer (canasta alimentaria) y para cubrir además ropa, transporte, salud y educación (canasta total).', [rangeControl('canastas')]),
    h('section', { class: 'tiles four' }, ...tiles),
    h('div', { class: 'grid' }, householdCalculator(), f1.node, f2.node, crianza));
}

function trabajo() {
  const keys = [['eph.desocupacion', 'Desocupación', false], ['eph.actividad', 'Actividad', null], ['eph.empleo', 'Empleo', true], ['eph.subocupacion', 'Subocupación', false], ['eph.informalidad.share', 'Informalidad', false]];
  const tiles = keys.filter(([k]) => has(k)).map(([k, label, good]) => {
    const s = D(k); const dd = last(diff(s, 12));
    return tile({ label, value: fmt.pct(last(s)[1]), period: periodLabel(last(s)[0], 'Q'), deltaEl: dd ? delta(dd[1], fmt.pp(dd[1]), 'vs. un año antes', good) : null, spark: lastMonths(s, 40) });
  });
  const pct = { format: (x) => fmt.pct(x), axisFormat: (x) => `${fmt.axis(x)} %`, freq: 'Q' };
  const a = [{ label: 'Desocupación', color: '--s1', data: win('trabajo', D('eph.desocupacion')) }, { label: 'Subocupación', color: '--s2', data: win('trabajo', D('eph.subocupacion')) }];
  const f1 = figure({ title: 'Desocupación y subocupación', subtitle: 'Porcentaje de la población económicamente activa', source: sourceLine('eph.desocupacion'), table: tableFor(a, 'Q', fmt.pct) });
  lineChart(f1, a, pct);
  const b = [{ label: 'Actividad', color: '--s1', data: win('trabajo', D('eph.actividad')) }, { label: 'Empleo', color: '--s2', data: win('trabajo', D('eph.empleo')) }];
  const f2 = figure({ title: 'Actividad y empleo', subtitle: 'Porcentaje de la población total', source: sourceLine('eph.actividad'), table: tableFor(b, 'Q', fmt.pct) });
  lineChart(f2, b, pct);
  let inf;
  if (has('eph.informalidad.share')) {
    const c = [{ label: 'Informalidad', color: '--s1', data: win('trabajo', D('eph.informalidad.share')) }];
    const f3 = figure({ title: 'Informalidad laboral', subtitle: 'Porcentaje de las personas que trabajan sin empleo formal (sin registro ni aportes). El INDEC publica esta serie desde fines de 2023.', source: sourceLine('eph.informalidad'), table: tableFor(c, 'Q', fmt.pct) });
    lineChart(f3, c, pct); inf = f3.node;
  } else inf = unavailable('Empleo informal', 'Qué parte de las personas que trabajan lo hace sin aportes ni registro.');

  return h('div', {},
    sectionHead('trabajo', 'Trabajo', 'Encuesta Permanente de Hogares, 31 aglomerados urbanos. Datos trimestrales.', [rangeControl('trabajo')]),
    h('section', { class: `tiles${tiles.length === 4 ? ' four' : ''}` }, ...tiles),
    h('div', { class: 'grid' }, f1.node, f2.node, inf, glossary([
      ['Tasa de actividad', 'Personas que trabajan o buscan trabajo, sobre la población total.'],
      ['Tasa de empleo', 'Personas que trabajan, sobre la población total.'],
      ['Desocupación', 'Personas que buscan trabajo y no lo consiguen, sobre las que trabajan o buscan.'],
      ['Subocupación', 'Personas que trabajan menos de 35 horas semanales por motivos involuntarios y quieren trabajar más.'],
    ])));
}

function glossary(items) {
  return h('section', { class: 'card glossary' }, h('h3', { text: 'Qué mide cada tasa' }),
    h('dl', {}, ...items.map(([t, d]) => h('div', {}, h('dt', { text: t }), h('dd', { text: d })))));
}

function pobreza() {
  const keys = [['pobreza.personas', 'Personas en la pobreza'], ['pobreza.hogares', 'Hogares en la pobreza'], ['indigencia.personas', 'Personas en la indigencia'], ['indigencia.hogares', 'Hogares en la indigencia']];
  const tiles = keys.filter(([k]) => has(k)).map(([k, label]) => {
    const s = D(k); const dd = last(diff(s, 12));
    return tile({ label, value: fmt.pct(last(s)[1]), period: periodLabel(last(s)[0], 'S'), deltaEl: dd ? delta(dd[1], fmt.pp(dd[1]), 'vs. un año antes', false) : null, spark: s });
  });
  const series = [['pobreza.personas', 'Pobreza, personas', '--s1'], ['pobreza.hogares', 'Pobreza, hogares', '--s2'], ['indigencia.personas', 'Indigencia, personas', '--s3']]
    .filter(([k]) => has(k)).map(([k, label, color]) => ({ label, color, data: win('pobreza', D(k)) }));
  const f1 = figure({ title: 'Pobreza e indigencia', subtitle: 'Porcentaje, por semestre. Total de 31 aglomerados urbanos.', source: sourceLine('pobreza.personas'), table: tableFor(series, 'S', fmt.pct), wide: true });
  lineChart(f1, series, { format: (x) => fmt.pct(x), axisFormat: (x) => `${fmt.axis(x)} %`, freq: 'S', height: 300 });
  return h('div', {},
    sectionHead('pobreza', 'Pobreza', 'Cuántas personas y hogares tienen ingresos que no alcanzan para cubrir las canastas básicas.', [rangeControl('pobreza')]),
    h('section', { class: `tiles${tiles.length === 4 ? ' four' : ''}` }, ...tiles),
    h('div', { class: 'grid' }, f1.node,
      h('section', { class: 'card glossary' }, h('h3', { text: 'Cómo se mide' }),
        h('p', { text: 'Un hogar es pobre cuando su ingreso total no alcanza la canasta básica total para sus integrantes. Es indigente cuando no alcanza ni la canasta alimentaria.' }),
        h('p', { text: 'El dato sale de la Encuesta Permanente de Hogares y cubre las ciudades más grandes del país, donde vive cerca de dos tercios de la población.' }),
        h('a', { class: 'more', href: '#canastas', text: 'Calculá las canastas de tu hogar' })),
      has('indigencia.personas') ? null : unavailable('Indigencia', 'Porcentaje de personas y hogares con ingresos por debajo de la canasta alimentaria.')));
}

function actividad() {
  const orig = D('emae.original'), des = D('emae.desest');
  const yy = change(orig, 12), mm = change(des, 1);
  const ipiY = change(D('ipi.original'), 12), ipiM = change(D('ipi.desest'), 1);
  const tiles = h('section', { class: 'tiles four' },
    tile({ label: 'Actividad, interanual', value: fmt.signedPct(last(yy)[1]), period: periodLabel(last(yy)[0]), note: 'EMAE', spark: lastMonths(yy, 24) }),
    tile({ label: 'Actividad, mensual', value: fmt.signedPct(last(mm)[1]), period: periodLabel(last(mm)[0]), note: 'sin estacionalidad', spark: lastMonths(des, 24) }),
    ipiY.length ? tile({ label: 'Industria, interanual', value: fmt.signedPct(last(ipiY)[1]), period: periodLabel(last(ipiY)[0]), note: 'IPI manufacturero', spark: lastMonths(ipiY, 24) }) : null,
    ipiM.length ? tile({ label: 'Industria, mensual', value: fmt.signedPct(last(ipiM)[1]), period: periodLabel(last(ipiM)[0]), note: 'sin estacionalidad', spark: lastMonths(D('ipi.desest'), 24) }) : null);

  const lv = [{ label: 'Sin estacionalidad', color: '--s1', data: win('actividad', des) }, { label: 'Tendencia-ciclo', color: '--s2', data: win('actividad', D('emae.tendencia')) }];
  const f1 = figure({ title: 'Nivel de actividad económica', subtitle: 'EMAE, índice base 2004 = 100', source: sourceLine('emae.desest'), table: tableFor(lv, 'M', fmt.index) });
  lineChart(f1, lv, { format: fmt.index, axisFormat: fmt.axis });
  const f2 = figure({ title: 'Actividad: variación interanual', subtitle: 'EMAE, serie original, respecto del mismo mes del año anterior', source: sourceLine('emae.original'), table: tableFor([{ label: 'Variación interanual', data: win('actividad', yy) }], 'M', fmt.signedPct) });
  columnChart(f2, win('actividad', yy), { format: fmt.signedPct, axisFormat: (x) => `${fmt.axis(x)} %`, negColor: '--neg', label: 'EMAE' });

  const sectors = Object.entries(SNAP.series).filter(([k]) => k.startsWith('emae.sector.'))
    .map(([, s]) => { const c = last(change(s.data, 12)); return c && { label: s.short, value: c[1], note: periodLabel(c[0]) }; }).filter(Boolean);
  const sd = last(change(D('emae.sector.industria'), 12))?.[0];
  const f3 = figure({ title: 'Qué sectores crecen y cuáles caen', subtitle: `Variación interanual por sector, ${sd ? periodLabel(sd, 'M', 'long') : ''}`, source: sourceLine('emae.sector.industria'), table: () => ({ columns: ['Sector', 'Variación interanual'], rows: [...sectors].sort((a, b) => b.value - a.value).map((r) => [r.label, fmt.signedPct(r.value)]) }) });
  rankedBars(f3, sectors, { format: fmt.signedPct });

  const ipi = [{ label: 'IPI manufacturero', color: '--s1', data: win('actividad', D('ipi.desest')) }];
  const f4 = figure({ title: 'Producción industrial', subtitle: 'IPI manufacturero sin estacionalidad, base 2004 = 100', source: sourceLine('ipi.desest'), table: tableFor(ipi, 'M', fmt.index) });
  lineChart(f4, ipi, { format: fmt.index, axisFormat: fmt.axis, area: false });
  let minero;
  if (has('ipimin.original')) {
    const mi = [{ label: 'IPI minero', color: '--s1', data: win('actividad', D('ipimin.original')) }];
    const f5 = figure({ title: 'Producción minera', subtitle: 'IPI minero, serie original, base 2016 = 100', source: sourceLine('ipimin.original'), table: tableFor(mi, 'M', fmt.index) });
    lineChart(f5, mi, { format: fmt.index, axisFormat: fmt.axis, area: false }); minero = f5.node;
  } else minero = unavailable('Producción minera', 'Índice de producción industrial minero: petróleo, gas, litio, oro y otros minerales.');

  return h('div', {},
    sectionHead('actividad', 'Actividad económica', 'Cuánto produce la economía cada mes (EMAE, una aproximación mensual del PBI) y cómo le va a la industria.', [rangeControl('actividad')]),
    tiles,
    h('div', { class: 'grid' }, f1.node, f2.node, f3.node, f4.node, minero, isacFigure()));
}

function isacFigure() {
  if (!has('isac')) return null;
  const iy = change(D('isac'), 12);
  const f = figure({ title: 'Construcción: variación interanual', subtitle: 'Indicador sintético de la actividad de la construcción (ISAC), serie original', source: sourceLine('isac'), table: tableFor([{ label: 'Variación interanual', data: win('actividad', iy) }], 'M', fmt.signedPct) });
  columnChart(f, win('actividad', iy), { format: fmt.signedPct, axisFormat: (x) => `${fmt.axis(x)} %`, negColor: '--neg', label: 'ISAC' });
  return f.node;
}

function salarios() {
  const head = sectionHead('salarios', 'Salarios', 'Cuánto suben los sueldos según el índice de salarios del INDEC, y si le ganan o no a la inflación.', [rangeControl('salarios')]);
  if (!has('salarios.total', 'ipc.ng.nac')) return h('div', {}, head, h('div', { class: 'grid' }, unavailable('Salarios', 'Evolución de los sueldos registrados, públicos y no registrados.')));
  const ipc = D('ipc.ng.nac');
  const ipcY = change(ipc, 12);
  const groups = [['salarios.privado', 'Registrados privados', '--s1'], ['salarios.publico', 'Sector público', '--s2'], ['salarios.noregistrado', 'No registrados', '--s3']].filter(([k]) => has(k));
  const realIndex = (k) => D(k).filter(([d]) => at(ipc, d) !== undefined).map(([d, v]) => [d, v / at(ipc, d)]);
  const realYoY = (k) => change(realIndex(k), 12);

  const yyW = change(D('salarios.total'), 12);
  const [wd, wv] = last(yyW);
  const inf = at(ipcY, wd);
  const tiles = [tile({ label: 'Salarios, interanual', value: fmt.signedPct(wv), period: periodLabel(wd), note: 'índice total',
    deltaEl: inf !== undefined ? delta(wv - inf, fmt.pp(wv - inf), `vs. la inflación (${fmt.pct(inf)})`, true) : null, spark: lastMonths(yyW, 24) })];
  for (const [k, label] of groups) {
    const y = change(D(k), 12); const r = last(realYoY(k));
    tiles.push(tile({ label, value: fmt.signedPct(last(y)[1]), period: periodLabel(last(y)[0]), note: 'interanual',
      deltaEl: r ? delta(r[1], `${fmt.signedPct(r[1])} real`, 'descontada la inflación', true) : null, spark: lastMonths(y, 24) }));
  }

  // Purchasing power, rebased to 100 at the start of the selected period.
  const real = groups.map(([k, label, color]) => {
    const w = win('salarios', realIndex(k));
    const base = w[0]?.[1];
    return { label, color, data: base ? w.map(([d, v]) => [d, (v / base) * 100]) : [] };
  }).filter((x) => x.data.length);
  const start = real[0]?.data[0]?.[0];
  const f1 = figure({ title: '¿Le ganan los sueldos a la inflación?', subtitle: `Poder de compra del salario, ${start ? periodLabel(start, 'M', 'long') : ''} = 100. Arriba de 100, el sueldo compra más que al principio del período.`, source: sourceLine('salarios.privado', 'ipc.ng.nac'), table: tableFor(real, 'M', fmt.index), wide: true });
  lineChart(f1, real, { format: fmt.index, axisFormat: fmt.axis, height: 300 });

  const vs = [{ label: 'Salarios', color: '--s1', data: win('salarios', yyW) }, { label: 'Inflación', color: '--s2', data: win('salarios', ipcY.filter(([d]) => d <= wd)) }];
  const f2 = figure({ title: 'Salarios e inflación', subtitle: 'Variación interanual, en porcentaje', source: sourceLine('salarios.total', 'ipc.ng.nac'), table: tableFor(vs, 'M', fmt.pct) });
  lineChart(f2, vs, { format: (x) => fmt.pct(x), axisFormat: (x) => `${fmt.axis(x)} %` });

  const rows = groups.map(([k, label]) => { const r = last(realYoY(k)); return r && { label, value: r[1], note: periodLabel(r[0]) }; }).filter(Boolean);
  const f3 = figure({ title: 'Cambio real en el último año', subtitle: 'Variación del salario descontada la inflación, respecto del mismo mes del año anterior', source: sourceLine('salarios.privado', 'ipc.ng.nac'), table: () => ({ columns: ['Grupo', 'Variación real'], rows: rows.map((r) => [r.label, fmt.signedPct(r.value)]) }) });
  rankedBars(f3, rows, { format: fmt.signedPct, sort: false, clip: false });

  return h('div', {}, head,
    h('section', { class: `tiles${tiles.length === 4 ? ' four' : ''}` }, ...tiles),
    h('div', { class: 'grid' }, f1.node, f2.node, f3.node,
      h('section', { class: 'card glossary' }, h('h3', { text: 'Cómo leer estos datos' }),
        h('p', { text: 'El índice de salarios del INDEC sigue cuánto cobra en promedio cada grupo de trabajadores, sin contar cambios de puesto ni de horas.' }),
        h('p', { text: 'El salario real divide el índice de salarios por el IPC: muestra si con el sueldo se puede comprar más o menos que antes.' }),
        h('p', { text: 'El dato de los trabajadores no registrados tiene un rezago de cinco meses: el INDEC lo publica con un retraso mayor que el resto.' }))));
}

function dolar() {
  const M = SNAP.markets ?? {};
  const head = sectionHead('dolar', 'Dólar y mercados', 'Cotizaciones del dólar, riesgo país y reservas del Banco Central. Estos datos no son del INDEC: vienen de cotizaciones de mercado y del BCRA.', [rangeControl('dolar')]);
  if (!M['usd.oficial']) return h('div', {}, head, h('div', { class: 'grid' }, unavailable('Dólar y mercados', 'Las cotizaciones no estaban disponibles en esta actualización.')));
  const usdTile = (k, label) => {
    const q = M[k]; if (!q) return null;
    const ch = q.valor30 ? (q.valor / q.valor30 - 1) * 100 : undefined;
    return tile({ label, value: fmt.pesos(q.valor), period: fmtDate(q.fecha), note: q.compra ? `compra ${fmt.pesos(q.compra)}` : null,
      deltaEl: ch !== undefined ? delta(ch, fmt.signedPct(ch), 'en 30 días', null) : null, spark: lastMonths(D(k), 24) });
  };
  const tiles = [usdTile('usd.oficial', 'Dólar oficial'), usdTile('usd.blue', 'Dólar blue'), usdTile('usd.bolsa', 'Dólar MEP'), usdTile('usd.contadoconliqui', 'Contado con liquidación')];
  if (M['usd.blue'] && M['usd.oficial']) {
    const gap = (M['usd.blue'].valor / M['usd.oficial'].valor - 1) * 100;
    tiles.push(tile({ label: 'Brecha blue / oficial', value: fmt.signedPct(gap), period: fmtDate(M['usd.blue'].fecha), spark: lastMonths(D('usd.brecha'), 24) }));
  }
  tiles.push(usdTile('usd.mayorista', 'Dólar mayorista'));
  if (M.riesgo) {
    const prev = M.riesgo.valor30;
    tiles.push(tile({ label: 'Riesgo país', value: `${fmt.int(M.riesgo.valor)} pb`, period: fmtDate(M.riesgo.fecha), note: 'puntos básicos',
      deltaEl: prev ? delta(M.riesgo.valor - prev, `${M.riesgo.valor - prev > 0 ? '+' : M.riesgo.valor - prev < 0 ? '−' : ''}${fmt.int(Math.abs(M.riesgo.valor - prev))} pb`, 'en 30 días', false) : null, spark: lastMonths(D('riesgo'), 24) }));
  }
  if (M.reservas) {
    const prev = M.reservas.valor30;
    tiles.push(tile({ label: 'Reservas del BCRA', value: fmt.usdM(M.reservas.valor), period: fmtDate(M.reservas.fecha),
      deltaEl: prev ? delta(M.reservas.valor - prev, fmt.signedUsdM(M.reservas.valor - prev), 'en 30 días', true) : null, spark: lastMonths(D('reservas'), 24) }));
  }
  const tl = tiles.filter(Boolean);

  const q = [['usd.oficial', 'Oficial', '--s1'], ['usd.blue', 'Blue', '--s2'], ['usd.bolsa', 'MEP', '--s3']].filter(([k]) => has(k)).map(([k, label, color]) => ({ label, color, data: win('dolar', D(k)) }));
  const f1 = figure({ title: 'Dólar oficial, blue y MEP', subtitle: 'Cotización de venta al cierre de cada mes, en pesos. El último punto es el dato más reciente.', source: sourceLine('usd.oficial'), table: tableFor(q, 'M', fmt.pesos), wide: true });
  lineChart(f1, q, { format: fmt.pesos, axisFormat: fmt.axis, height: 300 });
  const br = win('dolar', D('usd.brecha'));
  const f2 = figure({ title: 'Brecha cambiaria', subtitle: 'Cuánto más caro está el dólar blue que el oficial, al cierre de cada mes', source: sourceLine('usd.blue'), table: tableFor([{ label: 'Brecha', data: br }], 'M', fmt.signedPct) });
  columnChart(f2, br, { format: fmt.signedPct, axisFormat: (x) => `${fmt.axis(x)} %`, negColor: '--neg', label: 'Blue sobre oficial' });
  const rp = [{ label: 'Riesgo país', color: '--s1', data: win('dolar', D('riesgo')) }];
  const f3 = figure({ title: 'Riesgo país', subtitle: 'Puntos básicos al cierre de cada mes. Cuanto más alto, más cara le sale al país la deuda.', source: sourceLine('riesgo'), table: tableFor(rp, 'M', fmt.int) });
  lineChart(f3, rp, { format: (x) => `${fmt.int(x)} pb`, axisFormat: fmt.axis, area: false });
  const rs = [{ label: 'Reservas', color: '--s1', data: win('dolar', D('reservas')) }];
  const f4 = figure({ title: 'Reservas del Banco Central', subtitle: 'Reservas internacionales brutas, millones de dólares, al cierre de cada mes', source: sourceLine('reservas'), table: tableFor(rs, 'M', fmt.usdM) });
  lineChart(f4, rs, { format: fmt.usdM, axisFormat: fmt.axis, area: false });

  return h('div', {}, head,
    h('section', { class: `tiles${tl.length === 8 ? ' four' : ''}` }, ...tl),
    h('div', { class: 'grid' }, f1.node, f2.node, f3.node, f4.node));
}

function comercio() {
  const bal = balance();
  const expo = D('expo.total'), impo = D('impo.total');
  const [ld] = last(expo);
  const b12 = rollingSum(bal, 12);
  const tiles = h('section', { class: 'tiles four' },
    tile({ label: 'Exportaciones', value: fmt.usdM(last(expo)[1]), period: periodLabel(ld), spark: lastMonths(expo, 24) }),
    tile({ label: 'Importaciones', value: fmt.usdM(last(impo)[1]), period: periodLabel(last(impo)[0]), spark: lastMonths(impo, 24) }),
    tile({ label: 'Saldo del mes', value: fmt.signedUsdM(last(bal)[1]), period: periodLabel(last(bal)[0]), spark: lastMonths(bal, 24) }),
    tile({ label: 'Saldo de los últimos 12 meses', value: fmt.signedUsdM(last(b12)[1]), period: `hasta ${periodLabel(last(b12)[0])}`, spark: lastMonths(b12, 36) }));

  const f1 = figure({ title: 'Saldo comercial', subtitle: 'Exportaciones menos importaciones, millones de dólares por mes', source: sourceLine('expo.total', 'impo.total'), table: tableFor([{ label: 'Saldo', data: win('comercio', bal) }], 'M', fmt.signedUsdM), wide: true });
  columnChart(f1, win('comercio', bal), { format: fmt.signedUsdM, axisFormat: fmt.axis, negColor: '--neg', label: 'Saldo' });
  const ei = [{ label: 'Exportaciones', color: '--s1', data: win('comercio', expo) }, { label: 'Importaciones', color: '--s2', data: win('comercio', impo) }];
  const f2 = figure({ title: 'Exportaciones e importaciones', subtitle: 'Millones de dólares por mes', source: sourceLine('expo.total', 'impo.total'), table: tableFor(ei, 'M', fmt.usdM) });
  lineChart(f2, ei, { format: fmt.usdM, axisFormat: fmt.axis });

  const sum12 = (k) => rollingSum(D(k), 12).at(-1)?.[1];
  const ex = [['expo.pp', 'Productos primarios', '--s1'], ['expo.moa', 'Manufacturas agropecuarias', '--s2'], ['expo.moi', 'Manufacturas industriales', '--s3'], ['expo.cye', 'Combustibles y energía', '--s4', true], ['expo.conf', 'Confidencial', '--other']]
    .map(([k, label, color, darkText]) => ({ label, color, darkText, value: sum12(k) })).filter((p) => p.value > 0);
  const f3 = figure({ title: 'Qué exporta la Argentina', subtitle: `Últimos 12 meses hasta ${periodLabel(ld)}, por gran rubro.${ex.some((p) => p.label === 'Confidencial') ? ' «Confidencial»: operaciones que el INDEC no detalla por secreto estadístico.' : ''}`, source: sourceLine('expo.pp', 'expo.moi'), table: () => ({ columns: ['Rubro', 'Millones de US$'], rows: ex.map((p) => [p.label, fmt.usdM(p.value)]) }) });
  segmentedBar(f3, ex, { format: fmt.usdM });
  const otros = (sum12('impo.vap') ?? 0) + (sum12('impo.resto') ?? 0);
  const im = [['impo.bi', 'Bienes intermedios', '--s1'], ['impo.bk', 'Bienes de capital', '--s2'], ['impo.pya', 'Piezas y accesorios', '--s3'], ['impo.bc', 'Bienes de consumo', '--s4', true], ['impo.cyl', 'Combustibles', '--s5']]
    .map(([k, label, color, darkText]) => ({ label, color, darkText, value: sum12(k) })).concat([{ label: 'Autos y resto', color: '--s6', value: otros }]).filter((p) => p.value > 0);
  const f4 = figure({ title: 'Qué importa la Argentina', subtitle: `Últimos 12 meses hasta ${periodLabel(last(impo)[0])}, por uso económico`, source: sourceLine('impo.bi', 'impo.pya'), table: () => ({ columns: ['Uso económico', 'Millones de US$'], rows: im.map((p) => [p.label, fmt.usdM(p.value)]) }) });
  segmentedBar(f4, im, { format: fmt.usdM });

  const extra = [];
  if (SNAP.trade?.countries) {
    for (const [flow, title] of [['expo', 'Principales destinos de las exportaciones'], ['impo', 'Principales orígenes de las importaciones']]) {
      const c = SNAP.trade.countries[flow]; if (!c) continue;
      const rows = c.rows.slice(0, 10).map((r) => ({ label: r.name, value: r.value }));
      const f = figure({ title, subtitle: `Millones de dólares, ${periodLabel(c.from)} a ${periodLabel(c.to)}. No incluye operaciones confidenciales ni sin país asignado.`, source: 'Fuente: INDEC (API oficial)', table: () => ({ columns: ['País', 'Millones de US$'], rows: rows.map((r) => [r.label, fmt.usdM(r.value)]) }) });
      rankedBars(f, rows, { format: fmt.usdM });
      extra.push(f.node);
    }
  } else extra.push(unavailable('Socios comerciales', 'A qué países vende y a cuáles les compra la Argentina.'));

  return h('div', {},
    sectionHead('comercio', 'Comercio exterior', 'Lo que la Argentina vende y compra al resto del mundo, en dólares.', [rangeControl('comercio')]),
    tiles,
    h('div', { class: 'grid' }, f1.node, f2.node, f3.node, f4.node, ...extra));
}

function poblacion() {
  const P = SNAP.population;
  if (!P) {
    return h('div', {},
      sectionHead('poblacion', 'Población', 'Proyecciones del Censo 2022: cuántos somos, cómo cambia la edad de la población y cuánta gente vive en cada provincia.'),
      h('div', { class: 'grid' },
        unavailable('Pirámide de población', 'Varones y mujeres por grupo de edad, de 2022 a 2040.'),
        unavailable('Población por provincia', 'Proyección de habitantes de cada jurisdicción.')));
  }
  const years = Object.keys(P.pyramid).map(Number).sort((a, b) => a - b);
  const now = new Date().getFullYear();
  state.popYear ??= years.includes(now) ? now : years[0];
  const y = state.popYear;
  const pyr = P.pyramid[y];
  const tot = P.totals[y];
  const v = pyr.v.reduce((a, b) => a + b, 0);
  const old = pyr.v.slice(13).concat(pyr.m.slice(13)).reduce((a, b) => a + b, 0);
  const kids = pyr.v.slice(0, 3).concat(pyr.m.slice(0, 3)).reduce((a, b) => a + b, 0);
  const tiles = h('section', { class: 'tiles four' },
    tile({ label: 'Población total', value: fmt.int(tot), period: `al 1 de julio de ${y}` }),
    tile({ label: 'Mujeres', value: fmt.pct(((tot - v) / tot) * 100), period: String(y) }),
    tile({ label: 'Menores de 15 años', value: fmt.pct((kids / tot) * 100), period: String(y) }),
    tile({ label: '65 años y más', value: fmt.pct((old / tot) * 100), period: String(y) }));
  const f1 = figure({ title: `Pirámide de población, ${y}`, subtitle: 'Personas por grupo de edad', source: 'Fuente: INDEC, proyecciones con base en el Censo 2022', table: () => ({ columns: ['Edad', 'Varones', 'Mujeres'], rows: P.bands.map((b, i) => [b, fmt.int(pyr.v[i]), fmt.int(pyr.m[i])]).reverse() }) });
  pyramid(f1, P.bands, pyr.v, pyr.m);
  const totals = [{ label: 'Población', color: '--s1', data: years.map((yy) => [`${yy}-07`, P.totals[yy]]) }];
  const f2 = figure({ title: 'Población total proyectada', subtitle: 'Al 1 de julio de cada año', source: 'Fuente: INDEC, proyecciones con base en el Censo 2022', table: tableFor(totals, 'A', fmt.int) });
  lineChart(f2, totals, { format: fmt.int, axisFormat: fmt.axis, area: false, freq: 'A' });
  const prov = P.provinces.map((p) => ({ label: p.name, value: p.years[y] ?? 0 }));
  const f3 = figure({ title: `Población por provincia, ${y}`, source: 'Fuente: INDEC, proyecciones con base en el Censo 2022', table: () => ({ columns: ['Jurisdicción', 'Población'], rows: [...prov].sort((a, b) => b.value - a.value).map((r) => [r.label, fmt.int(r.value)]) }), className: 'tall' });
  rankedBars(f3, prov, { format: fmt.int, clip: false });
  const sel = h('select', { id: 'pop-year', onchange: (e) => { state.popYear = Number(e.target.value); render(); } }, ...years.map((yy) => h('option', { value: yy, selected: yy === y }, String(yy))));
  return h('div', {},
    sectionHead('poblacion', 'Población', 'Proyecciones del Censo 2022: cuántos somos, cómo cambia la edad de la población y cuánta gente vive en cada provincia.', [h('label', { class: 'segmented', for: 'pop-year' }, h('span', { class: 'seg-name', text: 'Año' }), sel)]),
    tiles,
    h('div', { class: 'grid' }, f1.node, f3.node, f2.node));
}

function fuentes() {
  const rows = Object.entries(SNAP.series).map(([k, s]) => [s.title, ORIGIN_LABEL[s.source] ?? s.source, periodLabel(last(s.data)[0], s.freq), s.sourceId]);
  const signs = [['*', 'Dato provisorio'], ['**', 'Dato preliminar'], ['e', 'Estimado por extrapolación o proyección'], ['i', 'Estimado por imputación'], ['u', 'Calidad inferior al estándar'], ['-', 'Cero absoluto'], ['.', 'Dato no registrado'], ['...', 'No disponible a la fecha de publicación'], ['///', 'Dato que no corresponde presentar'], ['s', 'Confidencial por secreto estadístico']];
  const gen = new Date(SNAP.generated);
  return h('div', {},
    sectionHead('fuentes', 'Fuentes y método', 'De dónde salen los números y cómo se actualizan.'),
    h('div', { class: 'grid' },
      h('section', { class: 'card prose' },
        h('h3', { text: 'Cómo funciona' }),
        h('p', { text: 'Todos los datos son del Instituto Nacional de Estadística y Censos (INDEC). El sitio los descarga una vez por día y los guarda en un único archivo que leen todos los gráficos, así que los números de cada página coinciden entre sí.' }),
        h('p', { text: SNAP.indec ? 'Esta actualización usó la API oficial del INDEC (api.indec.gob.ar).' : 'Esta actualización usó la copia pública que el portal datos.gob.ar hace de las series del INDEC. Algunos indicadores solo están en la API oficial del INDEC y aparecen cuando el sitio se conecta a ella.' }),
        h('p', { text: `Última actualización: ${gen.toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' })}.` }),
        h('p', { text: 'La sección Dólar y mercados no usa datos del INDEC: las cotizaciones y el riesgo país vienen de ArgentinaDatos (api.argentinadatos.com), que reúne cotizaciones de mercado, y las reservas, de la API del Banco Central. Los salarios y el ISAC son del INDEC, publicados en datos.gob.ar.' }),
        h('p', { text: 'Las variaciones se calculan a partir de los índices publicados. Por redondeo, pueden diferir en una décima de las que figuran en los informes técnicos del INDEC.' }),
        h('p', {}, 'IndeX es un proyecto independiente y no es un sitio oficial del INDEC. Documentación de la API: ', h('a', { href: 'https://api.indec.gob.ar/docs', target: '_blank', rel: 'noopener', text: 'api.indec.gob.ar/docs' }), '.')),
      h('section', { class: 'card prose' },
        h('h3', { text: 'Signos convencionales del INDEC' }),
        h('p', { class: 'fig-sub', text: 'Aparecen junto a algunos valores en las publicaciones oficiales.' }),
        h('dl', { class: 'signs' }, ...signs.map(([s, d]) => h('div', {}, h('dt', { text: s }), h('dd', { text: d }))))),
      h('section', { class: 'card wide' },
        h('h3', { text: `Series en esta actualización (${rows.length})` }),
        h('div', { class: 'table-wrap open' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Serie', 'Origen', 'Último dato', 'Identificador'].map((c) => h('th', { scope: 'col', text: c })))),
          h('tbody', {}, rows.map((r) => h('tr', {}, h('th', { scope: 'row', text: r[0] }), h('td', { text: r[1] }), h('td', { text: r[2] }), h('td', { class: 'mono', text: r[3] })))))))));
}

// ------------------------------------------------------------------ router
const SECTIONS = [
  ['inicio', 'Resumen', inicio], ['precios', 'Precios', precios], ['salarios', 'Salarios', salarios], ['canastas', 'Canastas', canastas],
  ['trabajo', 'Trabajo', trabajo], ['pobreza', 'Pobreza', pobreza], ['actividad', 'Actividad', actividad],
  ['comercio', 'Comercio exterior', comercio], ['dolar', 'Dólar', dolar], ['poblacion', 'Población', poblacion], ['fuentes', 'Fuentes', fuentes],
];
const current = () => { const id = location.hash.slice(1); return SECTIONS.find((s) => s[0] === id) ?? SECTIONS[0]; };

function render() {
  const [id, label, fn] = current();
  const main = document.getElementById('main');
  const y = window.scrollY;
  const focused = document.activeElement?.id;
  try {
    main.replaceChildren(h('div', { class: `section section-${id}`, 'aria-label': label }, fn()));
  } catch (err) {
    console.error(err);
    main.replaceChildren(h('section', { class: 'card unavailable' }, h('h3', { text: 'No pudimos mostrar esta sección' }), h('p', { text: 'Falta alguna de las series que usa. Probá con otra sección o volvé más tarde.' })));
  }
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === `#${id}` ? 'page' : 'false'));
  document.title = id === 'inicio' ? 'IndeX · Argentina en datos' : `${label} · IndeX`;
  window.scrollTo(0, y);
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}

function buildChrome() {
  const tabs = document.querySelector('.tabs');
  tabs.replaceChildren(...SECTIONS.map(([id, label]) => h('a', { href: `#${id}`, text: label })));
  const gen = new Date(SNAP.generated);
  document.getElementById('updated').textContent = `Datos al ${gen.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const btn = document.getElementById('theme');
  const apply = (t) => {
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    btn.setAttribute('aria-pressed', String(dark));
    btn.querySelector('span').textContent = dark ? 'Tema claro' : 'Tema oscuro';
  };
  let saved = null;
  try { saved = localStorage.getItem('index-theme'); } catch { /* storage blocked */ }
  apply(saved);
  btn.addEventListener('click', () => {
    const dark = btn.getAttribute('aria-pressed') === 'true';
    const next = dark ? 'light' : 'dark';
    try { localStorage.setItem('index-theme', next); } catch { /* storage blocked */ }
    apply(next);
  });
}

async function boot() {
  try {
    const res = await fetch('data/snapshot.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    SNAP = await res.json();
    derive();
  } catch (err) {
    document.getElementById('main').replaceChildren(h('section', { class: 'card unavailable' }, h('h3', { text: 'No se pudieron cargar los datos' }), h('p', { text: `Recargá la página en unos minutos. Detalle: ${err.message}` })));
    return;
  }
  buildChrome();
  let lastId = current()[0];
  window.addEventListener('hashchange', () => {
    render();
    const id = current()[0];
    if (id !== lastId) { window.scrollTo(0, 0); document.getElementById(`${id}-title`)?.focus?.(); }
    lastId = id;
  });
  render();
}
boot();
