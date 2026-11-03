// Catalog of every series the dashboard uses.
//
// Each entry names where the series comes from:
//   indec    -> how to pull it from api.indec.gob.ar (needs INDEC_TOKEN)
//   fallback -> a public series id on apis.datos.gob.ar (the national open data
//               portal republishes INDEC series; no token needed)
//
// Dates are normalized to "YYYY-MM": months as-is, quarters by their first
// month (T1 -> 01, T2 -> 04 ...), semesters by their first month (S1 -> 01, S2 -> 07).

const IPC_DIVISIONS = [
  ['alimentos', 'Alimentos y bebidas no alcohólicas', /^alimentos y bebidas no alcoholicas/, '146.3_IALIMENNAL_DICI_M_45'],
  ['bebidas', 'Bebidas alcohólicas y tabaco', /^bebidas alcoholicas y tabaco/, '146.3_IBEBIDANAL_DICI_M_39'],
  ['prendas', 'Prendas de vestir y calzado', /^prendas de vestir y calzado/, '146.3_IPRENDANAL_DICI_M_35'],
  ['vivienda', 'Vivienda, agua, electricidad, gas y otros combustibles', /^vivienda, agua, electricidad/, '146.3_IVIVIENNAL_DICI_M_52'],
  ['equipamiento', 'Equipamiento y mantenimiento del hogar', /^equipamiento y mantenimiento del hogar/, '146.3_IEQUIPANAL_DICI_M_46'],
  ['salud', 'Salud', /^salud$/, '146.3_ISALUDNAL_DICI_M_18'],
  ['transporte', 'Transporte', /^transporte$/, '146.3_ITRANSPNAL_DICI_M_23'],
  ['comunicacion', 'Comunicación', /^comunicacion$/, '146.3_ICOMUNINAL_DICI_M_27'],
  ['recreacion', 'Recreación y cultura', /^recreacion y cultura/, '146.3_IRECREANAL_DICI_M_31'],
  ['educacion', 'Educación', /^educacion$/, '146.3_IEDUCACNAL_DICI_M_22'],
  ['restaurantes', 'Restaurantes y hoteles', /^restaurantes y hoteles/, '146.3_IRESTAUNAL_DICI_M_33'],
  ['varios', 'Bienes y servicios varios', /^bienes y servicios varios/, '146.3_IBIENESNAL_DICI_M_36'],
];

const IPC_REGIONS = [
  ['nac', 'Total nacional', /nacional/, '148.3_INIVELNAL_DICI_M_26'],
  ['gba', 'GBA', /^gba$|gran buenos aires/, '148.3_INIVELGBA_DICI_M_21'],
  ['pampeana', 'Pampeana', /pampeana/, '148.3_INIVELANA_DICI_M_26'],
  ['noa', 'Noroeste', /noroeste/, '145.3_INGNOANOA_DICI_M_10'],
  ['nea', 'Noreste', /noreste|nordeste/, '148.3_INIVELNEA_DICI_M_21'],
  ['cuyo', 'Cuyo', /cuyo/, '148.3_INIVELUYO_DICI_M_22'],
  ['patagonia', 'Patagonia', /patagoni/, '148.3_INIVELNIA_DICI_M_27'],
];

