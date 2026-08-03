// ===== CONFIG =====
// Canal de ThingSpeak (los widgets/gráficos de la página usan el canal público).
const CHANNEL_ID = 3442379;
// Read API Key: se puede dejar aunque el canal sea público (no molesta).
const READ_API_KEY = "N67ZWO1TGBA77FNL";

// URL del APPS SCRIPT NUEVO (después de redeployar con la función "accion=ultima").
// Pegá acá la URL que termina en /exec del NUEVO deployment.
const APPS_SCRIPT_FOTOS_URL = "https://script.google.com/macros/s/AKfycbzb4IOCLv6jrXg5k4YQBxqUSmLvxfCDKcu9EI1c0iP4BWsUzHWHBIpepp3d-6zvPGkV/exec";

// Ritmos de refresco (los datos suben cada 30 s, las fotos cada 60 s).
const POLL_DATOS_MS = 10000;       // estado + valores actuales
const POLL_FOTO_MS = 60000;        // última foto
const POLL_IFRAME_MS = 60000;      // recarga de los gráficos de ThingSpeak
const MAX_ANTIGUEDAD_S = 90;       // si la lectura tiene más que esto, marca "sin datos"

const API_URL =
  "https://api.thingspeak.com/channels/" + CHANNEL_ID +
  "/feeds/last.json?api_key=" + READ_API_KEY;

const elem = (id) => document.getElementById(id);

// ----- Estado + valores actuales (ThingSpeak) -----
async function cargarDatos() {
  try {
    const resp = await fetch(API_URL + "&t=" + Date.now(), { cache: "no-store" });
    const texto = await resp.text();

    if (!texto.trim().startsWith("{")) {
      elem("dot").className = "dot vacio";
      elem("estado").textContent = "Esperando la primera lectura del ESP32...";
      elem("hora").textContent = "";
      return;
    }

    const datos = JSON.parse(texto);

    const temp = parseFloat(datos.field1);
    const hum = parseFloat(datos.field2);

    if (isNaN(temp) || isNaN(hum)) {
      elem("dot").className = "dot vacio";
      elem("estado").textContent = "Esperando la primera lectura del ESP32...";
      elem("hora").textContent = "";
      return;
    }

    elem("temp").textContent = temp.toFixed(1) + " °C";
    elem("hum").textContent = hum.toFixed(1) + " %";

    const ts = new Date(datos.created_at).getTime();
    const antiguedad = (Date.now() - ts) / 1000;
    const alDia = antiguedad < MAX_ANTIGUEDAD_S;

    elem("dot").className = "dot " + (alDia ? "ok" : "vacio");
    elem("estado").textContent = alDia ? "En línea" : "Sin datos recientes";
    elem("hora").textContent =
      "Última lectura: " + new Date(ts).toLocaleTimeString();
  } catch (e) {
    elem("dot").className = "dot error";
    elem("estado").textContent = "Error de conexión";
    elem("hora").textContent = e.message;
  }
}

// ----- Última foto de Drive (Apps Script) -----
let ultimoIdFoto = null;

async function cargarFoto() {
  if (!APPS_SCRIPT_FOTOS_URL.startsWith("http")) return; // placeholder sin configurar

  try {
    const resp = await fetch(APPS_SCRIPT_FOTOS_URL + "?accion=ultima&t=" + Date.now(), { cache: "no-store" });
    const datos = await resp.json();

    if (!datos.success || !datos.id || !datos.base64) {
      elem("foto").src = "";
      elem("fotoFecha").textContent = "Sin fotos todavía";
      ultimoIdFoto = null;
      return;
    }

    if (datos.id !== ultimoIdFoto) {
      ultimoIdFoto = datos.id;
      elem("foto").src = "data:image/jpeg;base64," + datos.base64;
      elem("fotoFecha").textContent =
        "Última foto: " + new Date(datos.creada).toLocaleString();
    }
  } catch (e) {
    // No romper la página si el endpoint de fotos falla
    console.log("Foto: " + e.message);
  }
}

// ----- Gráficos de ThingSpeak: ancho explícito (no se cortan) + refresco -----
// ThingSpeak dibuja el gráfico a los pixels que le pases en width/height.
// Se recalcula al cargar y al redimensionar la ventana.
function srcGrafico(f) {
  const w = Math.max(Math.floor(f.clientWidth), 250);
  let src = f.dataset.src.replace(/[?&](width|height)=\d+/g, "");
  const sep = src.includes("?") ? "&" : "?";
  return src + sep + "width=" + w + "&height=320&_=" + Date.now();
}

function refrescarGraficos() {
  document.querySelectorAll("iframe[data-reload]").forEach((f) => {
    f.src = srcGrafico(f);
  });
}

window.addEventListener("resize", refrescarGraficos);

// Arranque de los gráficos: tamaño inicial + ciclos
refrescarGraficos();
setInterval(refrescarGraficos, POLL_IFRAME_MS);

cargarDatos();
setInterval(cargarDatos, POLL_DATOS_MS);

cargarFoto();
setInterval(cargarFoto, POLL_FOTO_MS);
