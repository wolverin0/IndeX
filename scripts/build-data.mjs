#!/usr/bin/env node
// Builds data/snapshot.json, the only file the dashboard reads.
//
//   node scripts/build-data.mjs           build the snapshot
//   node scripts/build-data.mjs --probe   list the distinct values of every INDEC
//                                         table (writes data/indec-probe.json)
//
// Sources, in order of preference:
//   1. api.indec.gob.ar  - official API. Needs a personal JWT in INDEC_TOKEN.
//   2. apis.datos.gob.ar - public republication of the same INDEC series.
// A series falls back to (2) whenever (1) is unavailable or does not match.
// Requires Node 18+ (global fetch). No dependencies.

import { writeFile, mkdir } from 'node:fs/promises';
import { SERIES } from './catalog.mjs';

const INDEC = 'https://api.indec.gob.ar/v1';
const DATOS = 'https://apis.datos.gob.ar/series/api/series/';
const TOKEN = process.env.INDEC_TOKEN?.trim();
const START = '2004-01-01';
const OUT = new URL('../data/', import.meta.url);

// Stable sort keys, from the API's OpenAPI document (required for paging).
const ORDER = {
  ipc_nacional: 'clasificador,nivel,codigo,descripcion,periodo,anio,mes,indicador,tipo_de_indicador,tipo_de_indicador_descripcion,region,unidad_de_medida',
  valorizacion_canastas_cba_cbt: 'clasificador,nivel,codigo,descripcion,periodo,anio,mes,indicador,tipo_de_indicador,tipo_de_indicador_descripcion,region,unidad_de_medida',
  sipm_precios_mayoristas: 'operativo,indicador,clasificador,nivel,codigo_apertura,descripcion,periodo,anio,mes,tipo_de_indicador,tipo_de_indicador_descripcion,region,unidad_de_medida',
  icc_precios_construccion: 'indicador,codigo_apertura,codigo_CPC_1,clasificador,nivel,descripcion,periodo,anio,mes,tipo_de_indicador,tipo_de_indicador_descripcion,region,unidad_de_medida',
  'estimador-mensual-de-actividad-economica-nivel-general': 'tipo_de_indicador_descripcion,anio,mes,periodo,tipo_de_indicador',
  'estimador-mensual-de-actividad-economica-sectores': 'anio,mes,codigo,descripcion,periodo,tipo_de_indicador',
  ipi_manufacturero: 'periodo,indicador,cuadro_web,codigo_CLaNAE_2004,descripcion,serie,tipo_de_indicador',
  ipi_minero: 'periodo,anio,mes,indicador,cuadro_web,codigo_ClaNAE_2010,codigo_CPC_2_1,serie,descripcion,tipo_de_indicador,unidad_de_medida',
  pobreza_eph: 'area_geografica_nom,periodo',
  mercado_trabajo_eph: 'area_geografica_nom,periodo',
  'canasta-crianza': 'Periodo',
  comercio_exterior_nomenclaturas: 'nombre_columna,codigo',
  comercio_exterior_exportacion_bienes: 'Anio,Mes,Periodo,rubro_cod,subrubro_cod,pais_cod',
  comercio_exterior_importacion_bienes: 'Anio,Mes,Periodo,uso_economico_cod,gce_cod,pais_cod',
  proyecciones_poblacion_nacional_2022_2040: 'edad,sexo_cod,fecha',
  proyecciones_poblacion_jurisdiccion_2022_2040: 'jurisdiccion_cod,sexo_cod,edad_cod,fecha',
};
// Server-side filters, to keep the big tables small.
const FILTER = {
  comercio_exterior_exportacion_bienes: 'Anio=gte.2010',
  comercio_exterior_importacion_bienes: 'Anio=gte.2010',
};

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const pad = (n) => String(n).padStart(2, '0');
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, headers = {}, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
      return await res.json();
    } catch (err) {
      if (err.fatal || i >= tries - 1) throw err;
      await sleep(2000 * 2 ** i);
    }
  }
}

// ---------------------------------------------------------------- INDEC API
// Columns we need from the big tables (smaller payloads, faster paging).
const SELECT = {
  comercio_exterior_exportacion_bienes: 'Anio,Mes,rubro_cod,pais_cod,valor_FOB',
  comercio_exterior_importacion_bienes: 'Anio,Mes,uso_economico_cod,pais_cod,valor_CIF',
};

