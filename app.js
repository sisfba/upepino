/* UPPepino — Radar presupuestal de Educación (Sector Educación, Gobiernos Regionales y Gobiernos Locales).
   Lee los datos públicos de Supabase (funciones pub_cortes y pub_datos) y arma los paneles en el navegador. */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
const GENERICAS = {
  "1": "2.1 Personal y Obligaciones Sociales", "2": "2.2 Pensiones y Otras Prestaciones Sociales",
  "3": "2.3 Bienes y Servicios", "4": "2.4 Donaciones y Transferencias", "5": "2.5 Otros Gastos",
  "6": "2.6 Adquisición de Activos No Financieros", "7": "2.7 Adquisición de Activos Financieros",
  "8": "2.8 Servicio de la Deuda Pública",
};
const DEPARTAMENTOS = {
  "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa", "05": "Ayacucho", "06": "Cajamarca",
  "07": "Callao", "08": "Cusco", "09": "Huancavelica", "10": "Huánuco", "11": "Ica", "12": "Junín",
  "13": "La Libertad", "14": "Lambayeque", "15": "Lima", "16": "Loreto", "17": "Madre de Dios", "18": "Moquegua",
  "19": "Pasco", "20": "Piura", "21": "Puno", "22": "San Martín", "23": "Tacna", "24": "Tumbes", "25": "Ucayali",
};
const NIVELES = { "": "Todos los niveles de gobierno", GN: "Sector Educación (Gobierno Nacional)", GR: "Gobiernos Regionales", GL: "Gobiernos Locales" };
const NIVEL_CORTO = { "": "Todos", GN: "Sector Educación", GR: "Gob. Regionales", GL: "Gob. Locales" };
const COLORES_ANIO = ["#D9A93A", "#7A6F69", "#A30F14"];

const estado = {
  anios: [], cortes: {}, anio: null, region: leer("upepino_region") ?? null,
  nivel: ["GN", "GR", "GL"].includes(leer("upepino_nivel")) ? leer("upepino_nivel") : "",
  datos: new Map(), geo: null, graficos: [], grupo: "", pliegoSel: null, rep: { p: "", u: "" }, reportes: new Map(),
  // MINEDU (pliego 010): dependencia > oficina > centro de costo (por nombre; el número cc cambia cada año)
  org: { dep: "", ofi: "", cc: "" }, centros: new Map(), cat: [],
};

// ------------------------------------------------------------------ utilidades
function leer(k) { try { const v = localStorage.getItem(k); return v === null ? null : v; } catch (_) { return null; } }
function guardar(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* sin almacenamiento */ } }
const soles = (x) => "S/ " + Math.round(x || 0).toLocaleString("en-US");
const mill = (x) => "S/ " + ((x || 0) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " M";
const pct = (x) => (x == null || !isFinite(x) ? "—" : (x * 100).toFixed(1) + "%");
const div = (a, b) => (b ? a / b : null);
const sem = (x) => (x == null ? "" : x >= 0.8 ? "v" : x >= 0.7 ? "a" : "r");
const colorSem = (x) => (x == null ? "#CFC6BE" : x >= 0.8 ? "#1F8A3B" : x >= 0.7 ? "#D99A0B" : "#C62828");
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fecha = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const nombreRegion = (r = estado.region) => (r ? DEPARTAMENTOS[r] || r : "Todo el Perú");
const nombreGen = (g) => GENERICAS[g] || "2." + g;

async function rpc(fn, args = {}) {
  const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`No se pudo leer la información (${r.status}).`);
  return r.json();
}

// Gobiernos Locales: todas las municipalidades vienen en el pliego "000"; se agrupan por departamento
// ("Municipalidades de Cusco") para que el panel de pliegos tenga sentido.
function prepararFila(f) {
  if (f.n === "GL") { f.p = "GL" + f.d; f.pn = "Municipalidades de " + (DEPARTAMENTOS[f.d] || "otros lugares"); }
  return f;
}
async function datos(anio, nivel = estado.nivel) {
  const clave = anio + "|" + nivel;
  if (!estado.datos.has(clave)) {
    const p = rpc("pub_datos", { p_anio: anio, p_nivel: nivel || null }).then((fs) => fs.map(prepararFila));
    p.catch(() => estado.datos.delete(clave));
    estado.datos.set(clave, p);
  }
  return estado.datos.get(clave);
}
// fecha de corte del año para el nivel elegido (en "Todos", la de cada nivel si no coinciden)
function cortesDe(anio = estado.anio, nivel = estado.nivel) {
  return (nivel ? [nivel] : ["GN", "GR", "GL"]).map((n) => estado.cortes[anio + "|" + n]).filter(Boolean);
}
function textoCorte(anio = estado.anio, nivel = estado.nivel) {
  const cs = cortesDe(anio, nivel);
  if (!cs.length) return "sin datos";
  if (new Set(cs.map((c) => c.corte)).size === 1) return fecha(cs[0].corte);
  return cs.map((c) => `${NIVEL_CORTO[c.nivel]} ${fecha(c.corte)}`).join(" · ");
}
const ultimoCorte = (anio = estado.anio) => cortesDe(anio).map((c) => c.corte).sort().pop();
const enRegion = (filas, region = estado.region) => (region ? filas.filter((f) => f.d === region) : filas);

// ------------------------------------------------------------------ MINEDU: dependencia, oficina y centro de costo
const SIN_ASIGNAR = "Sin asignar";
async function centros(anio = estado.anio) {
  if (!estado.centros.has(anio)) {
    const p = rpc("pub_centros", { p_anio: anio }).catch(() => []);   // si la nube aún no lo tiene, sin filtros
    estado.centros.set(anio, p);
  }
  return estado.centros.get(anio);
}
const hayOrg = () => estado.cat.length > 1 && (estado.nivel === "" || estado.nivel === "GN");
const orgActivo = () => hayOrg() && !!(estado.org.dep || estado.org.ofi || estado.org.cc);
// números (cc) de los centros de costo elegidos en el catálogo de ese año; null = sin filtro
function ccElegidos(cat = estado.cat) {
  if (!orgActivo()) return null;
  const { dep, ofi, cc } = estado.org;
  return cat.filter((x) => (cc ? x.cc === cc : ofi ? x.of === ofi : x.dep === dep)).map((x) => x.c);
}
async function enOrg(filas, anio = estado.anio) {
  if (!orgActivo()) return filas;
  const ids = new Set(ccElegidos(await centros(anio)));
  return filas.filter((f) => ids.has(f.c));
}
async function prepararOrg() {
  estado.cat = await centros(estado.anio);
  const { dep, ofi, cc } = estado.org;
  if (dep && !estado.cat.some((x) => x.dep === dep)) estado.org = { dep: "", ofi: "", cc: "" };
  else if (ofi && !estado.cat.some((x) => x.of === ofi)) estado.org = { dep, ofi: "", cc: "" };
  else if (cc && !estado.cat.some((x) => x.cc === cc)) estado.org = { dep, ofi, cc: "" };
}
const nombreOrg = () => (orgActivo() ? estado.org.cc || estado.org.ofi || estado.org.dep : "");
const ordenEs = (a, b) => a.localeCompare(b, "es");
function filtrosOrg() {
  if (!hayOrg()) return "";
  const { dep, ofi, cc } = estado.org;
  const deps = [...new Set(estado.cat.map((x) => x.dep))].sort((a, b) => (a === SIN_ASIGNAR) - (b === SIN_ASIGNAR) || ordenEs(a, b));
  const ofs = dep && dep !== SIN_ASIGNAR ? [...new Set(estado.cat.filter((x) => x.dep === dep).map((x) => x.of))].sort(ordenEs) : [];
  const ccs = ofi ? estado.cat.filter((x) => x.of === ofi) : [];
  const op = (v, t, sel) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(t)}</option>`;
  return `<div class="filtros filtros-org" title="Solo pliego 010 MINEDU, según la tabla de centros de costo">
    <span class="org-et">🏢 MINEDU</span>
    <select id="f-dep" class="sel" aria-label="Dependencia">${op("", "Todas las dependencias", dep)}${deps.map((d) => op(d, d, dep)).join("")}</select>
    ${ofs.length ? `<select id="f-ofi" class="sel" aria-label="Oficina">${op("", "Todas las oficinas", ofi)}${ofs.map((o) => op(o, o, ofi)).join("")}</select>` : ""}
    ${ccs.length > 1 ? `<select id="f-cc" class="sel" aria-label="Centro de costo">${op("", "Todos los centros de costo", cc)}${
      ccs.map((x) => op(x.cc, x.ab && x.ab.toUpperCase() !== x.cc.toUpperCase() ? `${x.ab} · ${x.cc}` : x.cc, cc)).join("")}</select>` : ""}
  </div>`;
}
function aplicarOrg(org) {
  estado.org = { dep: "", ofi: "", cc: "", ...org };
  estado.rep = { p: "", u: "" }; estado.pliegoSel = null;
  enrutar(false);
}
// avance por dependencia / oficina / centro de costo de las filas del pliego 010
function cajaOrg(filas, id) {
  if (!hayOrg()) return "";
  return `<div class="caja" id="${id}"><div class="caja-cab"><h2>🏢 MINEDU: avance por dependencia, oficina y centro de costo</h2>
    ${segmentado(id + "-s", [["dep", "Dependencia"], ["of", "Oficina"], ["cc", "Centro de costo"]],
      estado.org.cc ? "cc" : estado.org.ofi ? "cc" : estado.org.dep ? "of" : "dep")}</div><div id="${id}-t"></div>
    <p class="nota">Pliego 010, según la tabla de centros de costo del MINEDU. Las metas que no figuran en ella van como «Sin asignar». Toque una fila para filtrar.</p></div>`;
}
function conectarCajaOrg(filas, id) {
  if (!$("#" + id)) return;
  const porC = new Map(estado.cat.map((x) => [x.c, x]));
  const delPliego = filas.filter((f) => f.c && porC.has(f.c));
  const pinta = (nivel) => {
    const clave = { dep: "dep", of: "of", cc: "cc" }[nivel];
    const grupos = agrupar(delPliego.map((f) => ({ ...f, _k: porC.get(f.c)[clave], _x: porC.get(f.c) })), "_k")
      .filter((g) => Math.abs(g.pim) > 0.5).sort((a, b) => b.pim - a.pim)
      .map((g) => ({ ...g, dep: g.filas[0]._x.dep, of: g.filas[0]._x.of, ab: g.filas[0]._x.ab }));
    const cols = [{ t: { dep: "Dependencia", of: "Oficina", cc: "Centro de costo" }[nivel], k: "k",
      f: (f) => esc(nivel === "cc" && f.ab && f.ab.toUpperCase() !== String(f.k).toUpperCase() ? `${f.ab} · ${f.k}` : f.k) +
        (nivel !== "dep" && f.dep ? `<br><small style="color:#6B6460">${esc(nivel === "cc" ? f.of + " · " + f.dep : f.dep)}</small>` : "") }];
    const t = tabla([...cols,
      { t: "PIM", k: "pim", num: true, f: (f) => mill(f.pim) },
      { t: "Devengado", k: "dev", num: true, f: (f) => mill(f.dev) },
      colAvance,
      { t: "Pendiente", k: "pend", num: true, f: (f) => mill(f.pim - f.dev), orden: (f) => f.pim - f.dev },
    ], grupos, { id: id + "-tabla", total: grupos.length > 1 ? { k: "TOTAL", ...sumar(delPliego) } : null,
      alClic: (f) => aplicarOrg(nivel === "dep" ? { dep: f.k } : nivel === "of" ? { dep: f.dep, ofi: f.k } : { dep: f.dep, ofi: f.of, cc: f.k }) });
    $(`#${id}-t`).innerHTML = grupos.length ? t.html : `<p class="vacio">Sin información del pliego 010 en este ámbito.</p>`;
    t.conectar($(`#${id}-t`));
  };
  pinta($(`#${id}-s .activo`)?.dataset.v || "dep");
  alSegmento(id + "-s", pinta);
}

