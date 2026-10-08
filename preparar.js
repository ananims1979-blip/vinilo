// Descarga la versión oficial de yt-dlp para el sistema actual (solo la primera vez)
const fs = require("fs");
const path = require("path");

const ES_WINDOWS = process.platform === "win32";
const archivo = ES_WINDOWS ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
const destino = path.join(__dirname, "bin", ES_WINDOWS ? "yt-dlp.exe" : "yt-dlp");
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${archivo}`;

async function main() {
  if (fs.existsSync(destino)) {
    console.log("yt-dlp ya está listo.");
    return;
  }
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  console.log("Descargando yt-dlp...");
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`No se pudo descargar yt-dlp (error ${respuesta.status}).`);
  fs.writeFileSync(destino, Buffer.from(await respuesta.arrayBuffer()));
  if (!ES_WINDOWS) fs.chmodSync(destino, 0o755);
  console.log("yt-dlp listo.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
