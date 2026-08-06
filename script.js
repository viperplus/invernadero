// ===== CONFIG =====
// Canal de ThingSpeak (los widgets/gráficos de la página usan el canal público).
const CHANNEL_ID = 3442379;
// Read API Key: se puede dejar aunque el canal sea público (no molesta).
const READ_API_KEY = "N67ZWO1TGBA77FNL";

// URL del APPS SCRIPT (después de redeployar con las funciones
// "accion=ultima" y "accion=listar"). Pegá acá la URL que termina en /exec
// del NUEVO deployment.
const APPS_SCRIPT_FOTOS_URL = "https://script.google.com/macros/s/AKfycbxZ6Co7OjrWXhqq7Nxcgjp2TXekdKEsZM8Oxe8bDByPOoi351akA2KlxSJaImJdPU14/exec";

// Ritmos de refresco (los datos suben cada 30 s, las fotos cada 60 s).
const POLL_DATOS_MS = 10000;       // estado + valores actuales
const POLL_FOTO_MS = 60000;        // última foto
const POLL_IFRAME_MS = 60000;      // recarga de los gráficos de ThingSpeak
const MAX_ANTIGUEDAD_S = 90;       // si la lectura tiene más que esto, marca "sin datos"

// Write API Key: se usa para mandar el comando del buzzer desde la página.
// En un proyecto de producción esto iría por un proxy del lado del servidor,
// pero para un proyecto escolar está bien directo.
const WRITE_API_KEY = "JX7QTC0X482DVM3O";

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
  if (tl.activo) return;   // mientras corre el timelapse, no pisar la foto

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

// ----- Timelapse (reproduce las últimas fotos en secuencia) -----
let tl = { activo: false, fotos: [], idx: 0, timer: null, ms: 2000 };

function iniciarTimelapse() {
  if (tl.activo) {
    pausarTimelapse();
    return;
  }
  if (!APPS_SCRIPT_FOTOS_URL.startsWith("http")) return;

  elem("timelapseBtn").textContent = "Cargando...";
  fetch(APPS_SCRIPT_FOTOS_URL + "?accion=listar&n=15&t=" + Date.now(), { cache: "no-store" })
    .then((r) => r.json())
    .then((datos) => {
      if (!datos.success || !datos.fotos || datos.fotos.length < 2) {
        elem("timelapseBtn").textContent = "▶ Timelapse";
        alert("Todavía no hay suficientes fotos para el timelapse (se necesitan al menos 2).");
        return;
      }
      tl.activo = true;
      tl.fotos = datos.fotos;
      tl.idx = 0;
      elem("timelapseBtn").textContent = "⏸ Pausar";
      mostrarFrameTimelapse();
      programarTimelapse();
    })
    .catch(() => {
      elem("timelapseBtn").textContent = "▶ Timelapse";
    });
}

function mostrarFrameTimelapse() {
  const f = tl.fotos[tl.idx];
  if (!f) return;
  elem("foto").src = "data:image/jpeg;base64," + f.base64;
  elem("fotoFecha").textContent =
    "Timelapse · " + new Date(f.creada).toLocaleString();
  elem("tlProgreso").textContent = (tl.idx + 1) + "/" + tl.fotos.length;
  tl.idx = (tl.idx + 1) % tl.fotos.length;
}

function programarTimelapse() {
  tl.timer = setTimeout(() => {
    if (!tl.activo) return;
    mostrarFrameTimelapse();
    programarTimelapse();
  }, tl.ms);
}

function pausarTimelapse() {
  tl.activo = false;
  clearTimeout(tl.timer);
  elem("timelapseBtn").textContent = "▶ Timelapse";
}

function volverAlVivo() {
  pausarTimelapse();
  elem("tlProgreso").textContent = "";
  ultimoIdFoto = null;   // forzar a recargar la última foto subida
  cargarFoto();
}

function cambiarVelocidad(btn) {
  tl.ms = parseInt(btn.dataset.ms, 10) || 2000;
  document.querySelectorAll(".btn.vel").forEach((b) => b.classList.remove("act"));
  btn.classList.add("act");
}