function sumar(filas) {
  const t = { pia: 0, pim: 0, cer: 0, com: 0, dev: 0, gir: 0, m: Array(12).fill(0) };
  for (const f of filas) {
    t.pia += f.pia; t.pim += f.pim; t.cer += f.cer; t.com += f.com; t.dev += f.dev; t.gir += f.gir;
    (f.m || []).forEach((v, i) => { t.m[i] += v || 0; });
  }
  return t;
}
function agrupar(filas, clave, nombre) {
  const g = new Map();
  for (const f of filas) {
    const k = f[clave];
    if (!g.has(k)) g.set(k, { k, n: nombre ? nombre(f) : k, filas: [] });
    g.get(k).filas.push(f);
  }
  return [...g.values()].map((x) => ({ ...x, ...sumar(x.filas) }));
}

function limpiarGraficos() { estado.graficos.forEach((g) => g.destroy()); estado.graficos = []; }
function cargando() {
  $("#vista").innerHTML = `<div class="cargando"><img src="upepino.svg" alt=""><p>UPPepino está trayendo los datos…</p></div>`;
}

// ------------------------------------------------------------------ región (departamento)
function aplicarRegion(r, avisar = true) {
  estado.region = r || null;
  guardar("upepino_region", estado.region || "");
  $("#chip-region span").textContent = nombreRegion();
  $("#chat-region").textContent = estado.region ? "📍 " + nombreRegion() : "Pregúntame por tu región";
  if (avisar) mostrarAviso("¡Listo, soy UPPepino!", estado.region ? `Ahora estás viendo ${nombreRegion()}` : "Ahora estás viendo todo el Perú");
  enrutar();
}

// nivel de gobierno: "" todos, GN Sector Educación, GR Gobiernos Regionales, GL Gobiernos Locales
function aplicarNivel(n, avisar = true) {
  estado.nivel = n || "";
  guardar("upepino_nivel", estado.nivel);
  estado.grupo = ""; estado.pliegoSel = null;
  $("#chip-nivel").value = estado.nivel;
  if (avisar) mostrarAviso("¡Listo, soy UPPepino!", `Ahora estás viendo: ${NIVELES[estado.nivel]}`);
  enrutar(false);
}
$("#chip-nivel").addEventListener("change", (e) => aplicarNivel(e.target.value));
const opcionesNivel = () => Object.entries(NIVELES).map(([k, v]) => `<option value="${k}" ${k === estado.nivel ? "selected" : ""}>${v}</option>`).join("");

function opcionesRegion(sel, valor) {
  sel.innerHTML = `<option value="">Todos los departamentos (nacional)</option>` +
    Object.entries(DEPARTAMENTOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  sel.value = valor || "";
}

function abrirBienvenida() {
  opcionesRegion($("#dlg-sel"), estado.region);
  $("#dlg-region").showModal();
}
$("#chip-region").addEventListener("click", abrirBienvenida);
$("#dlg-aplicar").addEventListener("click", () => { $("#dlg-region").close(); aplicarRegion($("#dlg-sel").value); });
$("#dlg-todo").addEventListener("click", () => { $("#dlg-region").close(); aplicarRegion(""); });
$("#dlg-cerrar").addEventListener("click", () => { $("#dlg-region").close(); if (estado.region === null) aplicarRegion("", false); });

let tAviso;
function mostrarAviso(titulo, txt) {
  $("#aviso-txt").innerHTML = `<b>${esc(titulo)}</b>${esc(txt)}`;
  $("#aviso").hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(() => { $("#aviso").hidden = true; }, 3800);
}
let tGuia;
function guia(html) {
  $("#guia-txt").innerHTML = html;
  $("#guia").hidden = false;
  clearTimeout(tGuia); tGuia = setTimeout(() => { $("#guia").hidden = true; }, 7000);
}

// ------------------------------------------------------------------ navegación
$("#btn-hamb").addEventListener("click", () => $("#menu-links").classList.toggle("abierto"));
window.addEventListener("hashchange", enrutar);

async function enrutar(arriba = true) {
  const ruta = (location.hash.replace(/^#\/?/, "") || "inicio").split("/")[0];
  $$("#menu-links a").forEach((a) => a.classList.toggle("activo", a.dataset.r === ruta));
  $("#menu-links").classList.remove("abierto");
  limpiarGraficos();
  const vistas = { inicio: vInicio, resumen: vResumen, pliegos: vPliegos, alertas: vAlertas, reporte: vReporte };
  try {
    await (vistas[ruta] || vInicio)();
  } catch (e) {
    $("#vista").innerHTML = `<div class="cont"><p class="vacio">😕 ${esc(e.message)}<br>Intenta recargar la página.</p></div>`;
  }
  if (arriba !== false) window.scrollTo({ top: 0 });
}

function cabecera(titulo, icono, migas) {
  return `<div class="migas"><a href="#/">Inicio</a> › ${esc(migas)}</div>
    <div class="tit-panel"><div class="ico">${icono}</div><h1>${esc(titulo)}</h1>
    <span class="corte">🗓️ Corte: ${textoCorte()}</span></div>
    <div class="filtros">
      <select id="f-nivel" class="sel sel-nivel" aria-label="Nivel de gobierno">${opcionesNivel()}</select>
      <select id="f-anio" class="sel" aria-label="Año">${estado.anios.map((a) => `<option ${a === estado.anio ? "selected" : ""}>${a}</option>`).join("")}</select>
      <select id="f-region" class="sel" aria-label="Departamento"></select>
    </div>${filtrosOrg()}`;
}
function conectarFiltros() {
  opcionesRegion($("#f-region"), estado.region);
  $("#f-region").addEventListener("change", (e) => aplicarRegion(e.target.value));
  $("#f-anio").addEventListener("change", (e) => { estado.anio = +e.target.value; enrutar(false); });
  $("#f-nivel").addEventListener("change", (e) => aplicarNivel(e.target.value));
  $("#f-dep")?.addEventListener("change", (e) => aplicarOrg({ dep: e.target.value }));
  $("#f-ofi")?.addEventListener("change", (e) => aplicarOrg({ dep: estado.org.dep, ofi: e.target.value }));
  $("#f-cc")?.addEventListener("change", (e) => aplicarOrg({ dep: estado.org.dep, ofi: estado.org.ofi, cc: e.target.value }));
}
// texto corto para títulos: "Gobiernos Regionales", "Sector Educación"…
const quienNivel = () => (nombreOrg() ? "MINEDU · " + nombreOrg()
  : estado.nivel ? NIVEL_CORTO[estado.nivel].replace("Gob.", "Gobiernos") : "Educación (todos los niveles)");

function kpis(t) {
  const av = div(t.dev, t.pim);
  const k = (tit, v, s = "") => `<div class="kpi"><div class="t">${tit}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="kpis">
    ${k("PIA", soles(t.pia), "Presupuesto institucional de apertura")}
    ${k("PIM", soles(t.pim), "Presupuesto institucional modificado")}
    ${k("Certificado", soles(t.cer), pct(div(t.cer, t.pim)) + " del PIM")}
    ${k("Compromiso anual", soles(t.com), pct(div(t.com, t.pim)) + " del PIM")}
    ${k("Devengado", soles(t.dev), "Pendiente: " + soles(t.pim - t.dev))}
    ${k("Girado", soles(t.gir), pct(div(t.gir, t.dev)) + " del devengado")}
    <div class="kpi oscuro"><div class="t">% Avance (Dev. / PIM)</div><div class="v" style="font-size:2rem">${pct(av)}</div>
      <div class="barra-av"><i style="width:${Math.min(av || 0, 1) * 100}%;background:${colorSem(av)}"></i></div></div>
  </div>`;
}

const SEMAFORO_TXT = `<div class="leyenda"><span><i style="background:#1F8A3B"></i>≥ 80 %</span><span><i style="background:#D99A0B"></i>70 % – 79 %</span><span><i style="background:#C62828"></i>&lt; 70 %</span></div>`;

function tabla(columnas, filas, { total, alClic, id } = {}) {
  const th = columnas.map((c, i) => `<th class="${c.num ? "n" : ""}" data-i="${i}">${c.t} ⇅</th>`).join("");
  const celda = (c, f) => `<td class="${c.num ? "n" : ""}">${c.f ? c.f(f) : esc(f[c.k])}</td>`;
  const html = `<div class="tabla-wrap"><table class="t" id="${id || ""}"><thead><tr>${th}</tr></thead><tbody>
    ${filas.map((f, i) => `<tr class="${alClic ? "clic" : ""}" data-i="${i}">${columnas.map((c) => celda(c, f)).join("")}</tr>`).join("")}
    </tbody>${total ? `<tfoot><tr>${columnas.map((c) => celda(c, total)).join("")}</tr></tfoot>` : ""}</table></div>`;
  return {
    html, conectar(raiz) {
      const tb = raiz.querySelector(`table#${id}`);
      if (!tb) return;
      if (alClic) tb.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => alClic(filas[+tr.dataset.i])));
      tb.querySelectorAll("th").forEach((thEl) => thEl.addEventListener("click", () => {
        const c = columnas[+thEl.dataset.i]; const asc = thEl.dataset.asc !== "1"; thEl.dataset.asc = asc ? "1" : "0";
        const val = c.orden || ((f) => f[c.k]);
        const filasTr = [...tb.tBodies[0].rows].sort((a, b) => {
          const x = val(filas[+a.dataset.i]); const y = val(filas[+b.dataset.i]);
          return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1);
        });
        filasTr.forEach((tr) => tb.tBodies[0].appendChild(tr));
      }));
    },
  };
}
const colAvance = { t: "% Avance", num: true, f: (f) => `<span class="sem ${sem(div(f.dev, f.pim))}">${pct(div(f.dev, f.pim))}</span>`, orden: (f) => div(f.dev, f.pim) ?? -1 };

