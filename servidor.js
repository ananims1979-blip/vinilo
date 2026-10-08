// Servidor interno: muestra la interfaz, guarda listas, ajustes e imágenes,
// y ejecuta las descargas con yt-dlp. Lo usan la versión web (server.js)
// y la app de escritorio (main.js).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PUBLICO = path.join(__dirname, "public");
const MAX_JSON = 1_000_000;        // 1 MB
const MAX_IMAGEN = 6_000_000;      // 6 MB
const MAX_MINUTOS = 15;            // una descarga no puede tardar más que esto

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".png": "image/png",
};

// Descargas en curso: se cancelan si el programa se cierra
const procesos = new Set();
function detenerDescargas() {
  for (const p of procesos) {
    try { p.kill(); } catch {}
  }
}
process.on("exit", detenerDescargas);

// ============ Revisar el link antes de descargar ============
const PLATAFORMAS = [
  [/(^|\.)spotify\.(com|link)$/, "Spotify"],
  [/(^|\.)(music|itunes)\.apple\.com$/, "Apple Music"],
  [/(^|\.)deezer\.(com|page\.link)$/, "Deezer"],
  [/(^|\.)tidal\.com$/, "Tidal"],
  [/(^|\.)music\.amazon\./, "Amazon Music"],
  [/(^|\.)soundcloud\.com$/, "SoundCloud"],
  [/(^|\.)bandcamp\.com$/, "Bandcamp"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(instagram|facebook)\.com$/, "esa red social"],
];

const esDe = (host, dominio) => host === dominio || host.endsWith("." + dominio);

function revisarLink(texto) {
  let u;
  try {
    u = new URL(texto.trim());
  } catch {
    return { ok: false, mensaje: "Eso no es un link. Copia la dirección completa del video (empieza con https://)." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, mensaje: "Eso no es un link de internet." };
  }
  const host = u.hostname.toLowerCase();

  const esYouTube = ["youtube.com", "youtu.be", "youtube-nocookie.com"].some((d) => esDe(host, d));
  if (!esYouTube) {
    const plataforma = PLATAFORMAS.find(([regla]) => regla.test(host));
    if (plataforma) {
      return { ok: false, mensaje: `Los links de ${plataforma[1]} no se pueden descargar aquí. Busca la canción en YouTube y pega ese link.` };
    }
    return { ok: false, mensaje: "Solo se pueden descargar links de YouTube o YouTube Music." };
  }

  // Sacar el código del video (11 caracteres) según el tipo de link
  const partes = u.pathname.split("/").filter(Boolean);
  let id = null;
  if (esDe(host, "youtu.be")) id = partes[0];
  else if (partes[0] === "watch") id = u.searchParams.get("v");
  else if (["shorts", "live", "embed", "v"].includes(partes[0])) id = partes[1];
  else if (partes[0] === "playlist") {
    return { ok: false, mensaje: "Ese link es de una lista completa. Abre una canción de la lista y copia su link." };
  } else {
    return { ok: false, mensaje: "Ese link no lleva a un video (puede ser un canal o una búsqueda). Abre el video y copia su link." };
  }

  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return { ok: false, mensaje: "El link de YouTube está incompleto. Cópialo otra vez." };
  }
  // Se usa un link limpio: así se ignoran listas, mixes y otros datos del link
  return { ok: true, url: `https://www.youtube.com/watch?v=${id}` };
}