// ----- Buzzer (comando desde la página vía ThingSpeak) -----
// Escribe field3=1 directo en ThingSpeak. El ESP32 sondea ese campo cada 5 s
// y, cuando ve una entrada nueva con "1", hace sonar el buzzer.
function enviarComandoBuzzer(btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Enviando...";

  fetch("https://api.thingspeak.com/update?api_key=" + WRITE_API_KEY + "&field3=1")
    .then((r) => r.text())
    .then((entrada) => {
      if (entrada && entrada !== "0") {
        btn.textContent = "¡Sonando!";
      } else {
        btn.textContent = "Error";
        alert("ThingSpeak no aceptó el comando. Probá de nuevo en unos segundos.");
      }
    })
    .catch(() => { btn.textContent = "Error"; })
    .finally(() => {
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 4000);
    });
}

// ----- Captura inmediata (field5 de ThingSpeak) -----
// Escribe field5=1 en ThingSpeak. El ESP32 toma una foto al instante.
function capturarFoto(btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Capturando...";

  fetch("https://api.thingspeak.com/update?api_key=" + WRITE_API_KEY + "&field5=1")
    .then((r) => r.text())
    .then((entrada) => {
      if (entrada && entrada !== "0") {
        btn.textContent = "¡Foto tomada!";
        // Recargar la foto después de ~15 s (tiempo para que suba a Drive)
        setTimeout(() => {
          ultimoIdFoto = null;
          cargarFoto();
        }, 15000);
      } else {
        btn.textContent = "Error";
        alert("ThingSpeak no aceptó el comando.");
      }
    })
    .catch(() => { btn.textContent = "Error"; })
    .finally(() => {
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 4000);
    });
}

// ----- Intervalo de fotos (field4 de ThingSpeak) -----
// Escribe la cantidad de SEGUNDOS entre fotos en field4.
// El ESP32 lee ese campo cada 5 s y ajusta el intervalo automáticamente.
function cambiarIntervalo(btn) {
  const seg = btn.dataset.seg;
  enviarIntervalo(seg, btn);
}

function cambiarIntervaloCustom() {
  const input = document.getElementById("intervaloInput");
  const seg = parseInt(input.value, 10);
  if (isNaN(seg) || seg < 15) {
    alert("Mínimo 15 segundos.");
    return;
  }
  enviarIntervalo(seg, null);
}

function enviarIntervalo(seg, btn) {
  fetch("https://api.thingspeak.com/update?api_key=" + WRITE_API_KEY + "&field4=" + seg)
    .then((r) => r.text())
    .then((entrada) => {
      if (entrada && entrada !== "0") {
        if (btn) {
          btn.classList.add("act");
          setTimeout(() => btn.classList.remove("act"), 2000);
        }
      } else {
        alert("ThingSpeak no aceptó el intervalo.");
      }
    })
    .catch(() => alert("Error de conexión"));
}

// ----- Ajustes de imagen (solo visual, CSS filters) -----
// Aplica filtros CSS a la foto para ajustar cómo se ve en la página.
// No modifica la foto original en Drive.
function aplicarFiltros() {
  const brillo = document.getElementById("ajBrillo").value;
  const contraste = document.getElementById("ajContraste").value;
  const saturacion = document.getElementById("ajSaturacion").value;
  const matiz = document.getElementById("ajMatiz").value;
  const filtro = "brightness(" + brillo + "%) contrast(" + contraste + "%) saturate(" + saturacion + "%) hue-rotate(" + matiz + "deg)";
  elem("foto").style.filter = filtro;
}

function resetearFiltros() {
  document.getElementById("ajBrillo").value = 100;
  document.getElementById("ajContraste").value = 100;
  document.getElementById("ajSaturacion").value = 30;
  document.getElementById("ajMatiz").value = 0;
  aplicarFiltros();
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

// Aplicar filtros de imagen por defecto (saturación 30%)
aplicarFiltros();