function barras(grupos, campo) {
  const val = (g) => (campo === "av" ? div(g.dev, g.pim) || 0 : g[campo]);
  const max = Math.max(...grupos.map(val), 1e-9);
  return `<div class="barras">${grupos.map((g) => `<div class="fila"><div class="cab"><span>${esc(g.n)}</span>
      <b>${campo === "av" ? pct(val(g)) : soles(val(g))}</b></div>
      <div class="pista"><i style="width:${(val(g) / max) * 100}%;${campo === "av" ? `background:${colorSem(val(g))}` : ""}"></i></div>
      <div class="det">PIM ${mill(g.pim)} · Devengado ${mill(g.dev)} · Avance ${pct(div(g.dev, g.pim))}</div></div>`).join("")}</div>`;
}

function segmentado(id, opciones, activo) {
  return `<div class="segm" id="${id}">${opciones.map(([v, t]) => `<button type="button" data-v="${v}" class="${v === activo ? "activo" : ""}">${t}</button>`).join("")}</div>`;
}
function alSegmento(id, fn) {
  $$(`#${id} button`).forEach((b) => b.addEventListener("click", () => {
    $$(`#${id} button`).forEach((x) => x.classList.toggle("activo", x === b)); fn(b.dataset.v);
  }));
}

// ------------------------------------------------------------------ mapa
async function geo() {
  if (!estado.geo) estado.geo = await fetch("peru_departamentos.geojson").then((r) => r.json());
  return estado.geo;
}
async function dibujarMapa(cont, porDep, medida) {
  const g = await geo();
  const w = 520, h = 640;
  const proy = d3.geoMercator().fitSize([w, h], g);
  const ruta = d3.geoPath(proy);
  const valor = (k) => {
    const x = porDep.get(k); if (!x) return null;
    return medida === "av" ? div(x.dev, x.pim) : medida === "dev" ? x.dev : x.pim;
  };
  const vals = [...porDep.keys()].map(valor).filter((v) => v != null).sort((a, b) => a - b);
  const q = (p) => vals[Math.floor((vals.length - 1) * p)] ?? 0;
  const cortes = [q(0.25), q(0.5), q(0.75)];
  const tonos = ["#F2B8AE", "#D9705F", "#B3261E", "#6E0A0A"];
  const color = (v) => (v == null ? "#E7DFD6" : medida === "av" ? colorSem(v) : tonos[cortes.filter((c) => v > c).length]);
  const svg = d3.select(cont).html("").append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("role", "img")
    .attr("aria-label", "Mapa del Perú por departamento");
  const tip = $("#tip");
  svg.selectAll("path").data(g.features).join("path")
    .attr("d", ruta).attr("fill", (f) => color(valor(f.properties.id)))
    .classed("sel", (f) => f.properties.id === estado.region)
    .on("mousemove", (ev, f) => {
      const x = porDep.get(f.properties.id);
      tip.innerHTML = `<b>${DEPARTAMENTOS[f.properties.id]}</b><br>` + (x
        ? `PIM: ${mill(x.pim)}<br>Devengado: ${mill(x.dev)}<br>Avance: ${pct(div(x.dev, x.pim))}` : "Sin datos");
      tip.hidden = false; tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px";
    })
    .on("mouseleave", () => { tip.hidden = true; })
    .on("click", (ev, f) => { tip.hidden = true; aplicarRegion(f.properties.id === estado.region ? "" : f.properties.id); });
  const ley = medida === "av" ? SEMAFORO_TXT : `<div class="leyenda">
    <span><i style="background:${tonos[0]}"></i>Menor ${medida === "dev" ? "devengado" : "PIM"}</span>
    <span><i style="background:${tonos[1]}"></i>Medio</span><span><i style="background:${tonos[2]}"></i>Alto</span>
    <span><i style="background:${tonos[3]}"></i>Mayor ${medida === "dev" ? "devengado" : "PIM"}</span><span><i style="background:#E7DFD6"></i>Sin dato</span></div>`;
  cont.insertAdjacentHTML("beforeend", ley + `<p class="nota">Toque un departamento para filtrar todo el sitio. Ubicación según la meta presupuestal.</p>`);
}

// ------------------------------------------------------------------ vistas
async function vInicio() {
  const filas = enRegion(await datos(estado.anio));
  const t = sumar(filas);
  const nUe = (n) => new Set(filas.filter((f) => !n || f.n === n).map((f) => f.u)).size;
  const cont = (v, t) => `<div><b>${v.toLocaleString("en-US")}</b><span>${t}</span></div>`;
  const contadores = estado.nivel === "GL" ? cont(nUe(), "Municipalidades")
    : estado.nivel === "GR" ? cont(new Set(filas.map((f) => f.p)).size, "Gobiernos regionales") + cont(nUe(), "Unidades ejecutoras")
    : estado.nivel === "GN" ? cont(new Set(filas.map((f) => f.p)).size, "Pliegos") + cont(nUe(), "Unidades ejecutoras")
    : cont(nUe("GN") + nUe("GR"), "Unidades ejecutoras") + cont(nUe("GL"), "Municipalidades");
  $("#vista").innerHTML = `
  <section class="heroe"><div class="heroe-grid">
    <div>
      <div class="eyebrow">Educación · Radar presupuestal</div>
      <h1>Conoce <em>cómo avanza el presupuesto educativo de tu región</em></h1>
      <div class="sello-corte">📅 Información del SIAF con corte al <b>${textoCorte()}</b> · se actualiza cada día hábil</div>
      <p class="lead">Un vistazo claro al avance financiero de la educación pública: cuánto se asignó, cuánto se comprometió y
        cuánto se ejecutó en el Sector Educación, los Gobiernos Regionales y los Gobiernos Locales, por departamento,
        pliego y unidad ejecutora.</p>
      <div class="niveles"><span>Nivel de gobierno</span>${segmentado("s-nivel", Object.entries(NIVEL_CORTO), estado.nivel)}</div>
      <button type="button" class="btn-correo" id="h-correo">📧 Recibir la data del Sector en mi correo</button>
      <div class="lema"><img src="upepino-cara.svg" alt="">UPPepino</div>
      <div class="contadores">
        <div><b>${nombreRegion() === "Todo el Perú" ? 25 : 1}</b><span>Departamento${estado.region ? "" : "s"}</span></div>
        ${contadores}
        <div><b>${pct(div(t.dev, t.pim))}</b><span>Avance ${estado.anio}</span></div>
      </div>
    </div>
    <div class="mascota">
      <div class="globo"><b>¡Hola, soy UPPepino! 🥒</b><br>Te acompaño a descubrir cómo avanza el presupuesto de educación en
        ${estado.region ? "<b>" + esc(nombreRegion()) + "</b>" : "tu región"}, con la última información disponible.</div>
      <img src="upepino.svg" alt="UPPepino, el pepino del presupuesto">
    </div>
  </div></section>
  <div class="cont"><div class="tarjetas-panel">
    ${tarjeta("#/resumen", "📊", "Resumen general", "Ejecución consolidada: PIA, PIM, certificado, devengado y girado; mapa por departamento, ranking y evolución mensual.")}
    ${tarjeta("#/pliegos", "🏛️", "Pliegos y UE", "Avance por pliego (MINEDU, universidades, gobiernos regionales y municipalidades) y por cada una de sus unidades ejecutoras.")}
    ${tarjeta("#/alertas", "🔔", "Alertas de seguimiento", "Unidades ejecutoras y genéricas con bajo avance según el semáforo: ≥ 80 % verde, 70–79 % ámbar, < 70 % rojo.")}
    ${tarjeta("#/reporte", "🧾", "Reporte de seguimiento", "Ejecución por genérica, pendiente de comprometer y certificar por genérica y por CP/PP, y conceptos con baja ejecución. Descargable en PDF.")}
  </div></div>`;
  alSegmento("s-nivel", (v) => aplicarNivel(v));
  $("#h-correo").addEventListener("click", abrirCorreo);
}
const tarjeta = (href, ico, t, d) => `<a class="tp" href="${href}"><div class="ico">${ico}</div><h3>${t}</h3><p>${d}</p><span class="ir">Ver panel →</span></a>`;