// ============ Errores de yt-dlp en español ============
function traducirError(texto, ayuda) {
  const reglas = [
    [/private video/i, "Este video es privado."],
    [/your country|geo.?restrict/i, "Este video no está disponible en tu país."],
    [/confirm your age|age.restricted|inappropriate/i, "YouTube pide iniciar sesión para este video (restricción de edad), así que no se puede descargar."],
    [/members.only|join this channel/i, "Este video es solo para miembros del canal."],
    [/not a bot|sign in to confirm/i, "YouTube bloqueó las descargas por un momento. Espera unos minutos y vuelve a intentar."],
    [/premieres? in|is upcoming|will begin/i, "Ese video todavía no se estrena."],
    [/unavailable|not available|has been removed|terminated|does not exist/i, "Este video ya no está disponible."],
    [/http error 403|forbidden|signature|nsig|player response/i, ayuda.actualizar],
    [/no space left/i, "No queda espacio en el disco."],
    [/ffmpeg|ffprobe/i, ayuda.ffmpeg],
    [/unable to download|getaddrinfo|network|timed out|connection|resolve|ssl|urlopen/i, "No hay conexión a internet o YouTube no respondió. Revisa tu conexión."],
  ];
  const regla = reglas.find(([patron]) => patron.test(texto));
  return regla ? regla[1] : "No se pudo descargar este link.";
}

// ============ Archivos .json (listas y ajustes) ============
function leerJsonArchivo(ruta, vacio) {
  if (!fs.existsSync(ruta)) return vacio;
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch {
    // Archivo dañado: se guarda una copia y se empieza de nuevo (no se pierde nada)
    try { fs.renameSync(ruta, `${ruta}.dañado-${Date.now()}`); } catch {}
    return vacio;
  }
}

// Guarda primero en un archivo temporal y luego lo renombra (así nunca queda a medias)
function escribirSeguro(ruta, contenido) {
  const temporal = `${ruta}.tmp`;
  fs.writeFileSync(temporal, contenido);
  fs.renameSync(temporal, ruta);
}

const esObjeto = (d) => d !== null && typeof d === "object" && !Array.isArray(d);
const esTexto = (t, max) => typeof t === "string" && t.length <= max;

function listasValidas(d) {
  return Array.isArray(d) && d.length <= 500 && d.every((l) =>
    esObjeto(l) &&
    esTexto(l.id, 40) && /^[a-z0-9]+$/.test(l.id) &&
    esTexto(l.nombre, 60) &&
    Array.isArray(l.canciones) && l.canciones.every((c) => esTexto(c, 400)) &&
    (l.portada == null || esTexto(l.portada, 300)));
}

// Lee el cuerpo de una petición con un límite de tamaño
function recibirCuerpo(req, maximo) {
  return new Promise((resolver, rechazar) => {
    const partes = [];
    let total = 0;
    let excedido = false;
    req.on("data", (parte) => {
      total += parte.length;
      if (total > maximo) {
        excedido = true; // se sigue leyendo (sin guardar) para poder responder bien
        partes.length = 0;
      } else if (!excedido) {
        partes.push(parte);
      }
    });
    req.on("end", () => (excedido ? rechazar(new Error("muy grande")) : resolver(Buffer.concat(partes))));
    req.on("error", rechazar);
  });
}

function responderJson(res, codigo, datos) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(datos));
}

// Separa la salida de yt-dlp en líneas completas
function porLineas(alRecibir) {
  let resto = "";
  return (chunk) => {
    const partes = (resto + chunk.toString("utf8")).split(/\r?\n/);
    resto = partes.pop();
    partes.forEach(alRecibir);
  };
}

/**
 * Inicia el servidor y devuelve el puerto.
 * opciones: carpeta, ytdlp, ffmpeg, node, puerto, entorno, listo, abrirCarpeta, ayuda
 */
