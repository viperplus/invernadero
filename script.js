// ===== CONFIG =====
// Canal de ThingSpeak (los widgets/gráficos de la página usan el canal público).
const CHANNEL_ID = 3442379;
// Read API Key: se puede dejar aunque el canal sea público (no molesta).
const READ_API_KEY = "N67ZWO1TGBA77FNL";

// URL del APPS SCRIPT (después de redeployar con las funciones
// "accion=ultima" y "accion=listar"). Pegá acá la URL que termina en /exec
// del NUEVO deployment.
const APPS_SCRIPT_FOTOS_URL = "https://script.google.com/macros/s/AKfycbzIu6ETc3UhdBa4IuNQdCEbYrAurNugTP-MI-cDt_M_Z1dS5WS_rYazAGTp5oXnU1RH0w/exec";

// Ritmos de refresco (los datos suben cada 30 s, las fotos cada 60 s).
const POLL_DATOS_MS = 10000;       // estado + valores actuales
const POLL_FOTO_MS = 10000;        // chequeo de foto nueva (liviano, sin imagen)
const POLL_IFRAME_MS = 60000;      // recarga de los gráficos de ThingSpeak
const MAX_ANTIGUEDAD_S = 90;       // si la lectura tiene más que esto, marca "sin datos"

// Write API Key: se usa para mandar los comandos (captura de foto e
// intervalo) desde la página. En un proyecto de producción esto iría por un
// proxy del lado del servidor, pero para un proyecto escolar está bien directo.
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
let esperandoFotoNueva = false;

// Consulta LIVIANA: pide solo id y fecha de la última foto (pocos bytes).
// Si el Apps Script publicado todavía no tiene este endpoint (deployment
// viejo), devuelve null y las funciones caen al método clásico.
async function consultarMeta() {
  try {
    const resp = await fetch(APPS_SCRIPT_FOTOS_URL + "?accion=ultimaMeta&camara=cam02&t=" + Date.now(), { cache: "no-store" });
    const texto = await resp.text();
    if (!texto.trim().startsWith("{")) return null;   // respuesta no-JSON = script viejo
    const meta = JSON.parse(texto);
    if (!meta.success) return null;
    return meta;
  } catch (e) {
    return null;
  }
}

// Descarga la última foto completa en base64 (método pesado).
async function traerUltimaCompleta() {
  const resp = await fetch(APPS_SCRIPT_FOTOS_URL + "?accion=ultima&camara=cam02&t=" + Date.now(), { cache: "no-store" });
  return resp.json();
}

// Muestra la foto directo desde los servidores de Google (rápido).
// Usa lh3.googleusercontent.com, que sirve la imagen compartida sin vueltas.
// Si falla, el listener de error prueba drive.google.com/thumbnail y por
// último el método pesado de descargar el base64.
function mostrarFoto(id, creada) {
  ultimoIdFoto = id;
  elem("foto").dataset.reintentos = "0";
  elem("foto").src = "https://lh3.googleusercontent.com/d/" + id + "=w1200";
  elem("foto").style.display = "block";
  elem("fotoLoader").classList.add("oculto");
  elem("fotoFecha").textContent =
    creada ? "Última foto: " + new Date(creada).toLocaleString() : "Última foto";
}

// Reintentos en cascada si la imagen no carga:
//   intento 1 -> drive.google.com/thumbnail (vista previa de Drive)
//   intento 2+ -> descargar el base64 completo desde Apps Script
elem("foto").addEventListener("error", () => {
  const src = elem("foto").src || "";
  if (!src || src.indexOf("data:image") === 0) return;

  const reintentos = parseInt(elem("foto").dataset.reintentos || "0", 10);
  const idActual = ultimoIdFoto;

  if (reintentos < 1 && idActual && src.indexOf("lh3.googleusercontent.com") >= 0) {
    elem("foto").dataset.reintentos = String(reintentos + 1);
    setTimeout(() => {
      if (ultimoIdFoto === idActual) {
        elem("foto").src = "https://drive.google.com/thumbnail?id=" + idActual + "&sz=w1200";
      }
    }, 3000);
    return;
  }

  if (!APPS_SCRIPT_FOTOS_URL.startsWith("http")) return;
  traerUltimaCompleta()
    .then((datos) => {
      if (datos.success && datos.base64 && datos.id === idActual) {
        elem("foto").src = "data:image/jpeg;base64," + datos.base64;
        elem("fotoFecha").textContent =
          datos.creada ? "Última foto: " + new Date(datos.creada).toLocaleString() : "Última foto";
      }
    })
    .catch(() => {});
});

// Evita que las consultas se pisen: si la anterior sigue en curso (Apps Script
// lento), el próximo tick del intervalo no arranca otra encima.
let cargandoFotoEnCurso = false;