async function vResumen() {
  cargando();
  await prepararOrg();
  const todas = await enOrg(await datos(estado.anio));
  const filas = enRegion(todas);
  const t = sumar(filas);
  $("#vista").innerHTML = `<div class="cont">
    ${cabecera(`Resumen general — ${quienNivel()}${estado.region ? " en " + nombreRegion() : ", a nivel nacional"}`, "📊", "Resumen general")}
    ${filas.length ? kpis(t) : `<p class="vacio">No hay presupuesto registrado para ${esc(nombreRegion())} en ${estado.anio}.</p>`}
    <div class="dos">
      <div class="caja"><div class="caja-cab"><h2>🗺️ ${"Por departamento"}</h2>
        <select class="sel" id="m-medida"><option value="pim">PIM</option><option value="dev">Devengado</option><option value="av">% Avance</option></select></div>
        <div class="mapa" id="mapa"></div></div>
      <div class="caja"><div class="caja-cab"><h2>🏆 Ranking por departamento</h2></div><div id="ranking"></div></div>
    </div>
    <div class="dos">
      <div class="caja"><div class="caja-cab"><h2>🧾 Ejecución por genérica de gasto</h2>
        ${segmentado("s-gen", [["pim", "PIM"], ["dev", "Devengado"], ["av", "% Avance"]], "pim")}</div><div id="genericas"></div></div>
      <div class="caja"><div class="caja-cab"><h2>📈 Avance acumulado del devengado</h2></div>
        <div class="grafico"><canvas id="g-curva"></canvas></div>
        <p class="nota">Devengado acumulado entre el PIM de cada año. El año en curso llega hasta el mes de corte.</p></div>
    </div>${cajaOrg(filas, "c-org")}</div>`;
  conectarFiltros();
  conectarCajaOrg(filas, "c-org");
  const porDep = new Map(agrupar(todas, "d").map((x) => [x.k, x]));
  await dibujarMapa($("#mapa"), porDep, "pim");
  $("#m-medida").addEventListener("change", (e) => dibujarMapa($("#mapa"), porDep, e.target.value));

  const deps = [...porDep.values()].filter((x) => DEPARTAMENTOS[x.k]).map((x) => ({ ...x, n: DEPARTAMENTOS[x.k] }))
    .sort((a, b) => b.pim - a.pim);
  const rk = tabla([
    { t: "Departamento", k: "n", f: (f) => (f.k === estado.region ? "📍 " : "") + esc(f.n) },
    { t: "PIM", k: "pim", num: true, f: (f) => soles(f.pim) },
    { t: "Devengado", k: "dev", num: true, f: (f) => soles(f.dev) },
    colAvance,
  ], deps, { id: "t-rank", alClic: (f) => aplicarRegion(f.k) });
  $("#ranking").innerHTML = rk.html + `<p class="nota">Toque un departamento para filtrar. Encabezados ordenables.</p>`;
  rk.conectar($("#ranking"));

  const gens = agrupar(filas, "g", (f) => nombreGen(f.g)).sort((a, b) => a.k.localeCompare(b.k)).filter((x) => x.pim > 0.5);
  $("#genericas").innerHTML = barras(gens, "pim");
  alSegmento("s-gen", (v) => { $("#genericas").innerHTML = barras(gens, v); });

  await curva($("#g-curva"));
  guia(`<b>¡Hola, soy UPPepino! 🥒</b><br>Estás en el <b>Resumen general</b>: aquí ves la ejecución consolidada
    ${estado.region ? "de <b>" + esc(nombreRegion()) + "</b>" : "a nivel nacional"} para <b>${esc(NIVELES[estado.nivel].toLowerCase())}</b>.
    Toca el mapa para cambiar de departamento.`);
}