const EMAE_SECTORS = [
  ['agro', 'Agro, ganadería y silvicultura', /agricultura/, '11.3_ISOM_2004_M_39'],
  ['pesca', 'Pesca', /^pesca/, '11.3_VIPAA_2004_M_5'],
  ['mineria', 'Minas y canteras', /minas y canteras/, '11.3_ISD_2004_M_26'],
  ['industria', 'Industria manufacturera', /industria manufacturera/, '11.3_VMASD_2004_M_23'],
  ['energia', 'Electricidad, gas y agua', /electricidad, gas y agua/, '11.3_ITC_2004_M_21'],
  ['construccion', 'Construcción', /^construccion/, '11.3_VMATC_2004_M_12'],
  ['comercio', 'Comercio', /^comercio/, '11.3_AGCS_2004_M_41'],
  ['hoteles', 'Hoteles y restaurantes', /hoteles y restaurantes/, '11.3_P_2004_M_20'],
  ['transporte', 'Transporte y comunicaciones', /transporte/, '11.3_EMC_2004_M_25'],
  ['finanzas', 'Intermediación financiera', /intermediacion financiera/, '11.3_IM_2004_M_25'],
  ['inmobiliarias', 'Inmobiliarias y empresariales', /inmobiliarias/, '11.3_SEGA_2004_M_48'],
  ['admpublica', 'Administración pública', /administracion publica/, '11.3_C_2004_M_60'],
  ['ensenanza', 'Enseñanza', /^ensenanza/, '11.3_CMMR_2004_M_10'],
  ['salud', 'Servicios sociales y salud', /servicios sociales/, '11.3_HR_2004_M_24'],
  ['comunitarios', 'Otros servicios comunitarios', /servicios comunitarios/, '11.3_TAC_2004_M_60'],
];

/** @type {Record<string, any>} */
export const SERIES = {};

const add = (key, def) => { SERIES[key] = { key, ...def }; };

// ---- Precios ---------------------------------------------------------------
for (const [code, name, re, id] of IPC_REGIONS) {
  add(`ipc.ng.${code}`, {
    title: `IPC nivel general · ${name}`, short: name, unit: 'Índice dic-2016=100', freq: 'M',
    indec: { endpoint: 'ipc_nacional', region: re, desc: /^nivel general/ },
    fallback: { id },
  });
}
add('ipc.nucleo', {
  title: 'IPC núcleo', short: 'Núcleo', unit: 'Índice dic-2016=100', freq: 'M',
  indec: { endpoint: 'ipc_nacional', region: /nacional/, desc: /^nucleo/ },
  fallback: { id: '148.3_INUCLEONAL_DICI_M_19' },
});
add('ipc.regulados', {
  title: 'IPC regulados', short: 'Regulados', unit: 'Índice dic-2016=100', freq: 'M',
  indec: { endpoint: 'ipc_nacional', region: /nacional/, desc: /^regulados/ },
  fallback: { id: '148.3_IREGULANAL_DICI_M_22' },
});
add('ipc.estacionales', {
  title: 'IPC estacionales', short: 'Estacionales', unit: 'Índice dic-2016=100', freq: 'M',
  indec: { endpoint: 'ipc_nacional', region: /nacional/, desc: /^estacional/ },
  fallback: { id: '148.3_IESTACINAL_DICI_M_25' },
});
for (const [code, name, re, id] of IPC_DIVISIONS) {
  add(`ipc.div.${code}`, {
    title: `IPC · ${name}`, short: name, unit: 'Índice dic-2016=100', freq: 'M',
    indec: { endpoint: 'ipc_nacional', region: /nacional/, desc: re },
    fallback: { id },
  });
}
add('ipim', {
  title: 'Precios mayoristas (IPIM)', short: 'IPIM', unit: 'Índice dic-2015=100', freq: 'M',
  indec: { endpoint: 'sipm_precios_mayoristas', text: /\bipim\b/, desc: /^nivel general/ },
  fallback: { id: '448.1_NIVEL_GENERAL_0_0_13_46' },
});
add('icc', {
  title: 'Costo de la construcción (ICC)', short: 'ICC', unit: 'Índice ene-2022=100', freq: 'M',
  indec: { endpoint: 'icc_precios_construccion', desc: /^nivel general/ },
});

