// Proceso principal de la app (Electron)
const { app, BrowserWindow, shell, dialog, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const { iniciarServidor, detenerDescargas } = require("./servidor");

const ES_WINDOWS = process.platform === "win32";
const ES_MAC = process.platform === "darwin";
let ventana = null;

// Ruta de un archivo incluido dentro de la app
function rutaIncluida(...partes) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...partes)
    : path.join(__dirname, ...partes);
}

// Copia yt-dlp / ffmpeg a la carpeta de datos de la app (así yt-dlp puede actualizarse).
// "siempre" = volver a copiar si cambió (ffmpeg viene con cada versión de la app).
function copiarPrograma(origen, nombre, siempre = false) {
  const destino = path.join(app.getPath("userData"), "bin", nombre);
  const distinto = fs.existsSync(destino) && fs.statSync(destino).size !== fs.statSync(origen).size;
  if (!fs.existsSync(destino) || (siempre && distinto)) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(origen, destino);
    if (!ES_WINDOWS) fs.chmodSync(destino, 0o755);
    if (ES_MAC) spawnSync("xattr", ["-d", "com.apple.quarantine", destino]);
  }
  return destino;
}

// yt-dlp se actualiza solo al abrir la app (YouTube cambia seguido)
function actualizarYtDlp(ytdlp) {
  return new Promise((resolver) => {
    const proceso = spawn(ytdlp, ["-U"], { windowsHide: true, stdio: "ignore" });
    proceso.on("close", resolver);
    proceso.on("error", resolver);
    setTimeout(resolver, 30000); // si no hay internet, no espera para siempre
  });
}

async function crearVentana() {
  const carpeta = path.join(app.getPath("music"), "Descargador MP3");
  fs.mkdirSync(carpeta, { recursive: true });

  const nombreYtDlp = ES_WINDOWS ? "yt-dlp.exe" : "yt-dlp";
  const ytdlp = copiarPrograma(rutaIncluida("bin", nombreYtDlp), nombreYtDlp);
  const ffmpegIncluido = require("ffmpeg-static").replace("app.asar", "app.asar.unpacked");
  const ffmpeg = copiarPrograma(ffmpegIncluido, ES_WINDOWS ? "ffmpeg.exe" : "ffmpeg", true);

  const puerto = await iniciarServidor({
    carpeta,
    ytdlp,
    ffmpeg,
    node: process.execPath, // la misma app sirve como Node.js para yt-dlp
    entorno: { ELECTRON_RUN_AS_NODE: "1" },
    listo: actualizarYtDlp(ytdlp),
    abrirCarpeta: () => shell.openPath(carpeta),
    ayuda: {
      faltaYtdlp: "Falta un componente de la app. Vuelve a instalarla.",
      ffmpeg: "Falta un componente de la app. Vuelve a instalarla.",
      actualizar: "YouTube cambió algo. Cierra la app y ábrela de nuevo para que se actualice.",
    },
  });

  const direccion = `http://127.0.0.1:${puerto}`;
  ventana = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 520,
    minHeight: 600,
    title: "Vinilo",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141414" : "#F3F3F3",
  });
  ventana.once("ready-to-show", () => ventana.show());
  ventana.loadURL(direccion);

  // Los enlaces externos se abren en el navegador normal, nunca dentro de la app
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  ventana.webContents.on("will-navigate", (evento, url) => {
    if (!url.startsWith(direccion)) evento.preventDefault();
  });
}

// Si la app ya estaba abierta, se muestra esa ventana en vez de abrir otra
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!ventana) return;
    if (ventana.isMinimized()) ventana.restore();
    ventana.focus();
  });

  app.whenReady()
    .then(crearVentana)
    .catch((error) => {
      dialog.showErrorBox("No se pudo iniciar", error.message);
      app.quit();
    });
}

app.on("before-quit", detenerDescargas);
app.on("window-all-closed", () => app.quit());
