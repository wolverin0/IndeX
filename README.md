# IndeX

A public dashboard of Argentina's official statistics (INDEC), written for
everyday readers rather than economists. Spanish UI.

**Sections:** Resumen · Precios (IPC by category, division and region,
wholesale prices) · Canastas básicas · Trabajo (EPH) · Pobreza · Actividad
(EMAE by sector, industrial production) · Comercio exterior · Población ·
Fuentes.

**Tools for the public:**
- *Actualizá un monto por inflación*: brings any peso amount from one month to another with the national CPI.
- *¿Cuánto necesita tu hogar?*: builds a household (age and sex of each member), converts it to INDEC's adult-equivalent units and returns that household's poverty and indigence lines. An optional income field places the household against both lines and never leaves the browser.

## How the data works

`scripts/build-data.mjs` writes a single file, `data/snapshot.json`, that every
chart reads, so the numbers agree across the page. Each series in
`scripts/catalog.mjs` names two sources:

1. **api.indec.gob.ar**, the official API. It needs a personal JWT
   ([register here](https://api.indec.gob.ar/docs)) passed as `INDEC_TOKEN`.
2. **apis.datos.gob.ar**, the national open-data portal's public copy of the
   same INDEC series. No token needed. It is used for any series the INDEC API
   can't provide in that run.

Some indicators exist **only** in the INDEC API: population projections
(Censo 2022), indigence rates, informal employment, the child-rearing basket
(canasta de crianza), mining production, construction costs and trade by
country. The dashboard shows a clear placeholder for each until a token is
configured.

```sh
node scripts/build-data.mjs                     # public source only
INDEC_TOKEN=... node scripts/build-data.mjs     # official API first
INDEC_TOKEN=... node scripts/build-data.mjs --probe   # dump distinct values of every INDEC table
```

The INDEC adapter matches rows by their labels (region, description,
indicator type). It was checked against the live API in November 2026: all
series match and agree with the datos.gob.ar copies. If INDEC renames a
category, that series falls back to datos.gob.ar and the build log lists it;
`--probe` shows the current labels.

The token is only read by the build (locally or in GitHub Actions). The
published site never calls the INDEC API and never sees the token: visitors
download the prebuilt `data/snapshot.json`. Tokens expire (the API issues them
for about six months), so renew it in your INDEC profile and update the secret.

Requires Node 18+. No dependencies, no build step for the site.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy

`.github/workflows/update-and-deploy.yml` rebuilds the snapshot every day
after INDEC's 16:00 (ART) release, commits it, and publishes the site to
GitHub Pages. To enable it:

1. Settings → Pages → Source: **GitHub Actions**.
2. Optional: Settings → Secrets → Actions → `INDEC_TOKEN`.

## Design notes

- Charts are hand-built SVG/HTML (`assets/charts.js`): 2px lines, ≤24px bars
  with rounded data ends, hairline grids, one tooltip per chart with keyboard
  support, and a "Ver tabla" table twin on every chart.
- The categorical palette was checked for color-vision deficiency on both the
  light and dark surfaces. Status colors (good/bad) always come with an arrow
  and a sign, never color alone.
- Light and dark themes follow the system setting, with a manual toggle.
- Not an official INDEC product.