// ---- Canastas --------------------------------------------------------------
add('cba', {
  title: 'Canasta básica alimentaria (CBA) por adulto equivalente', short: 'CBA', unit: 'Pesos', freq: 'M',
  indec: { endpoint: 'valorizacion_canastas_cba_cbt', code: /^cba$/, nivel: /adulto/, notText: /variaci/ },
  fallback: { id: '150.1_CSTA_BARIA_0_D_26' },
});
add('cbt', {
  title: 'Canasta básica total (CBT) por adulto equivalente', short: 'CBT', unit: 'Pesos', freq: 'M',
  indec: { endpoint: 'valorizacion_canastas_cba_cbt', code: /^cbt$/, nivel: /adulto/, notText: /variaci/ },
  fallback: { id: '150.1_CSTA_BATAL_0_D_20' },
});
for (const [code, label] of [['men1', 'Menores de 1 año'], ['1a3', 'De 1 a 3 años'], ['4a5', 'De 4 a 5 años'], ['6a12', 'De 6 a 12 años']]) {
  for (const [part, partLabel] of [['tot', 'Total'], ['bys', 'Bienes y servicios'], ['cuid', 'Cuidado']]) {
    add(`crianza.${part}.${code}`, {
      title: `Canasta de crianza · ${label} · ${partLabel}`, short: label, unit: 'Pesos', freq: 'M',
      indec: { endpoint: 'canasta-crianza', column: `${part}_${code}` },
    });
  }
}

// ---- Trabajo e ingresos ----------------------------------------------------
const EPH_TRABAJO = [
  ['actividad', 'Tasa de actividad', 'tasa_de_actividad', '43.2_ECTAT_0_T_33'],
  ['empleo', 'Tasa de empleo', 'tasa_de_empleo', '44.2_ECTET_0_T_30'],
  ['desocupacion', 'Tasa de desocupación', 'tasa_de_desocupacion', '45.2_ECTDT_0_T_33'],
  ['subocupacion', 'Tasa de subocupación', 'tasa_de_subocupacion', '46.2_ECTST_0_T_36'],
  ['informalidad', 'Tasa de empleo informal', 'tasa_de_empleo_informal', null],
];
for (const [code, title, column, id] of EPH_TRABAJO) {
  add(`eph.${code}`, {
    title, short: title.replace('Tasa de ', ''), unit: '%', freq: 'Q',
    indec: { endpoint: 'mercado_trabajo_eph', column },
    fallback: id ? { id, scale: 100 } : undefined,
  });
}
const EPH_POBREZA = [
  ['pobreza.personas', 'Pobreza (personas)', 'tasa_pobreza_personas', '64.2_POBLACION_NUA_0_0_34_74'],
  ['pobreza.hogares', 'Pobreza (hogares)', 'tasa_pobreza_hogares', '63.2_HOGARES_PONUA_0_0_33_21'],
  ['indigencia.personas', 'Indigencia (personas)', 'tasa_indigencia_personas', null],
  ['indigencia.hogares', 'Indigencia (hogares)', 'tasa_indigencia_hogares', null],
];
for (const [code, title, column, id] of EPH_POBREZA) {
  add(code, {
    title, short: title, unit: '%', freq: 'S',
    indec: { endpoint: 'pobreza_eph', column },
    // datos.gob.ar stamps each semester six months late (S1 2024 sits on 2024-07).
    fallback: id ? { id, scale: 100, shiftMonths: -6 } : undefined,
  });
}