async function curva(canvas) {
  const anios = estado.anios.filter((a) => a <= estado.anio).slice(0, 3).reverse();
  const series = await Promise.all(anios.map(async (a) => ({ a, t: sumar(enRegion(await enOrg(await datos(a), a))) })));
  const corte = ultimoCorte();
  const mesCorte = corte ? +corte.slice(5, 7) : 12;
  estado.graficos.push(new Chart(canvas, {
    type: "line",
    data: {
      labels: MESES,
      datasets: series.map((s, i) => {
        let ac = 0; const tope = s.a === estado.anio ? mesCorte : 12;
        const col = COLORES_ANIO[COLORES_ANIO.length - series.length + i];
        return { label: String(s.a), data: s.t.m.map((v, j) => (j < tope ? (ac += v) / (s.t.pim || 1) : null)),
          borderColor: col, backgroundColor: col, borderWidth: s.a === estado.anio ? 4 : 2, pointRadius: 3, tension: .25 };
      }),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${(c.parsed.y * 100).toFixed(1)}%` } } },
      scales: { y: { min: 0, max: 1, ticks: { callback: (v) => v * 100 + "%" } } },
    },
  }));
}

async function vPliegos() {
  cargando();
  await prepararOrg();
  let filas = enRegion(await enOrg(await datos(estado.anio)));
  if (estado.nivel !== "GN") estado.grupo = "";
  const filtroGrupo = (f) => (estado.grupo === "U" ? f.p.startsWith("5") : estado.grupo === "M" ? !f.p.startsWith("5") : true);
  filas = filas.filter(filtroGrupo);
  const pls = agrupar(filas, "p", (f) => f.pn).filter((x) => x.pim > 0.5).sort((a, b) => b.pim - a.pim);
  const sel = pls.find((x) => x.k === estado.pliegoSel);
  $("#vista").innerHTML = `<div class="cont">
    ${cabecera("Pliegos y unidades ejecutoras — " + quienNivel() + (estado.region ? ` en ${nombreRegion()}` : ""), "🏛️", "Pliegos y UE")}
    ${estado.nivel === "GN" ? segmentado("s-grupo", [["", "Todos los pliegos"], ["U", "Universidades"], ["M", "MINEDU y organismos"]], estado.grupo) : ""}
    ${estado.nivel === "GL" || estado.nivel === "" ? `<p class="nota">En Gobiernos Locales, cada municipalidad es una unidad ejecutora; se agrupan por departamento como “Municipalidades de …”.</p>` : ""}
    ${kpis(sumar(filas))}
    <div class="dos">
      <div class="caja"><div class="caja-cab"><h2>🏛️ Pliegos por PIM</h2></div><div id="t-pl"></div></div>
      <div class="caja"><div class="caja-cab"><h2>📊 ${sel ? "Genéricas de " + esc(sel.n) : "Avance de los 12 pliegos con mayor PIM"}</h2></div><div id="b-pl"></div></div>
    </div>
    <div class="caja" id="caja-ue"><div class="caja-cab"><h2>🏫 ${sel ? "Unidades ejecutoras de " + esc(sel.n) : "Elija un pliego para ver sus unidades ejecutoras"}</h2></div><div id="t-ue"></div></div>
    ${sel && sel.k === "010" ? cajaOrg(sel.filas, "p-org") : ""}
  </div>`;
  conectarFiltros();
  if (sel && sel.k === "010") conectarCajaOrg(sel.filas, "p-org");
  if (estado.nivel === "GN") alSegmento("s-grupo", (v) => { estado.grupo = v; estado.pliegoSel = null; enrutar(false); });
  const total = { n: "TOTAL", ...sumar(filas) };
  const tp = tabla([
    { t: "Pliego", k: "n", f: (f) => (f.k === estado.pliegoSel ? "👉 " : "") + esc((f.k !== undefined && !String(f.k).startsWith("GL") ? f.k + " " : "") + f.n) },
    { t: "PIM", k: "pim", num: true, f: (f) => mill(f.pim) },
    { t: "Devengado", k: "dev", num: true, f: (f) => mill(f.dev) },
    colAvance,
    { t: "Pendiente", k: "pend", num: true, f: (f) => mill(f.pim - f.dev), orden: (f) => f.pim - f.dev },
  ], pls, { id: "tabla-pl", total, alClic: (f) => { estado.pliegoSel = f.k; enrutar(); } });
  $("#t-pl").innerHTML = tp.html + `<p class="nota">Toque un pliego para ver sus unidades ejecutoras y genéricas.</p>`;
  tp.conectar($("#t-pl"));
  if (sel) {
    $("#b-pl").innerHTML = barras(agrupar(sel.filas, "g", (f) => nombreGen(f.g)).filter((x) => x.pim > 0.5).sort((a, b) => a.k.localeCompare(b.k)), "pim");
    const ues = agrupar(sel.filas, "u", (f) => f.un).sort((a, b) => b.pim - a.pim);
    const tu = tabla([
      { t: sel.k.startsWith("GL") ? "Municipalidad" : "Unidad ejecutora", k: "n" },
      { t: "PIM", k: "pim", num: true, f: (f) => mill(f.pim) },
      { t: "Certificado", k: "cer", num: true, f: (f) => mill(f.cer) },
      { t: "Devengado", k: "dev", num: true, f: (f) => mill(f.dev) },
      colAvance,
      { t: "Pendiente", k: "pend", num: true, f: (f) => mill(f.pim - f.dev), orden: (f) => f.pim - f.dev },
    ], ues, { id: "tabla-ue", total: { n: "TOTAL", ...sumar(sel.filas) } });
    $("#t-ue").innerHTML = tu.html; tu.conectar($("#t-ue"));
    setTimeout(() => $("#caja-ue").scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  } else {
    $("#b-pl").innerHTML = barras(pls.slice(0, 12), "av") + SEMAFORO_TXT;
    $("#t-ue").innerHTML = `<p class="vacio">👆 Toque un pliego en la tabla.</p>`;
  }
  guia(`<b>Pliegos y UE</b><br>Compara el avance de cada pliego${estado.region ? " en <b>" + esc(nombreRegion()) + "</b>" : ""}.
    Toca uno para ver sus unidades ejecutoras.`);
}

async function vAlertas() {
  cargando();
  await prepararOrg();
  const filas = enRegion(await enOrg(await datos(estado.anio)));
  const ues = agrupar(filas, "u", (f) => f.un).filter((x) => x.pim >= 1e6)
    .map((x) => ({ ...x, pl: x.filas[0].pn, av: div(x.dev, x.pim), pend: x.pim - x.dev }));
  const rojos = ues.filter((x) => x.av < 0.7), ambar = ues.filter((x) => x.av >= 0.7 && x.av < 0.8), verdes = ues.filter((x) => x.av >= 0.8);
  const enRiesgo = rojos.reduce((a, x) => a + x.pend, 0);
  // genéricas críticas: combinación UE + genérica con PIM >= 5 M y avance < 70 %
  const crit = [];
  for (const u of ues) for (const g of agrupar(u.filas, "g")) {
    const av = div(g.dev, g.pim);
    if (g.pim >= 5e6 && av < 0.7) crit.push({ n: u.n, gen: nombreGen(g.k), pim: g.pim, dev: g.dev, av, pend: g.pim - g.dev });
  }
  crit.sort((a, b) => b.pend - a.pend);
  $("#vista").innerHTML = `<div class="cont">
    ${cabecera("Alertas de seguimiento — " + quienNivel() + (estado.region ? ` en ${nombreRegion()}` : ""), "🔔", "Alertas de seguimiento")}
    <div class="alerta-k">
      <div class="ak r"><b>${rojos.length}</b><span>Unidades ejecutoras en rojo (avance &lt; 70 %)</span></div>
      <div class="ak a"><b>${ambar.length}</b><span>En ámbar (70 % – 79 %)</span></div>
      <div class="ak v"><b>${verdes.length}</b><span>En verde (≥ 80 %)</span></div>
      <div class="ak r"><b style="font-size:1.25rem">${mill(enRiesgo)}</b><span>Por devengar en las UE en rojo</span></div>
    </div>
    <div class="caja"><div class="caja-cab"><h2>🚨 Unidades ejecutoras con menor avance</h2>
      ${segmentado("s-al", [["r", "Rojo"], ["a", "Ámbar"], ["t", "Todas"]], "r")}</div><div id="t-al"></div>
      <p class="nota">Solo unidades con PIM de S/ 1 millón o más. Ordenadas por monto pendiente de devengar.</p></div>
    <div class="caja"><div class="caja-cab"><h2>🧾 Genéricas críticas (PIM ≥ S/ 5 M y avance &lt; 70 %)</h2></div><div id="t-cr"></div></div>
    ${estado.region ? "" : `<div class="caja"><div class="caja-cab"><h2>🗺️ Departamentos con menor avance</h2></div><div id="b-dep"></div>${SEMAFORO_TXT}</div>`}
  </div>`;
  conectarFiltros();
  const pinta = (lista) => {
    const t = tabla([
      { t: "Unidad ejecutora", k: "n", f: (f) => `${esc(f.n)}<br><small style="color:#6B6460">${esc(f.pl)}</small>` },
      { t: "PIM", k: "pim", num: true, f: (f) => mill(f.pim) },
      { t: "Devengado", k: "dev", num: true, f: (f) => mill(f.dev) },
      colAvance,
      { t: "Pendiente", k: "pend", num: true, f: (f) => mill(f.pend) },
    ], lista.sort((a, b) => b.pend - a.pend), { id: "tabla-al" });
    $("#t-al").innerHTML = lista.length ? t.html : `<p class="vacio">🎉 Ninguna unidad en este grupo.</p>`; t.conectar($("#t-al"));
  };
  pinta([...rojos]);
  alSegmento("s-al", (v) => pinta(v === "r" ? [...rojos] : v === "a" ? [...ambar] : [...ues]));
  const tc = tabla([
    { t: "Unidad ejecutora", k: "n" }, { t: "Genérica", k: "gen" },
    { t: "PIM", k: "pim", num: true, f: (f) => mill(f.pim) }, colAvance,
    { t: "Pendiente", k: "pend", num: true, f: (f) => mill(f.pend) },
  ], crit.slice(0, 60), { id: "tabla-cr" });
  $("#t-cr").innerHTML = crit.length ? tc.html : `<p class="vacio">🎉 Sin genéricas críticas.</p>`; tc.conectar($("#t-cr"));
  if (!estado.region) {
    const deps = agrupar(filas, "d").filter((x) => DEPARTAMENTOS[x.k]).map((x) => ({ ...x, n: DEPARTAMENTOS[x.k] }))
      .sort((a, b) => div(a.dev, a.pim) - div(b.dev, b.pim)).slice(0, 10);
    $("#b-dep").innerHTML = barras(deps, "av");
  }
  guia(`<b>Alertas de seguimiento</b><br>${rojos.length ? `Hay <b>${rojos.length}</b> unidades en rojo con
    <b>${mill(enRiesgo)}</b> por devengar.` : "¡No hay unidades en rojo!"} Revisa las genéricas críticas más abajo.`);
}

// ------------------------------------------------------------------ reporte de seguimiento
const enteros = (x) => (x == null || !isFinite(x) || Math.abs(x) < 0.5 ? "" : Math.round(x).toLocaleString("en-US").replace(/,/g, " "));
function calcular(t) {
  return { ...t, pc: t.pim - t.cer, pcm: t.pim - t.com, pd: t.pim - t.dev, av: div(t.dev, t.pim) };
}
function cuadroRep(filas, cols, cab, etiqueta, codigo = false) {
  if (!filas.length) return `<p class="vacio">Sin información para este ámbito.</p>`;
  const tot = calcular(filas.reduce((a, f) => ({ pim: a.pim + f.pim, cer: a.cer + f.cer, com: a.com + f.com, dev: a.dev + f.dev }),
    { pim: 0, cer: 0, com: 0, dev: 0 }));
  const fila = (f, esTot) => `<tr class="${esTot ? "tot" : ""}"><td class="${esTot || codigo ? "c" : "nom"}">${esTot ? "TOTAL" : etiqueta(f)}</td>${
    cols.map(([k]) => `<td>${enteros(f[k])}</td>`).join("")}<td class="av ${sem(f.av)}">${f.av == null ? "" : Math.round(f.av * 100) + "%"}</td></tr>`;
  return `<div class="rep-wrap"><table class="rep"><thead><tr><th>${cab}</th>${cols.map(([, t]) => `<th>${t}</th>`).join("")}
    <th>% Ejecución<br>(Dev/PIM)</th></tr></thead><tbody>${filas.map((f) => fila(f)).join("")}${fila(tot, true)}</tbody></table></div>
    <div class="rep-fuente">FUENTE: SIAF al ${textoCorte()}</div>`;
}
const C_EJEC = [["pim", "PIM"], ["cer", "Certificado"], ["pc", "Pendiente de certificar"], ["com", "Compromiso anual"], ["dev", "Devengado"]];
const C_PEND = [["pim", "PIM"], ["cer", "Certificado"], ["pc", "Pendiente de certificar"], ["com", "Compromiso anual"],
  ["pcm", "Pendiente de compromiso anual"], ["dev", "Devengado"]];
const C_CONC = [["pim", "PIM"], ["cer", "Certificado"], ["pc", "Pendiente de certificar"], ["dev", "Devengado"], ["pd", "Pendiente de devengar"]];
const NOMBRE_GEN_REP = (g) => g + ". " + (GENERICAS[g] || "").replace(/^2\.\d /, "").toUpperCase();

// parámetros de pub_reporte para el ámbito elegido (las municipalidades se agrupan como "GL" + departamento)
function paramsReporte(nivel, region, p, u) {
  const q = { p_anio: estado.anio, p_nivel: nivel || null, p_dep: region || null, p_pliego: p || null, p_ue: u || null };
  if (p && p.startsWith("GL")) { q.p_nivel = "GL"; q.p_dep = p.slice(2); q.p_pliego = null; }
  return q;
}
async function datosReporte(q) {
  const k = JSON.stringify(q);
  if (!estado.reportes.has(k)) {
    const pr = rpc("pub_reporte", q); pr.catch(() => estado.reportes.delete(k)); estado.reportes.set(k, pr);
  }
  return estado.reportes.get(k);
}

async function vReporte() {
  cargando();
  await prepararOrg();
  const todas = enRegion(await enOrg(await datos(estado.anio)));
  // listas de pliegos y UE del ámbito
  const pls = agrupar(todas, "p", (f) => f.pn).filter((x) => x.pim > 0.5).sort((a, b) => a.n.localeCompare(b.n));
  if (estado.rep.p && !pls.some((x) => x.k === estado.rep.p)) estado.rep = { p: "", u: "" };
  const enPl = estado.rep.p ? todas.filter((f) => f.p === estado.rep.p) : todas;
  const ues = agrupar(enPl, "u", (f) => f.un).filter((x) => x.pim > 0.5).sort((a, b) => a.n.localeCompare(b.n));
  if (estado.rep.u && !ues.some((x) => x.k === estado.rep.u)) estado.rep.u = "";
  const filas = estado.rep.u ? enPl.filter((f) => f.u === estado.rep.u) : enPl;
  const sel = estado.rep.u ? ues.find((x) => x.k === estado.rep.u) : estado.rep.p ? pls.find((x) => x.k === estado.rep.p) : null;
  const titulo = (sel ? sel.n : (estado.region ? nombreRegion() : "Todo el Perú") + (nombreOrg() ? "" : " · " + quienNivel()))
    + (nombreOrg() ? " · " + nombreOrg() : "");
  const gens = agrupar(filas, "g").filter((x) => Math.abs(x.pim) > 0.5 || Math.abs(x.dev) > 0.5)
    .sort((a, b) => a.k.localeCompare(b.k)).map((x) => calcular({ ...x, n: NOMBRE_GEN_REP(x.k) }));
  $("#vista").innerHTML = `<div class="cont">
    ${cabecera("Reporte de seguimiento", "🧾", "Reporte de seguimiento")}
    <div class="filtros rep-filtros">
      <select id="r-pliego" class="sel" aria-label="Pliego"><option value="">Todos los pliegos</option>
        ${pls.map((x) => `<option value="${esc(x.k)}" ${x.k === estado.rep.p ? "selected" : ""}>${esc(x.n)}</option>`).join("")}</select>
      <select id="r-ue" class="sel" aria-label="Unidad ejecutora"><option value="">Todas las unidades ejecutoras</option>
        ${ues.map((x) => `<option value="${esc(x.k)}" ${x.k === estado.rep.u ? "selected" : ""}>${esc(x.n)}</option>`).join("")}</select>
      <button type="button" class="btn-correo" id="r-correo">📧 Recibir data del Sector</button>
      <button type="button" class="btn-prim" id="r-pdf">🖨️ Descargar PDF</button>
    </div>
    <article class="reporte" id="reporte">
      <h1 class="rep-tit">${esc(titulo.toUpperCase())}</h1>
      <div class="rep-sub">Año ${estado.anio} · ${esc(NIVELES[estado.nivel])} · información del SIAF con corte al ${textoCorte()}</div>
      <h2 class="rep-sec">1. Ejecución presupuestal</h2>
      ${cuadroRep(gens, C_EJEC, "Genérica", (f) => esc(f.n))}
      <h2 class="rep-sec">2. Presupuesto pendiente de comprometer y certificar</h2>
      ${cuadroRep(gens, C_PEND, "Genérica", (f) => esc(f.n))}
      <div id="rep-prog" class="rep-bloque"><p class="vacio">UPPepino está sumando los CP/PP…</p></div>
      <h2 class="rep-sec">3. Conceptos con baja ejecución</h2>
      <div id="rep-conc"><p class="vacio">UPPepino está buscando los conceptos con bajo avance…</p></div>
      <p class="rep-nota">Conceptos: específicas de gasto (específica detalle) de las genéricas 2.3 a 2.6 con avance del devengado
        menor al 50 % y PIM de S/ 50 mil o más, ordenadas por el monto pendiente de devengar (máximo 15).
        Semáforo del % de ejecución: <b class="sv">verde ≥ 80 %</b> · <b class="sa">ámbar 70 % – 79 %</b> · <b class="sr">rojo &lt; 70 %</b>.</p>
    </article>
  </div>`;
  conectarFiltros();
  $("#r-pliego").addEventListener("change", (e) => { estado.rep = { p: e.target.value, u: "" }; enrutar(false); });
  $("#r-ue").addEventListener("change", (e) => { estado.rep.u = e.target.value; enrutar(false); });
  $("#r-correo").addEventListener("click", abrirCorreo);
  $("#r-pdf").addEventListener("click", () => {
    const t = document.title; document.title = "Reporte de seguimiento - " + titulo + " - " + estado.anio;
    window.print(); setTimeout(() => { document.title = t; }, 500);
  });
  guia(`<b>Reporte de seguimiento</b><br>Elige un pliego o una unidad ejecutora y pulsa <b>Descargar PDF</b>
    para guardarlo o imprimirlo.`);
  try {
    const q = paramsReporte(estado.nivel, estado.region, estado.rep.p, estado.rep.u);
    if (ccElegidos()) q.p_cc = ccElegidos();
    const r = await datosReporte(q);
    if (!$("#rep-prog")) return;
    const prog = (r.prog || []).map((x) => calcular(x));
    $("#rep-prog").innerHTML = cuadroRep(prog, C_PEND, "CP/PP", (f) => `<span title="${esc(f.n)}">${esc(f.c)}</span>`, true) +
      (prog.length ? `<p class="rep-nota">${prog.map((f) => `<b>${esc(f.c)}</b> ${esc(f.n)}`).join(" · ")}</p>` : "");
    const conc = (r.conc || []).map((x) => calcular(x));
    $("#rep-conc").innerHTML = conc.length
      ? cuadroRep(conc, C_CONC, "Concepto (específica de gasto)", (f) => `${esc(f.n)} <small>(${esc(f.c)})</small>`)
      : `<p class="vacio">🎉 No hay específicas de gasto con avance menor al 50 % y PIM de S/ 50 mil o más.</p>`;
  } catch (e) {
    if (!$("#rep-prog")) return;
    $("#rep-prog").innerHTML = `<p class="vacio">Los cuadros por CP/PP y de conceptos aún no están disponibles.</p>`;
    $("#rep-conc").innerHTML = "";
  }
}

// ------------------------------------------------------------------ envío de la data del Sector por correo
function abrirCorreo() {
  $("#correo-msg").hidden = true;
  $("#correo-txt").value = leer("upp_correo") || "";
  rpcPublico("pub_archivo_info").then((a) => {
    if (a && a.nombre) $("#correo-archivo").textContent = `${a.nombre}, corte al ${fecha(a.fecha_corte)}`;
  }).catch(() => {});
  $("#dlg-correo").showModal();
  setTimeout(() => $("#correo-txt").focus(), 50);
}
const rpcPublico = (fn, args = {}) => rpc(fn, args);
async function enviarCorreo() {
  const correo = $("#correo-txt").value.trim().toLowerCase();
  const msg = $("#correo-msg");
  const mostrar = (t, ok) => { msg.textContent = t; msg.className = "correo-msg " + (ok ? "ok" : "error"); msg.hidden = false; };
  if (!/^[a-z0-9._%+-]+@minedu\.gob\.pe$/.test(correo)) return mostrar("Escribe un correo institucional que termine en @minedu.gob.pe.", false);
  const b = $("#correo-enviar"); b.disabled = true; b.textContent = "Enviando…";
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/enviar-sector`, {
      method: "POST",
      headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ correo }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.ok) { guardar("upp_correo", correo); mostrar(`¡Listo! 🥒 Te envié el enlace a ${correo}. Revisa tu bandeja (y la carpeta de spam).`, true); }
    else mostrar(d.error || "No se pudo enviar el correo. Inténtalo más tarde.", false);
  } catch (_) {
    mostrar("No se pudo conectar con el servicio de correo. Inténtalo más tarde.", false);
  } finally { b.disabled = false; b.textContent = "Enviar a mi correo"; }
}
$("#correo-enviar").addEventListener("click", enviarCorreo);
$("#correo-txt").addEventListener("keydown", (e) => { if (e.key === "Enter") enviarCorreo(); });
$("#correo-cerrar").addEventListener("click", () => $("#dlg-correo").close());

// ------------------------------------------------------------------ chat de UPPepino
const chat = { region: null, nivel: null, iniciado: false };
const nivelChat = () => (chat.nivel !== null ? chat.nivel : estado.nivel);
const etqNivelChat = () => (nivelChat() ? ` · ${NIVEL_CORTO[nivelChat()]}` : "");
const MEDIDAS = [
  ["pia", "PIA", ["pia", "apertura"]], ["pim", "PIM", ["pim", "modificado", "presupuesto"]],
  ["cer", "Certificado", ["certific"]], ["com", "Compromiso", ["compromis", "comprometid"]],
  ["dev", "Devengado", ["deveng", "gast", "ejecut"]], ["gir", "Girado", ["girad", "giro", "pagad"]],
  ["av", "% Avance", ["avance", "porcentaje", "%", "ejecucion", "como vamos", "como va"]],
  ["pend", "Pendiente", ["pendiente", "saldo", "falta", "por devengar", "por ejecutar"]],
];

// ---- aprendizaje: corrige errores de escritura, recuerda lo que la gente quiso decir y lo más consultado
const INTENCIONES = {
  "m:pim": "PIM (presupuesto)", "m:dev": "Devengado (gastado)", "m:av": "% de avance", "m:pend": "Pendiente por gastar",
  "m:cer": "Certificado", "m:com": "Compromiso", "m:gir": "Girado (pagado)", "m:pia": "PIA",
  alertas: "Alertas (bajo avance)", ranking: "Ranking de unidades", reporte: "Reporte de seguimiento", resumen: "Resumen general",
};
const VOCAB = ["pia", "pim", "apertura", "modificado", "presupuesto", "certificado", "certificacion", "compromiso", "comprometido",
  "devengado", "devengo", "devengaron", "gasto", "gastado", "gastaron", "ejecutado", "girado", "pagado", "avance", "porcentaje",
  "ejecucion", "pendiente", "saldo", "falta", "alertas", "alerta", "ranking", "reporte", "regional", "regionales", "municipal",
  "municipalidad", "municipalidades", "locales", "sector", "minedu", "universidad", "ugel", "educacion"];
const VACIAS = new Set(("a al de del la las el los lo un una unos unas y o en por para con que cual cuales cuanto cuanta cuantos cuantas " +
  "como cuando donde es son esta estan hay ha han se su sus mi me te le les nos ya muy mas menos dime dame quiero quisiera saber ver " +
  "puedes podrias favor hola gracias sobre total año anio tiene tienen lleva van va del este esta ese esa eso punto").split(" "));
const aprende = { saber: { aprendido: [], populares: [] }, cargado: 0 };
const sesionChat = (() => {
  let s = leer("upp_sesion");
  if (!s) { s = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, ""); guardar("upp_sesion", s); }
  return s;
})();
async function cargarSaber(forzar = false) {
  if (!forzar && Date.now() - aprende.cargado < 5 * 60e3) return aprende.saber;
  try { aprende.saber = await rpc("chat_conocimiento"); aprende.cargado = Date.now(); } catch (_) { /* aún no instalado */ }
  return aprende.saber;
}
const registrar = (tipo, texto, ejemplo) => { rpc("chat_registrar", { p_tipo: tipo, p_texto: texto, p_ejemplo: ejemplo || null }).catch(() => {}); };
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
let _vocabTotal = null;
function corregir(q) {
  if (!_vocabTotal) _vocabTotal = [...new Set([...VOCAB, ...Object.values(DEPARTAMENTOS).flatMap((d) => norm(d).split(" "))
    .filter((w) => w.length >= 4)])];
  return q.split(" ").map((w) => {
    if (w.length < 4 || /\d/.test(w) || VACIAS.has(w) || _vocabTotal.includes(w)) return w;
    const tope = w.length >= 7 ? 2 : 1;
    let mejor = null, dm = 9;
    for (const v of _vocabTotal) { const x = distancia(w, v); if (x < dm && v[0] === w[0]) { dm = x; mejor = v; } }
    return mejor && dm <= tope ? mejor : w;
  }).join(" ");
}
// palabras "de contenido" de la pregunta (sin vacías, departamentos, años ni palabras que el chat ya conoce)
function claveFrase(q) {
  const deps = new Set(Object.values(DEPARTAMENTOS).flatMap((d) => norm(d).split(" ")));
  const conocidas = new Set(VOCAB);
  return [...new Set(q.split(/[^a-z0-9%]+/).filter((w) => w.length >= 3 && !VACIAS.has(w) && !deps.has(w) && !conocidas.has(w) && !/^\d+$/.test(w)))]
    .sort().join(" ");
}
function aprendidoPara(clave) {
  if (!clave) return null;
  const mias = new Set(clave.split(" "));
  let mejor = null;
  for (const a of aprende.saber.aprendido || []) {
    const sus = a.f.split(" ");
    if (sus.length && sus.every((w) => mias.has(w)) && (!mejor || sus.length > mejor.f.split(" ").length)) mejor = a;
  }
  return mejor;
}
const etiquetaPopular = (c) => {
  const [i, d, n] = c.split("|");
  return [INTENCIONES[i] ? INTENCIONES[i].replace(/ \(.*\)/, "") : i, d ? DEPARTAMENTOS[d] : "Todo el Perú", n ? NIVEL_CORTO[n.toUpperCase()] : ""].filter(Boolean).join(" · ");
};
async function ejecutarIntencion(i, anio = estado.anio, entidad = null) {
  if (i.startsWith("m:")) return entidad ? entidadChat(entidad, i.slice(2), anio) : medidaChat(i.slice(2), anio);
  if (i === "alertas") return alertasChat();
  if (i === "ranking") return rankingChat();
  if (i === "resumen") return resumenRegionChat();
  if (i === "reporte") {
    burbuja(`🧾 Te llevo al <b>Reporte de seguimiento</b>${regionChat() ? " de <b>" + esc(nombreRegion(regionChat())) + "</b>" : ""}.`);
    if (regionChat() !== (estado.region || "")) { estado.region = regionChat() || null; guardar("upepino_region", estado.region || ""); }
    location.hash = "#/reporte";
  }
}
const claveConsulta = (i) => `${i}|${regionChat() || ""}|${(nivelChat() || "").toLowerCase()}`;

function burbuja(html, quien = "bot") {
  const d = document.createElement("div");
  d.className = "msg " + quien; d.innerHTML = html;
  $("#chat-msgs").appendChild(d); $("#chat-msgs").scrollTop = 1e9;
  return d;
}
function chips(lista) {
  const d = document.createElement("div"); d.className = "chips";
  lista.forEach(([txt, fn, cls]) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = txt; if (cls) b.className = cls;
    b.addEventListener("click", () => { burbuja(esc(txt), "yo"); fn(); }); d.appendChild(b);
  });
  $("#chat-msgs").appendChild(d); $("#chat-msgs").scrollTop = 1e9;
}
async function responder(fn) {
  const e = burbuja(`<span class="escribiendo"><i></i><i></i><i></i></span>`);
  await new Promise((r) => setTimeout(r, 450));
  e.remove(); await fn();
}
function menuPrincipal() {
  burbuja("Elige una opción o escríbeme tu pregunta:");
  chips([
    ["📍 Consultar por departamento", elegirDepartamento, "pri"],
    ["🏛️ Buscar pliego o unidad ejecutora", () => responder(() => burbuja("Escríbeme el nombre o parte del nombre, por ejemplo: <b>UGEL Cusco</b>, <b>San Marcos</b> o <b>Pronabec</b>."))],
    ["🔔 Alertas de mi región", () => responder(alertasChat)],
    ["📊 ¿Cómo vamos?", () => responder(() => medidaChat("av"))],
    ["🏛️ Nivel de gobierno", elegirNivelChat],
    ["🧾 Reporte de seguimiento", () => responder(() => ejecutarIntencion("reporte"))],
    ["📧 Recibir la data del Sector por correo", () => { burbuja("¡Claro! Escribe tu correo institucional en la ventana. 🥒"); abrirCorreo(); }],
  ]);
  const pop = (aprende.saber.populares || []).filter((p) => p.v >= 2).slice(0, 4);
  if (pop.length) {
    burbuja("🔥 <b>Lo más consultado</b>:");
    chips(pop.map((p) => [etiquetaPopular(p.c), () => {
      const [i, d, n] = p.c.split("|"); chat.region = d || ""; chat.nivel = n ? n.toUpperCase() : "";
      responder(() => ejecutarIntencion(i));
    }]));
  }
}
function elegirNivelChat() {
  burbuja(`¿Qué nivel de gobierno quieres consultar? Ahora estoy en <b>${esc(NIVELES[nivelChat()])}</b>.`);
  chips(Object.entries(NIVELES).map(([k, v]) => [v, () => { chat.nivel = k; responder(resumenRegionChat); }]));
}
function elegirDepartamento() {
  const d = burbuja(`¿Qué departamento deseas consultar?<br><select class="sel" style="width:100%;margin-top:8px"></select>
    <button type="button" class="btn-prim" style="margin-top:8px">Consultar</button>`);
  opcionesRegion(d.querySelector("select"), chat.region ?? estado.region);
  d.querySelector("button").addEventListener("click", () => {
    chat.region = d.querySelector("select").value || "";
    burbuja(esc(nombreRegion(chat.region)), "yo");
    responder(resumenRegionChat);
  });
}
const regionChat = () => (chat.region !== null ? chat.region : estado.region || "");
const datosChat = (anio = estado.anio) => datos(anio, nivelChat());