function iniciarServidor(opciones) {
  const {
    carpeta, ytdlp, ffmpeg = null, node = null, puerto = 0, entorno = {},
    listo = Promise.resolve(), abrirCarpeta = () => {}, ayuda,
  } = opciones;

  const IMAGENES = path.join(carpeta, "imagenes");
  const LISTAS = path.join(carpeta, "listas.json");
  const AJUSTES = path.join(carpeta, "ajustes.json");
  fs.mkdirSync(IMAGENES, { recursive: true });

  // ---------- Envía un archivo (con soporte para adelantar el audio) ----------
  function enviarArchivo(req, res, ruta) {
    const tipo = TIPOS[path.extname(ruta).toLowerCase()];
    fs.stat(ruta, (err, info) => {
      if (err || !info.isFile() || !tipo) {
        res.writeHead(404);
        return res.end("No encontrado");
      }
      const base = { "Content-Type": tipo, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
      const rango = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      const flujo = (o) => fs.createReadStream(ruta, o).on("error", () => res.destroy()).pipe(res);
      if (rango && info.size > 0) {
        let inicio = rango[1] ? parseInt(rango[1], 10) : 0;
        let final = rango[2] ? Math.min(parseInt(rango[2], 10), info.size - 1) : info.size - 1;
        if (!rango[1] && rango[2]) { // "bytes=-500" = los últimos 500
          inicio = Math.max(info.size - parseInt(rango[2], 10), 0);
          final = info.size - 1;
        }
        if (inicio > final || inicio >= info.size) {
          res.writeHead(416, { "Content-Range": `bytes */${info.size}` });
          return res.end();
        }
        res.writeHead(206, { ...base, "Content-Range": `bytes ${inicio}-${final}/${info.size}`, "Content-Length": final - inicio + 1 });
        flujo({ start: inicio, end: final });
      } else {
        res.writeHead(200, { ...base, "Content-Length": info.size });
        flujo();
      }
    });
  }

  // ---------- Portadas ----------
  const claveCancion = (nombre) => crypto.createHash("sha1").update(nombre).digest("hex").slice(0, 16);
  const versionDe = (ruta) => Math.round(fs.statSync(ruta).mtimeMs);

  function portadaDe(nombreMp3) {
    const propia = path.join(IMAGENES, `c-${claveCancion(nombreMp3)}.jpg`);
    if (fs.existsSync(propia)) {
      return { url: `/imagenes/${path.basename(propia)}?v=${versionDe(propia)}`, propia: true };
    }
    const base = nombreMp3.slice(0, -4);
    const ext = [".jpg", ".webp", ".png"].find((e) => fs.existsSync(path.join(carpeta, base + e)));
    return ext ? { url: "/descargas/" + encodeURIComponent(base + ext), propia: false } : { url: null, propia: false };
  }

  // Lista los MP3 descargados (más recientes primero)
  function listarArchivos(res) {
    const archivos = [];
    for (const nombre of fs.readdirSync(carpeta)) {
      if (!nombre.toLowerCase().endsWith(".mp3")) continue;
      try {
        const info = fs.statSync(path.join(carpeta, nombre));
        if (!info.isFile()) continue;
        const portada = portadaDe(nombre);
        archivos.push({ nombre, tamano: info.size, fecha: info.mtimeMs, portada: portada.url, portadaPropia: portada.propia });
      } catch {} // el archivo se borró mientras se leía: se ignora
    }
    archivos.sort((a, b) => b.fecha - a.fecha);
    responderJson(res, 200, archivos);
  }

  // Dónde se guarda cada imagen personalizada
  function rutaImagen(params) {
    const tipo = params.get("tipo");
    const id = params.get("id") || "";
    if (tipo === "disco") return path.join(IMAGENES, "disco.jpg");
    if (tipo === "lista" && /^[a-z0-9]{1,40}$/.test(id)) return path.join(IMAGENES, `l-${id}.jpg`);
    if (tipo === "cancion" && id.toLowerCase().endsWith(".mp3") && path.basename(id) === id &&
        fs.existsSync(path.join(carpeta, id))) {
      return path.join(IMAGENES, `c-${claveCancion(id)}.jpg`);
    }
    return null;
  }

  async function guardarImagen(req, res, params) {
    const destino = rutaImagen(params);
    if (!destino) return responderJson(res, 400, { error: "Imagen no válida" });
    let datos;
    try {
      datos = await recibirCuerpo(req, MAX_IMAGEN);
    } catch {
      return responderJson(res, 413, { error: "La imagen es muy grande" });
    }
    const esJpeg = datos.length > 3 && datos[0] === 0xff && datos[1] === 0xd8 && datos[2] === 0xff;
    if (!esJpeg) return responderJson(res, 415, { error: "Formato no válido" });
    escribirSeguro(destino, datos);
    responderJson(res, 200, { url: `/imagenes/${path.basename(destino)}?v=${versionDe(destino)}` });
  }

  function borrarImagen(res, params) {
    const destino = rutaImagen(params);
    if (!destino) return responderJson(res, 400, { error: "Imagen no válida" });
    fs.rmSync(destino, { force: true });
    res.writeHead(204);
    res.end();
  }

  // ---------- Listas y ajustes ----------
  async function guardarJson(req, res, ruta, esValido) {
    try {
      const datos = JSON.parse((await recibirCuerpo(req, MAX_JSON)).toString("utf8"));
      if (!esValido(datos)) return responderJson(res, 400, { error: "Datos no válidos" });
      escribirSeguro(ruta, JSON.stringify(datos, null, 2));
      res.writeHead(204);
      res.end();
    } catch {
      responderJson(res, 400, { error: "Datos no válidos" });
    }
  }

  // ---------- Descargar (envía el avance en tiempo real) ----------
  async function descargar(res, params) {
    const revision = revisarLink(params.get("url") || "");
    const calidad = ["128", "192", "320"].includes(params.get("calidad")) ? params.get("calidad") : "192";

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    let cerrado = false;
    let proceso = null;
    const enviar = (datos) => {
      if (!cerrado) res.write(`data: ${JSON.stringify(datos)}\n\n`);
    };
    const latido = setInterval(() => !cerrado && res.write(": latido\n\n"), 15000);
    const terminar = (datos) => {
      enviar(datos);
      cerrado = true;
      clearInterval(latido);
      res.end();
    };
    res.on("close", () => {
      cerrado = true;
      clearInterval(latido);
      if (proceso) proceso.kill(); // se cerró la página: se cancela
    });
    res.write(": inicio\n\n"); // responde de inmediato (Safari lo necesita)

    if (!revision.ok) return terminar({ tipo: "error", mensaje: revision.mensaje });

    enviar({ tipo: "estado", mensaje: "Preparando..." });
    await listo; // en la app: espera a que termine la actualización de yt-dlp
    if (cerrado) return;

    const args = [
      "-x", "--audio-format", "mp3", "--audio-quality", calidad + "K",
      "--no-playlist", "--newline", "--write-thumbnail",
      "--match-filter", "!is_live & duration <? 7200",
      "--trim-filenames", "150",
      "--socket-timeout", "30",
      "-o", path.join(carpeta, "%(title)s.%(ext)s"),
    ];
    if (ffmpeg) args.push("--ffmpeg-location", ffmpeg);
    if (node) args.push("--js-runtimes", `node:${node}`);
    args.push("--", revision.url);

    proceso = spawn(ytdlp, args, {
      env: { ...process.env, ...entorno, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      windowsHide: true,
    });
    procesos.add(proceso);

    let ultimoError = "";
    let filtrado = false;
    let yaEstaba = false;
    let porTiempo = false;
    const limite = setTimeout(() => {
      porTiempo = true;
      proceso.kill();
    }, MAX_MINUTOS * 60 * 1000);

    const leerLinea = (linea) => {
      const destino = /^\[download\] Destination: (.+)$/.exec(linea);
      if (destino) {
        enviar({ tipo: "titulo", titulo: path.parse(destino[1]).name });
        enviar({ tipo: "estado", mensaje: "Descargando..." });
      }
      const existente = /^\[download\] (.+) has already been downloaded/.exec(linea);
      if (existente) {
        yaEstaba = true;
        enviar({ tipo: "titulo", titulo: path.parse(existente[1]).name });
      }
      const porcentaje = /^\[download\]\s+([\d.]+)%/.exec(linea);
      if (porcentaje) enviar({ tipo: "progreso", valor: parseFloat(porcentaje[1]) });
      if (linea.startsWith("[ExtractAudio]")) enviar({ tipo: "estado", mensaje: "Convirtiendo a MP3..." });
      if (linea.includes("does not pass filter")) filtrado = true;
      if (linea.startsWith("ERROR:")) ultimoError = linea;
    };
    proceso.stdout.on("data", porLineas(leerLinea));
    proceso.stderr.on("data", porLineas(leerLinea));

    let fin = false;
    const alTerminar = (datos) => {
      if (fin) return;
      fin = true;
      clearTimeout(limite);
      procesos.delete(proceso);
      if (ultimoError) console.log(ultimoError); // queda en la Terminal para revisar
      terminar(datos);
    };

    proceso.on("error", () => alTerminar({ tipo: "error", mensaje: ayuda.faltaYtdlp }));
    proceso.on("close", (codigo) => {
      if (porTiempo) {
        alTerminar({ tipo: "error", mensaje: "La descarga tardó demasiado y se canceló. Revisa tu internet e inténtalo otra vez." });
      } else if (filtrado) {
        alTerminar({ tipo: "error", mensaje: "Ese video dura más de 2 horas o es una transmisión en vivo." });
      } else if (codigo === 0) {
        alTerminar({ tipo: "listo", yaEstaba });
      } else {
        alTerminar({ tipo: "error", mensaje: traducirError(ultimoError, ayuda) });
      }
    });
  }

  // ---------- Rutas ----------
  async function atender(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const ruta = url.pathname;
    const puertoReal = servidor.address().port;
    const permitidos = [`127.0.0.1:${puertoReal}`, `localhost:${puertoReal}`];

    // Solo se aceptan visitas a esta dirección (protege de páginas web extrañas)
    if (!permitidos.includes(req.headers.host)) {
      res.writeHead(403);
      return res.end();
    }
    if (ruta.startsWith("/api/")) {
      const origen = req.headers.origin;
      const sitio = req.headers["sec-fetch-site"];
      if ((origen && !permitidos.includes(origen.replace(/^https?:\/\//, ""))) ||
          (sitio && sitio !== "same-origin" && sitio !== "none")) {
        res.writeHead(403);
        return res.end();
      }
    }

    const metodo = req.method;
    if (ruta === "/api/archivos") return listarArchivos(res);
    if (ruta === "/api/descargar") return descargar(res, url.searchParams);
    if (ruta === "/api/listas") {
      return metodo === "POST" ? guardarJson(req, res, LISTAS, listasValidas) : responderJson(res, 200, leerJsonArchivo(LISTAS, []));
    }
    if (ruta === "/api/ajustes") {
      return metodo === "POST" ? guardarJson(req, res, AJUSTES, esObjeto) : responderJson(res, 200, leerJsonArchivo(AJUSTES, {}));
    }
    if (ruta === "/api/imagen") {
      if (metodo === "POST") return guardarImagen(req, res, url.searchParams);
      if (metodo === "DELETE") return borrarImagen(res, url.searchParams);
    }
    if (ruta === "/api/abrir-carpeta" && metodo === "POST") {
      abrirCarpeta();
      res.writeHead(204);
      return res.end();
    }
    if (ruta.startsWith("/api/")) {
      res.writeHead(404);
      return res.end();
    }

    // Archivos: canciones, portadas, imágenes y la interfaz
    let nombre;
    try {
      nombre = path.basename(decodeURIComponent(ruta));
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (ruta.startsWith("/descargas/")) return enviarArchivo(req, res, path.join(carpeta, nombre));
    if (ruta.startsWith("/imagenes/")) return enviarArchivo(req, res, path.join(IMAGENES, nombre));
    enviarArchivo(req, res, path.join(PUBLICO, ruta === "/" ? "index.html" : nombre));
  }

  const servidor = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => atender(req, res))
      .catch((error) => {
        // Un error en una petición nunca debe cerrar el programa
        console.error(error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });

  return new Promise((resolver, rechazar) => {
    servidor.once("error", rechazar);
    servidor.listen(puerto, "127.0.0.1", () => resolver(servidor.address().port));
  });
}

module.exports = { iniciarServidor, detenerDescargas, revisarLink };