// ---- Actividad -------------------------------------------------------------
add('emae.original', {
  title: 'EMAE · serie original', short: 'Original', unit: 'Índice 2004=100', freq: 'M',
  indec: { endpoint: 'estimador-mensual-de-actividad-economica-nivel-general', text: /original/ },
  fallback: { id: '143.3_NO_PR_2004_A_21' },
});
add('emae.desest', {
  title: 'EMAE · desestacionalizada', short: 'Desestacionalizada', unit: 'Índice 2004=100', freq: 'M',
  indec: { endpoint: 'estimador-mensual-de-actividad-economica-nivel-general', text: /desestacionalizad/ },
  fallback: { id: '143.3_NO_PR_2004_A_31' },
});
add('emae.tendencia', {
  title: 'EMAE · tendencia-ciclo', short: 'Tendencia-ciclo', unit: 'Índice 2004=100', freq: 'M',
  indec: { endpoint: 'estimador-mensual-de-actividad-economica-nivel-general', text: /tendencia/ },
  fallback: { id: '143.3_NO_PR_2004_A_28' },
});
for (const [code, name, re, id] of EMAE_SECTORS) {
  add(`emae.sector.${code}`, {
    title: `EMAE · ${name}`, short: name, unit: 'Índice 2004=100', freq: 'M',
    indec: { endpoint: 'estimador-mensual-de-actividad-economica-sectores', desc: re },
    fallback: { id },
  });
}
add('ipi.original', {
  title: 'IPI manufacturero · serie original', short: 'Original', unit: 'Índice 2004=100', freq: 'M',
  indec: { endpoint: 'ipi_manufacturero', desc: /nivel general/, serie: /original/ },
  fallback: { id: '453.1_SERIE_ORIGNAL_0_0_14_46' },
});
add('ipi.desest', {
  title: 'IPI manufacturero · desestacionalizada', short: 'Desestacionalizada', unit: 'Índice 2004=100', freq: 'M',
  indec: { endpoint: 'ipi_manufacturero', desc: /nivel general/, serie: /desestacionalizad/ },
  fallback: { id: '453.1_SERIE_DESEADA_0_0_24_58' },
});
add('ipimin.original', {
  title: 'IPI minero · serie original', short: 'Minería', unit: 'Índice 2016=100', freq: 'M',
  indec: { endpoint: 'ipi_minero', desc: /nivel general/, serie: /original/ },
});

// ---- Comercio exterior -----------------------------------------------------
// Some datos.gob.ar copies of these series stopped updating, so a few are
// derived from the totals (the parts add up to the total by definition).
const TRADE = [
  ['expo.total', 'Exportaciones', { id: '74.3_IET_0_M_16' }],
  ['impo.total', 'Importaciones', { id: '74.3_IIT_0_M_25' }],
  ['expo.pp', 'Productos primarios', { id: '74.3_IEPP_0_M_35' }],
  ['expo.moa', 'Manufacturas de origen agropecuario', { id: '74.3_IEMOA_0_M_48' }],
  ['expo.moi', 'Manufacturas de origen industrial', { id: '75.3_ITM_0_M_13' }],
  ['expo.cye', 'Combustibles y energía', { plus: ['74.3_IET_0_M_16'], minus: ['74.3_IEPP_0_M_35', '74.3_IEMOA_0_M_48', '75.3_ITM_0_M_13'] }],
  ['expo.conf', 'Confidencial o sin asignar', undefined],
  ['impo.bk', 'Bienes de capital', { id: '74.3_IIBCA_0_M_32' }],
  ['impo.bi', 'Bienes intermedios', { id: '74.3_IIBI_0_M_36' }],
  ['impo.cyl', 'Combustibles y lubricantes', { plus: ['74.3_IIT_0_M_25'], minus: ['74.3_IBCPP_0_M_32', '74.3_IIBI_0_M_36', '74.3_IIBCO_0_M_32', '74.3_IIVAP_0_M_49', '74.3_IIR_0_M_23'] }],
  ['impo.pya', 'Piezas y accesorios para bienes de capital', { plus: ['74.3_IBCPP_0_M_32'], minus: ['74.3_IIBCA_0_M_32'] }],
  ['impo.bc', 'Bienes de consumo', { id: '74.3_IIBCO_0_M_32' }],
  ['impo.vap', 'Vehículos automotores de pasajeros', { id: '74.3_IIVAP_0_M_49' }],
  ['impo.resto', 'Resto', { id: '74.3_IIR_0_M_23' }],
];
for (const [key, title, fallback] of TRADE) {
  add(key, {
    title, short: title, unit: 'Millones de US$', freq: 'M',
    // Built from the INDEC country-level tables by build-data.mjs (indecTrade).
    indec: { endpoint: key.startsWith('expo') ? 'comercio_exterior_exportacion_bienes' : 'comercio_exterior_importacion_bienes', trade: true },
    fallback,
  });
}

export const GROUPS = { IPC_DIVISIONS, IPC_REGIONS, EMAE_SECTORS };