async function resumenRegionChat() {
  const r = regionChat(); const t = sumar(enRegion(await datosChat(), r));
  burbuja(`📍 <b>${esc(nombreRegion(r))}</b> · ${estado.anio}${etqNivelChat()}\nPIM: <b>${soles(t.pim)}</b>\nDevengado: <b>${soles(t.dev)}</b> (${pct(div(t.dev, t.pim))})\nPendiente: ${soles(t.pim - t.dev)}`);
  chipsMedidas();
}
function chipsMedidas() {
  burbuja("Elige una opción o escribe tu pregunta:");
  const r = regionChat();
  chips([
    ...MEDIDAS.map(([k, t]) => [t, () => responder(() => medidaChat(k))]),
    ["🏆 Ranking de UE", () => responder(rankingChat)],
    ...(r !== (estado.region || "") || nivelChat() !== estado.nivel ? [["✅ Aplicar en todo el sitio", () => {
      const n = nivelChat(); chat.nivel = null;
      if (n !== estado.nivel) { estado.nivel = n; guardar("upepino_nivel", n); $("#chip-nivel").value = n; }
      aplicarRegion(r);
      burbuja("¡Hecho! Todos los paneles ya muestran " + esc(nombreRegion(r)) + " · " + esc(NIVELES[n]) + ".");
    }, "pri"]] : []),
    ["⇄ Volver al menú", menuPrincipal, "sec"],
  ]);
}
async function medidaChat(k, anio = estado.anio, filtro = null) {
  const r = regionChat(); const todas = await datosChat(anio);
  const filas = filtro ? todas.filter(filtro.fn) : enRegion(todas, r);
  const quien = filtro ? filtro.nombre : nombreRegion(r);
  const t = sumar(filas);
  const etq = Object.fromEntries(MEDIDAS.map(([a, b]) => [a, b]));
  const val = k === "av" ? pct(div(t.dev, t.pim)) : k === "pend" ? soles(t.pim - t.dev) : soles(t[k]);
  let extra = "";
  if (k === "av") {
    const a = div(t.dev, t.pim);
    extra = a >= 0.8 ? "\n🟢 ¡Va muy bien!" : a >= 0.7 ? "\n🟡 Va regular, hay que acelerar." : "\n🔴 Va por debajo del 70 %, conviene revisar las alertas.";
  }
  if (k === "cer" || k === "com") extra = `\nEquivale al ${pct(div(t[k], t.pim))} del PIM.`;
  const sujeto = k === "av" ? "El avance de ejecución (devengado / PIM)" : `El ${["pia", "pim"].includes(k) ? etq[k] : etq[k].toLowerCase()}`;
  const de = /^el /i.test(quien) ? "del " + quien.slice(3) : "de " + quien;
  const ambito = filtro ? "" : nivelChat() ? ` (${NIVELES[nivelChat()].replace(/ \(.*\)/, "")})` : " (todos los niveles de gobierno)";
  burbuja(`${sujeto} ${esc(de).replace(/^(del?) (.*)$/, "$1 <b>$2</b>")}${ambito} en ${anio} es <b>${val}</b>.${extra}`);
  chipsMedidas();
}
async function rankingChat() {
  const r = regionChat(); const ues = agrupar(enRegion(await datosChat(), r), "u", (f) => f.un).filter((x) => x.pim >= 1e6);
  ues.sort((a, b) => div(a.dev, a.pim) - div(b.dev, b.pim));
  const peor = ues.slice(0, 5).map((x, i) => `${i + 1}. ${esc(x.n)} — ${pct(div(x.dev, x.pim))}`).join("\n");
  const mejor = ues.slice(-3).reverse().map((x, i) => `${i + 1}. ${esc(x.n)} — ${pct(div(x.dev, x.pim))}`).join("\n");
  burbuja(`📉 <b>Menor avance</b> en ${esc(nombreRegion(r))}${etqNivelChat()}:\n${peor}\n\n📈 <b>Mayor avance</b>:\n${mejor}\n<a class="btn-ir" href="#/alertas">Ver alertas →</a>`);
  chipsMedidas();
}
async function alertasChat() {
  const r = regionChat(); const ues = agrupar(enRegion(await datosChat(), r), "u", (f) => f.un).filter((x) => x.pim >= 1e6);
  const rojos = ues.filter((x) => div(x.dev, x.pim) < 0.7).sort((a, b) => (b.pim - b.dev) - (a.pim - a.dev));
  burbuja(rojos.length
    ? `🔔 En <b>${esc(nombreRegion(r))}</b>${etqNivelChat()} hay <b>${rojos.length}</b> unidades ejecutoras con avance menor al 70 %. Las de mayor monto pendiente:\n` +
      rojos.slice(0, 4).map((x) => `• ${esc(x.n)}: ${pct(div(x.dev, x.pim))}, faltan ${mill(x.pim - x.dev)}`).join("\n") +
      `\n<a class="btn-ir" href="#/alertas">Ver panel de alertas →</a>`
    : `🎉 En <b>${esc(nombreRegion(r))}</b>${etqNivelChat()} no hay unidades ejecutoras en rojo.`);
  chipsMedidas();
}