async function indecPage(endpoint, offset, withCount = false) {
  const q = new URLSearchParams({ order: ORDER[endpoint], limit: '1000', offset: String(offset) });
  if (SELECT[endpoint]) q.set('select', SELECT[endpoint]);
  const url = `${INDEC}/${endpoint}?${q}${FILTER[endpoint] ? `&${FILTER[endpoint]}` : ''}`;
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, ...(withCount ? { Prefer: 'count=exact' } : {}) } });
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-range')?.split('/')[1]);
      return { rows: await res.json(), total };
    } catch (err) {
      if (err.fatal || i >= 3) throw err;
      await sleep(2000 * 2 ** i);
    }
  }
}

const tableCache = new Map();
async function indecTable(endpoint) {
  if (tableCache.has(endpoint)) return tableCache.get(endpoint);
  const p = (async () => {
    const first = await indecPage(endpoint, 0, true);
    const pages = [first.rows];
    const offsets = [];
    for (let o = 1000; o < (first.total || 0); o += 1000) offsets.push(o);
    let next = 0;
    const worker = async () => {
      while (next < offsets.length) {
        const k = next++;
        pages[k + 1] = (await indecPage(endpoint, offsets[k])).rows;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const rows = pages.flat();
    log(`  indec ${endpoint}: ${rows.length} filas`);
    return rows;
  })();
  tableCache.set(endpoint, p);
  return p;
}

const pick = (row, ...names) => {
  for (const n of names) {
    const k = Object.keys(row).find((key) => key.toLowerCase() === n.toLowerCase());
    if (k !== undefined && row[k] !== null && row[k] !== '') return row[k];
  }
  return undefined;
};

/** Normalizes a row's period to YYYY-MM (quarters/semesters -> first month). */
function rowDate(row) {
  const year = Number(pick(row, 'anio'));
  const tri = pick(row, 'trimestre');
  const sem = pick(row, 'semestre');
  if (year && tri) return `${year}-${pad((Number(String(tri).match(/\d/)?.[0]) - 1) * 3 + 1)}`;
  if (year && sem) return `${year}-${pad(Number(String(sem).match(/\d/)?.[0]) === 2 ? 7 : 1)}`;
  const mes = pick(row, 'mes');
  if (year && mes) return `${year}-${pad(Number(mes))}`;
  const per = String(pick(row, 'periodo') ?? '');
  if (/^\d{6}$/.test(per)) return `${per.slice(0, 4)}-${per.slice(4)}`;
  return null;
}

function isIndexRow(row) {
  const t = norm(`${pick(row, 'tipo_de_indicador') ?? ''} ${pick(row, 'tipo_de_indicador_descripcion') ?? ''}`);
  if (!t) return true;
  return /indice|nivel/.test(t) && !/variaci|incidencia|ponderac|peso/.test(t);
}
function isLevelRow(row) {
  const t = norm(`${pick(row, 'tipo_de_indicador') ?? ''} ${pick(row, 'tipo_de_indicador_descripcion') ?? ''} ${pick(row, 'unidad_de_medida') ?? ''}`);
  return !/variaci|incidencia|%|porcentaje/.test(t);
}
const rowText = (row) => norm(Object.values(row).filter((v) => typeof v === 'string').join(' | '));

/** Pulls one catalog series out of an INDEC table. Returns [[date, value]] or null. */
async function indecSeries(def) {
  const spec = def.indec;
  if (!spec || spec.trade) return null;
  const rows = await indecTable(spec.endpoint);
  const out = new Map();
  let conflicts = 0;
  for (const row of rows) {
    let value;
    if (spec.column) {
      // Wide tables (EPH, canasta de crianza): one column per indicator.
      const area = norm(pick(row, 'area_geografica_nom') ?? 'total');
      if (!/t_31|total|31/.test(area)) continue;
      value = pick(row, spec.column);
    } else {
      if (spec.region && !spec.region.test(norm(pick(row, 'region')))) continue;
      if (spec.desc && !spec.desc.test(norm(pick(row, 'descripcion')))) continue;
      if (spec.serie && !spec.serie.test(norm(pick(row, 'serie')))) continue;
      if (spec.code && !spec.code.test(norm(pick(row, 'codigo')))) continue;
      if (spec.nivel && !spec.nivel.test(norm(pick(row, 'nivel')))) continue;
      const txt = rowText(row);
      if (spec.text && !spec.text.test(txt)) continue;
      if (spec.notText && spec.notText.test(txt)) continue;
      if (def.unit === 'Pesos' ? !isLevelRow(row) : !isIndexRow(row)) continue;
      value = pick(row, 'valor');
    }
    const num = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
    const date = rowDate(row);
    if (!date || value === undefined || !Number.isFinite(num)) continue;
    if (out.has(date) && Math.abs(out.get(date) - num) > 1e-6) conflicts++;
    if (!out.has(date)) out.set(date, num);
  }
  if (!out.size) return null;
  if (conflicts) log(`  ! ${def.key}: ${conflicts} períodos con más de un valor; se usó el primero`);
  let data = [...out].sort((a, b) => a[0].localeCompare(b[0]));
  if (def.unit === '%' && Math.max(...data.map((d) => d[1])) <= 1) data = data.map(([d, v]) => [d, v * 100]);
  return data;
}

async function indecTrade() {
  const nom = await indecTable('comercio_exterior_nomenclaturas');
  const names = {};
  for (const r of nom) (names[norm(r.nombre_columna)] ??= {})[String(r.codigo)] = r.codigo_descripcion;
  const label = (col, code) => names[norm(col)]?.[String(code)] ?? String(code);

  const RUBROS = [['expo.pp', /primarios/], ['expo.moa', /agropecuario/], ['expo.moi', /industrial/], ['expo.cye', /combustible/], ['expo.conf', /confidencial|desconocido|no se puede/]];
  const USOS = [['impo.bk', /^bienes de capital/], ['impo.bi', /intermedios/], ['impo.cyl', /combustibles/], ['impo.pya', /piezas/], ['impo.bc', /consumo/], ['impo.vap', /vehiculos/], ['impo.resto', /resto/]];

  const series = {};
  const countries = {};
  for (const [flow, endpoint, codeCol, valueCol, groups] of [
    ['expo', 'comercio_exterior_exportacion_bienes', 'rubro_cod', 'valor_FOB', RUBROS],
    ['impo', 'comercio_exterior_importacion_bienes', 'uso_economico_cod', 'valor_CIF', USOS],
  ]) {
    const rows = await indecTable(endpoint);
    const total = new Map();
    const byGroup = Object.fromEntries(groups.map(([k]) => [k, new Map()]));
    const byCountry = new Map();
    let last = '';
    for (const r of rows) {
      const date = rowDate(r);
      const v = Number(pick(r, valueCol));
      if (!date || !Number.isFinite(v)) continue;
      const usd = v / 1e6;
      total.set(date, (total.get(date) ?? 0) + usd);
      const g = groups.find(([, re]) => re.test(norm(label(codeCol, pick(r, codeCol)))));
      if (g) byGroup[g[0]].set(date, (byGroup[g[0]].get(date) ?? 0) + usd);
      if (date > last) last = date;
    }
    // Last 12 months by country.
    const from = shiftMonth(last, -11);
    for (const r of rows) {
      const date = rowDate(r);
      const v = Number(pick(r, valueCol));
      if (!date || date < from || !Number.isFinite(v)) continue;
      const c = String(pick(r, 'pais_cod'));
      byCountry.set(c, (byCountry.get(c) ?? 0) + v / 1e6);
    }
    const sorted = (m) => [...m].sort((a, b) => a[0].localeCompare(b[0]));
    series[`${flow}.total`] = sorted(total);
    for (const [k] of groups) if (byGroup[k].size) series[k] = sorted(byGroup[k]);
    countries[flow] = {
      from, to: last,
      // "Indeterminado", "Confidencial" and similar codes are not countries.
      rows: [...byCountry].map(([code, v]) => ({ code, name: label('pais_cod', code), value: v }))
        .filter((r) => !/indeterminad|confidencial|desconocid|no se puede/.test(norm(r.name)))
        .sort((a, b) => b.value - a.value).slice(0, 15),
    };
  }
  return { series, countries };
}

async function indecPopulation() {
  const nac = await indecTable('proyecciones_poblacion_nacional_2022_2040');
  const isTotalSex = (r) => /total|ambos/.test(norm(r.sexo_nom));
  const sexOf = (r) => (/var|homb|masc/.test(norm(r.sexo_nom)) ? 'v' : /muj|fem/.test(norm(r.sexo_nom)) ? 'm' : null);
  const yearOf = (r) => Number(String(r.fecha).slice(0, 4));
  const pyramid = {};
  const totals = {};
  for (const r of nac) {
    const year = yearOf(r);
    const age = Number(String(r.edad).match(/\d+/)?.[0]);
    if (!year || !Number.isFinite(age) || /total/.test(norm(r.edad))) continue;
    const sex = sexOf(r);
    const pop = Number(r.poblacion);
    if (!Number.isFinite(pop)) continue;
    if (sex) {
      const band = Math.min(Math.floor(age / 5), 20); // 0-4 ... 95-99, 100+
      const y = (pyramid[year] ??= { v: Array(21).fill(0), m: Array(21).fill(0) });
      y[sex][band] += pop;
      totals[year] = (totals[year] ?? 0) + pop;
    } else if (isTotalSex(r)) {
      // ignore: we sum the two sexes instead
    }
  }
  const jur = await indecTable('proyecciones_poblacion_jurisdiccion_2022_2040');
  const prov = {};
  const hasTotalRows = jur.some((r) => /total/.test(norm(r.edad_nom)) && /total|ambos/.test(norm(r.sexo_nom)));
  for (const r of jur) {
    const year = yearOf(r);
    const pop = Number(r.poblacion);
    if (!year || !Number.isFinite(pop) || /^00$|total del pais/.test(norm(r.jurisdiccion_cod) + ' ' + norm(r.jurisdiccion_nom))) continue;
    const totalAge = /total/.test(norm(r.edad_nom));
    const totalSex = /total|ambos/.test(norm(r.sexo_nom));
    if (hasTotalRows ? !(totalAge && totalSex) : (totalAge || totalSex)) continue;
    const p = (prov[r.jurisdiccion_cod] ??= { name: r.jurisdiccion_nom, years: {} });
    p.years[year] = (p.years[year] ?? 0) + pop;
  }
  if (!Object.keys(totals).length) return null;
  return {
    source: 'indec',
    bands: Array.from({ length: 21 }, (_, i) => (i === 20 ? '100+' : `${i * 5}-${i * 5 + 4}`)),
    totals, pyramid,
    provinces: Object.entries(prov).map(([code, p]) => ({ code, ...p })),
  };
}

// ----------------------------------------------------------- datos.gob.ar
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// One request per series: the API collapses a mixed-frequency batch to its
// lowest frequency, so batching monthly and quarterly ids would lose data.
async function datosSeries(defs) {
  // Every raw id we need, including the parts of derived series.
  const ids = new Set();
  for (const d of defs) [d.fallback.id, ...(d.fallback.plus ?? []), ...(d.fallback.minus ?? [])].filter(Boolean).forEach((id) => ids.add(id));
  const raw = {};
  let done = 0;
  const queue = [...ids];
  const worker = async () => {
    for (let id; (id = queue.shift()); ) {
      const q = new URLSearchParams({ ids: id, start_date: START, limit: '1000', format: 'json' });
      try {
        const res = await getJSON(`${DATOS}?${q}`);
        raw[id] = new Map(res.data.filter((row) => row[1] !== null).map((row) => [row[0].slice(0, 7), row[1]]));
      } catch (err) {
        log(`  ! ${id}: ${err.message}`);
      }
      if (++done % 10 === 0 || done === ids.size) log(`  datos.gob.ar: ${done}/${ids.size} series`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  const out = {};
  for (const def of defs) {
    const { id, plus, minus = [], scale = 1, shiftMonths = 0 } = def.fallback;
    let values;
    if (id) values = raw[id];
    else {
      // Derived: sum(plus) - sum(minus), only for months where every part exists.
      const parts = [...plus, ...minus].map((p) => raw[p]);
      if (parts.some((p) => !p)) continue;
      values = new Map();
      for (const [date] of raw[plus[0]]) {
        if (!parts.every((p) => p.has(date))) continue;
        values.set(date, plus.reduce((s, p) => s + raw[p].get(date), 0) - minus.reduce((s, p) => s + raw[p].get(date), 0));
      }
    }
    if (!values?.size) continue;
    out[def.key] = [...values].map(([date, v]) => [shiftMonth(date, shiftMonths), +(v * scale).toPrecision(10)]);
  }
  return out;
}

// ------------------------------------------------------------------- probe
async function probe() {
  if (!TOKEN) throw new Error('--probe necesita INDEC_TOKEN');
  const report = {};
  for (const endpoint of Object.keys(ORDER)) {
    const q = new URLSearchParams({ order: ORDER[endpoint], limit: '1000' });
    const rows = await getJSON(`${INDEC}/${endpoint}?${q}`, { Authorization: `Bearer ${TOKEN}` });
    const cols = {};
    for (const r of rows) for (const [k, v] of Object.entries(r)) if (typeof v === 'string') (cols[k] ??= new Set()).add(v);
    report[endpoint] = { sample: rows.slice(0, 3), distinct: Object.fromEntries(Object.entries(cols).map(([k, s]) => [k, [...s].slice(0, 60)])) };
    log(`probe ${endpoint}: ${rows.length} filas`);
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(new URL('indec-probe.json', OUT), JSON.stringify(report, null, 2));
  log('Escrito data/indec-probe.json');
}

// -------------------------------------------------------------------- main
async function main() {
  if (process.argv.includes('--probe')) return probe();
  const defs = Object.values(SERIES);
  const result = {};
  const status = {};
  let indecOk = Boolean(TOKEN);
  let trade = null;
  let population = null;

  if (indecOk) {
    log('Leyendo api.indec.gob.ar ...');
    try {
      for (const def of defs) {
        try {
          const data = await indecSeries(def);
          if (data?.length) { result[def.key] = data; status[def.key] = 'indec'; }
        } catch (err) {
          if (err.fatal) throw err;
          log(`  ! ${def.key}: ${err.message}`);
        }
      }
      try {
        trade = await indecTrade();
        for (const [k, data] of Object.entries(trade.series)) if (data.length) { result[k] = data; status[k] = 'indec'; }
      } catch (err) { if (err.fatal) throw err; log(`  ! comercio exterior: ${err.message}`); }
      try { population = await indecPopulation(); } catch (err) { if (err.fatal) throw err; log(`  ! población: ${err.message}`); }
    } catch (err) {
      indecOk = false;
      log(`  ! La API del INDEC rechazó el token (${err.message}). Se usa solo datos.gob.ar.`);
    }
  } else {
    log('Sin INDEC_TOKEN: se usa la publicación abierta de datos.gob.ar.');
  }

  const missing = defs.filter((d) => !result[d.key] && d.fallback);
  if (missing.length) {
    log('Leyendo apis.datos.gob.ar ...');
    const got = await datosSeries(missing);
    for (const [k, data] of Object.entries(got)) if (data.length) { result[k] = data; status[k] = 'datos.gob.ar'; }
  }

  const series = {};
  for (const def of defs) {
    if (!result[def.key]) continue;
    series[def.key] = {
      title: def.title, short: def.short, unit: def.unit, freq: def.freq,
      source: status[def.key],
      sourceId: status[def.key] === 'indec' ? def.indec.endpoint : def.fallback.id,
      data: result[def.key],
    };
  }

  const snapshot = {
    generated: new Date().toISOString(),
    indec: indecOk,
    series,
    trade: trade ? { countries: trade.countries } : null,
    population,
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(new URL('snapshot.json', OUT), JSON.stringify(snapshot));

  const absent = defs.filter((d) => !series[d.key]).map((d) => d.key);
  log(`\n${Object.keys(series).length}/${defs.length} series · INDEC: ${Object.values(status).filter((s) => s === 'indec').length} · datos.gob.ar: ${Object.values(status).filter((s) => s === 'datos.gob.ar').length}`);
  if (absent.length) log(`Sin datos (requieren INDEC_TOKEN): ${absent.join(', ')}`);
  log(`Población: ${population ? 'sí' : 'no'} · Destinos comerciales: ${trade ? 'sí' : 'no'}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