async function cargarFoto() {
  if (cargandoFotoEnCurso) return;
  if (!APPS_SCRIPT_FOTOS_URL.startsWith("http")) return;
  if (esperandoFotoNueva) return;

  cargandoFotoEnCurso = true;
  try {
    const meta = await consultarMeta();

    if (meta) {
      if (!meta.id) {
        elem("fotoLoader").classList.add("oculto");
        elem("fotoFecha").textContent = "Sin fotos todavía";
        return;
      }
      if (meta.id === ultimoIdFoto) return;
      mostrarFoto(meta.id, meta.creada);
    } else {
      // Camino clásico (Apps Script sin actualizar)
      const datos = await traerUltimaCompleta();
      if (!datos.success || !datos.id || !datos.base64) {
        elem("foto").src = "";
        elem("fotoFecha").textContent = "Sin fotos todavía";
        ultimoIdFoto = null;
        return;
      }
      if (datos.id !== ultimoIdFoto) mostrarFoto(datos.id, datos.creada);
    }
  } catch (e) {
    console.log("Foto: " + e.message);
    elem("fotoLoader").classList.add("oculto");
  } finally {
    cargandoFotoEnCurso = false;
  }
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
        esperarFotoNueva();
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

async function esperarFotoNueva() {
  const idPrevio = ultimoIdFoto;
  esperandoFotoNueva = true;
  const usaMeta = (await consultarMeta()) !== null;
  const intentos = usaMeta ? 20 : 10;
  const pausa = usaMeta ? 4000 : 8000;

  for (let i = 0; i < intentos && esperandoFotoNueva; i++) {
    await new Promise((r) => setTimeout(r, pausa));
    try {
      if (usaMeta) {
        const meta = await consultarMeta();
        if (meta && meta.id && meta.id !== idPrevio) {
          mostrarFoto(meta.id, meta.creada);
          break;
        }
      } else {
        const datos = await traerUltimaCompleta();
        if (datos.success && datos.base64 && datos.id && datos.id !== idPrevio) {
          mostrarFoto(datos.id, datos.creada);
          break;
        }
      }
    } catch (e) {}
  }
  esperandoFotoNueva = false;
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
  const filtro = "brightness(" + brillo + "%) contrast(" + contraste + "%) saturate(" + saturacion + "%)";
  elem("foto").style.filter = filtro;
}

function resetearFiltros() {
  document.getElementById("ajBrillo").value = 100;
  document.getElementById("ajContraste").value = 100;
  document.getElementById("ajSaturacion").value = 100;
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

// Aplicar filtros por defecto (valores neutros, colores naturales)
aplicarFiltros();

// ===== Bitácora =====
const BLOG_PASSWORD = 'INVERNADERO2026';

function toggleBlogForm() {
  const form = document.getElementById("blogForm");
  form.classList.toggle("oculto");
}

function cargarPosts() {
  fetch(APPS_SCRIPT_FOTOS_URL + "?accion=listarPosts&n=10&t=" + Date.now(), { cache: "no-store" })
    .then((r) => r.json())
    .then((datos) => {
      const contenedor = document.getElementById("posts");
      if (!datos.success || !datos.posts || datos.posts.length === 0) {
        contenedor.innerHTML = '<div class="sinPosts">Todavía no hay publicaciones</div>';
        return;
      }
      contenedor.innerHTML = datos.posts.map((p, i) => {
        const d = new Date(p.fecha);
        const dia = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
        const img = p.imagenId
          ? '<img class="postImg" src="https://drive.google.com/uc?export=view&id=' + p.imagenId + '" alt="Post">'
          : '';
        return '<div class="post">' + img +
          '<div class="postFecha">' + dia + ' · ' + hora +
          ' <button class="postBorrar" onclick="borrarPost(' + i + ')" title="Borrar">✕</button></div>' +
          '<div class="postTexto">' + escapeHtml(p.texto) + '</div></div>';
      }).join("");
    })
    .catch(() => {});
}

function escapeHtml(t) {
  const d = document.createElement("div");
  d.textContent = t;
  return d.innerHTML;
}

document.getElementById("postImagen").addEventListener("change", function () {
  const preview = document.getElementById("blogPreview");
  if (this.files && this.files[0]) {
    const reader = new FileReader();
    reader.onload = function (e) {
      preview.innerHTML = '<img src="' + e.target.result + '" alt="Preview">';
    };
    reader.readAsDataURL(this.files[0]);
  } else {
    preview.innerHTML = "";
  }
});

function publicarPost() {
  const texto = document.getElementById("postTexto").value.trim();
  const estado = document.getElementById("postEstado");
  const archivo = document.getElementById("postImagen").files[0];

  if (!texto) { estado.textContent = "Escribí algo"; estado.className = "postEstado error"; return; }

  estado.textContent = "Publicando...";
  estado.className = "postEstado";

  if (archivo) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const b64 = e.target.result.split(",")[1];
      enviarPost({ accion: "nuevoPost", texto: texto, imagen: b64 });
    };
    reader.readAsDataURL(archivo);
  } else {
    enviarPost({ accion: "nuevoPost", texto: texto });
  }
}

function enviarPost(payload) {
  const estado = document.getElementById("postEstado");
  fetch(APPS_SCRIPT_FOTOS_URL, {
    method: "POST",
    body: JSON.stringify(payload)
  })
    .then((r) => r.json())
    .then((datos) => {
      if (datos.success) {
        estado.textContent = "¡Publicado!";
        estado.className = "postEstado ok";
        document.getElementById("postTexto").value = "";
        document.getElementById("postImagen").value = "";
        document.getElementById("blogPreview").innerHTML = "";
        cargarPosts();
        setTimeout(() => { document.getElementById("blogForm").classList.add("oculto"); }, 1500);
      } else {
        estado.textContent = datos.error || "Error";
        estado.className = "postEstado error";
      }
    })
    .catch(() => {
      estado.textContent = "Error de conexión";
      estado.className = "postEstado error";
    });
}

cargarPosts();
setInterval(cargarPosts, 60000);

function borrarPost(indice) {
  const pass = prompt("Contraseña:");
  if (!pass) return;
  fetch(APPS_SCRIPT_FOTOS_URL, {
    method: "POST",
    body: JSON.stringify({ accion: "borrarPost", indice: indice, contrasena: pass })
  })
    .then((r) => r.json())
    .then((datos) => {
      if (datos.success) {
        cargarPosts();
      } else {
        alert(datos.error || "Error al borrar");
      }
    })
    .catch(() => alert("Error de conexión"));
}