async function preguntaLibre(txt) {
  await cargarSaber();
  const q = corregir(norm(txt).replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim());
  if (/^(hola|buen|hey|saludos)/.test(q)) { burbuja("¡Hola! 🥒 Pregúntame, por ejemplo: <i>¿Cuánto devengó Cusco?</i>, <i>avance de San Marcos</i> o <i>alertas en Puno</i>."); return menuPrincipal(); }
  if (/gracias/.test(q)) return burbuja("¡De nada! Aquí estaré si necesitas algo más. 🥒");
  const anio = estado.anios.find((a) => q.includes(String(a))) || estado.anio;
  const dep = Object.entries(DEPARTAMENTOS).find(([, v]) => new RegExp(`\\b${norm(v)}\\b`).test(q));
  if (dep) chat.region = dep[0];
  else if (/\b(peru|todo el pais|a nivel nacional)\b/.test(q)) chat.region = "";
  // nivel de gobierno mencionado en la pregunta (si no menciona ninguno, se usa el del sitio)
  chat.nivel = null;
  if (/\b(gobiernos? regional(es)?|regionales|gore)\b/.test(q)) chat.nivel = "GR";
  else if (/\b(municipal\w*|gobiernos? locales?|locales|alcaldia)\b/.test(q)) chat.nivel = "GL";
  else if (/\b(sector|minedu|gobierno nacional)\b/.test(q)) chat.nivel = "GN";
  else if (/\btodos los niveles\b/.test(q)) chat.nivel = "";
  let medida = MEDIDAS.find(([, , claves]) => claves.some((c) => q.includes(c)));
  // lo que otras personas ya le enseñaron al chat
  const clave = claveFrase(q);
  const sabido = !medida ? aprendidoPara(clave) : null;
  const usadas = new Set(sabido ? sabido.f.split(" ") : []);
  if (sabido && sabido.i.startsWith("m:")) medida = MEDIDAS.find(([k]) => k === sabido.i.slice(2));
  // pliego o unidad ejecutora mencionada
  const palabras = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !usadas.has(w) && !VACIAS.has(w) && !["cuanto", "cuanta", "avance", "devengado", "como", "unidad", "ejecutora", "pliego",
    "region", "departamento", "tiene", "lleva", "ejecucion", "presupuesto", "girado", "certificado", "compromiso", "pendiente", "alertas",
    "gobierno", "gobiernos", "regional", "regionales", "local", "locales", "municipal", "municipales", "municipalidad", "municipalidades", "sector",
    "educacion", "nacional", "niveles", "todos", "nivel"].includes(w)
    && !Object.values(DEPARTAMENTOS).some((d) => norm(d).includes(w)));
  let entidad = null;
  if (palabras.length) {
    const filas = await datosChat(anio); const cand = new Map();
    for (const f of filas) {
      for (const [tipo, k, n] of [["u", f.u, f.un], ["p", f.p, f.pn]]) {
        const nn = norm(n); const s = palabras.filter((w) => nn.includes(w)).length;
        if (s && (!cand.has(tipo + k) || cand.get(tipo + k).s < s)) cand.set(tipo + k, { tipo, k, n, s });
      }
    }
    const lista = [...cand.values()].sort((a, b) => b.s - a.s || (a.tipo === "p" ? -1 : 1));
    if (lista.length) entidad = lista[0];
    if (lista.length > 1 && lista[1].s === lista[0].s && !medida) {
      burbuja("Encontré varias coincidencias, ¿cuál buscas?");
      return chips(lista.slice(0, 6).map((e) => [e.n, () => responder(() => entidadChat(e, "av", anio))]));
    }
  }
  const ok = (i) => { registrar("ok", claveConsulta(i)); };
  if (sabido && !sabido.i.startsWith("m:") && !entidad) { ok(sabido.i); return ejecutarIntencion(sabido.i, anio); }
  if (/alerta|riesgo|rojo|bajo avance|peor/.test(q) && !entidad) { ok("alertas"); return alertasChat(); }
  if (/ranking|mejor|mayor avance|menor avance/.test(q) && !entidad) { ok("ranking"); return rankingChat(); }
  if (/\b(correo|email|mail|enviame|envia|mandame|descargar|excel|archivo)\b/.test(q) && !entidad) {
    burbuja("📧 Te puedo enviar el enlace del último Excel del Sector a tu correo institucional. Escríbelo en la ventana."); return abrirCorreo();
  }
  if (/reporte|informe|formato/.test(q) && !entidad && !medida) { ok("reporte"); return ejecutarIntencion("reporte"); }
  if (entidad) return entidadChat(entidad, medida ? medida[0] : "av", anio);
  if (medida) { ok("m:" + medida[0]); return medidaChat(medida[0], anio); }
  if (dep) { ok("resumen"); return resumenRegionChat(); }
  // no entendió: pregunta qué quería y aprende de la respuesta
  registrar("no", clave || q, txt);
  if (!clave) {
    burbuja("No te entendí del todo 🤔. Puedes preguntarme cosas como:\n• <i>¿Cuánto es el PIM de Arequipa?</i>\n• <i>Avance de la UGEL Cusco</i>\n• <i>Devengado de San Marcos en 2025</i>\n• <i>Alertas en Loreto</i>");
    return menuPrincipal();
  }
  burbuja(`No estoy seguro de qué quieres decir con «<b>${esc(clave)}</b>» 🤔. ¿Qué querías saber? Elige una opción y así aprendo:`);
  chips([...Object.entries(INTENCIONES).map(([i, t]) => [t, () => {
    rpc("chat_ensenar", { p_frase: clave, p_intencion: i, p_sesion: sesionChat }).catch(() => {});
    registrar("ok", claveConsulta(i));
    responder(async () => {
      await ejecutarIntencion(i, anio);
      burbuja(`🥒 ¡Gracias! Tomo nota: «${esc(clave)}» = <b>${esc(t)}</b>. Cuando varias personas me enseñen lo mismo, lo entenderé solo.`);
    });
  }]), ["Ninguna, ver el menú", menuPrincipal, "sec"]]);
}
async function entidadChat(e, k, anio = estado.anio) {
  const fn = e.tipo === "u" ? (f) => f.u === e.k : (f) => f.p === e.k;
  const nombre = (e.tipo === "u" ? "la unidad ejecutora " : "el pliego ") + e.n;
  await medidaChat(k, anio, { fn, nombre });
}

function abrirChat() {
  $("#chat").hidden = false; $("#guia").hidden = true;
  if (!chat.iniciado) {
    chat.iniciado = true;
    burbuja(`¡Hola! Soy <b>UPPepino</b> 🥒 ¿En qué te ayudo hoy?${estado.region ? `\nEstoy mirando <b>${esc(nombreRegion())}</b>.` : ""}
Puedo responderte sobre el Sector Educación, los Gobiernos Regionales o los Gobiernos Locales. Escríbeme como quieras: si no te
entiendo, te pregunto y así voy aprendiendo.`);
    Promise.race([cargarSaber(), new Promise((r) => setTimeout(r, 1500))]).then(menuPrincipal);
  } else cargarSaber();
  setTimeout(() => $("#chat-txt").focus(), 100);
}
$("#fab").addEventListener("click", () => ($("#chat").hidden ? abrirChat() : ($("#chat").hidden = true)));
$("#chat-cerrar").addEventListener("click", () => { $("#chat").hidden = true; });
$("#chat-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const t = $("#chat-txt").value.trim(); if (!t) return;
  $("#chat-txt").value = ""; burbuja(esc(t), "yo"); responder(() => preguntaLibre(t));
});

// ------------------------------------------------------------------ arranque
(async function iniciar() {
  cargando();
  try {
    const cortes = (await rpc("pub_cortes")).map((c) => ({ ...c, nivel: c.nivel || "GN" }));
    estado.anios = [...new Set(cortes.map((c) => c.anio))].sort((a, b) => b - a);
    estado.cortes = Object.fromEntries(cortes.map((c) => [c.anio + "|" + c.nivel, c]));
    estado.anio = estado.anios[0];
    if (!estado.anio) throw new Error("Todavía no hay datos publicados.");
    $("#pie-corte").textContent = `Datos al ${fecha(ultimoCorte())}`;
  } catch (e) {
    $("#vista").innerHTML = `<div class="cont"><p class="vacio">😕 ${esc(e.message)}</p></div>`;
    return;
  }
  $("#chip-region span").textContent = nombreRegion();
  $("#chip-nivel").value = estado.nivel;
  if (estado.region) $("#chat-region").textContent = "📍 " + nombreRegion();
  await enrutar();
  if (leer("upepino_region") === null) setTimeout(abrirBienvenida, 600);
})();
