const $ = (id) => document.getElementById(id);
const raiz = document.documentElement;
const principal = $("principal");
const audio = $("audio");
const btnPlay = $("btnPlay");
const barraTiempo = $("barraTiempo");
const esElectron = navigator.userAgent.includes("Electron");

// ================= Íconos =================
const ICONOS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pausa: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  opciones: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  ecualizador: '<span class="ecualizador" aria-hidden="true"><i></i><i></i><i></i></span>',
};

// Logos que se pueden elegir en Ajustes ({ACENTO} = color de fondo del logo)
const LOGOS = {
  disco: {
    nombre: "Disco",
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><circle cx="12" cy="12" r="7" fill="none" stroke="{ACENTO}" stroke-width=".7" opacity=".5"/><circle cx="12" cy="12" r="3.6" fill="{ACENTO}"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/></svg>',
  },
  nota: {
    nombre: "Nota",
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18V6.5l11-2.2V16" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="6.3" cy="18" r="3.1"/><circle cx="17.3" cy="16" r="3.1"/></svg>',
  },
  ondas: {
    nombre: "Ondas",
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2.5" y="9" width="3" height="6" rx="1.5"/><rect x="7.5" y="4.5" width="3" height="15" rx="1.5"/><rect x="12.5" y="2" width="3" height="20" rx="1.5"/><rect x="17.5" y="7" width="3" height="10" rx="1.5"/></svg>',
  },
  audifonos: {
    nombre: "Audífonos",
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 15v-3a8 8 0 0 1 16 0v3" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="2.5" y="13" width="5.2" height="8.5" rx="2.2"/><rect x="16.3" y="13" width="5.2" height="8.5" rx="2.2"/></svg>',
  },
};

// Tonos neutros para botones: [color, texto encima] en tema claro y oscuro
const COLORES = {
  contraste: { nombre: "Contraste", claro: ["#141414", "#FFFFFF"], oscuro: ["#EDEDED", "#141414"] },
  grafito: { nombre: "Grafito", claro: ["#3D3D3D", "#FFFFFF"], oscuro: ["#BDBDBD", "#141414"] },
  gris: { nombre: "Gris", claro: ["#767676", "#FFFFFF"], oscuro: ["#6E6E6E", "#FFFFFF"] },
  plata: { nombre: "Plata", claro: ["#C8C8C8", "#141414"], oscuro: ["#D9D9D9", "#141414"] },
  pizarra: { nombre: "Pizarra", claro: ["#4A5260", "#FFFFFF"], oscuro: ["#A3ABB8", "#141414"] },
  arena: { nombre: "Arena", claro: ["#78706A", "#FFFFFF"], oscuro: ["#C2B9AD", "#141414"] },
};

// Colores del disco de vinilo
const DISCOS = {
  negro: { nombre: "Negro", hex: "#151515" },
  grafito: { nombre: "Grafito", hex: "#4A4A4A" },
  blanco: { nombre: "Blanco", hex: "#E9E9E9" },
};

const DISCO_INICIAL = { color: "negro", imagen: null, centro: "portada", surcos: true };
const AJUSTES_INICIALES = { nombre: "Vinilo", icono: "disco", tema: "auto", color: "contraste", volumen: 1, disco: DISCO_INICIAL };
const copiar = (o) => JSON.parse(JSON.stringify(o));

// ================= Estado =================
let ajustes = copiar(AJUSTES_INICIALES);
let canciones = [];       // [{ nombre, tamano, fecha, portada, portadaPropia }]
let porNombre = new Map();
let listas = [];          // [{ id, nombre, canciones: [archivo.mp3], portada }]
let vista = "inicio";
let listaActual = null;   // id de la lista que se está viendo
let cola = [];            // canciones que se están reproduciendo
let posicion = -1;
let origenActual = "";
let descargando = false;
let sinConexion = false;

const sinExtension = (n) => n.replace(/\.mp3$/i, "");
const urlCancion = (n) => "/descargas/" + encodeURIComponent(n);
const actual = () => cola[posicion];
const existe = (n) => porNombre.has(n);
const megas = (bytes) => (bytes / 1048576).toFixed(1) + " MB";
const plural = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;
const esObjeto = (d) => d !== null && typeof d === "object" && !Array.isArray(d);

// ================= Comunicación con el programa =================
// Pide datos; si algo falla, usa el valor vacío y muestra un aviso
async function pedir(url, vacio) {
  try {
    const respuesta = await fetch(url, { cache: "no-store" });
    if (!respuesta.ok) throw new Error();
    return await respuesta.json();
  } catch {
    sinConexion = true;
    return vacio;
  }
}

// Guarda en orden (nunca una versión vieja encima de una nueva)
function crearGuardado(url, obtener, espera) {
  let temporizador = null;
  let cadena = Promise.resolve();
  const enviar = (keepalive = false) => {
    temporizador = null;
    const cuerpo = JSON.stringify(obtener());
    cadena = cadena.then(() =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpo, keepalive })
        .then((r) => {
          if (!r.ok) throw new Error();
        })
        .catch(() => mostrarToast("No se pudieron guardar los cambios. Revisa que el programa siga abierto.")));
  };
  const guardar = () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(enviar, espera);
  };
  guardar.ahora = () => {
    if (temporizador) {
      clearTimeout(temporizador);
      enviar(true);
    }
  };
  return guardar;
}
const guardarListas = crearGuardado("/api/listas", () => listas, 150);
const guardarAjustes = crearGuardado("/api/ajustes", () => ajustes, 400);
window.addEventListener("pagehide", () => {
  guardarListas.ahora();
  guardarAjustes.ahora();
});

async function cargarCanciones() {
  const datos = await pedir("/api/archivos", []);
  canciones = Array.isArray(datos) ? datos : [];
  porNombre = new Map(canciones.map((c) => [c.nombre, c]));
}

async function cargarListas() {
  const datos = await pedir("/api/listas", []);
  listas = Array.isArray(datos) ? datos.filter((l) => esObjeto(l) && Array.isArray(l.canciones)) : [];
}

// ================= Portadas =================
function numeroDe(texto) {
  let n = 0;
  for (const letra of texto) n = (n * 31 + letra.charCodeAt(0)) % 9973;
  return n;
}

// Fondo gris para lo que no tiene imagen (cada nombre tiene su tono fijo)
function fondoGenerico(texto) {
  const luz = 30 + (numeroDe(texto) % 30);
  return `linear-gradient(135deg, hsl(0 0% ${luz}%), hsl(0 0% ${luz - 16}%))`;
}

const portadaDe = (nombre) => (porNombre.get(nombre) || {}).portada || null;

function crearPortada(url, texto) {
  const div = document.createElement("div");
  div.className = "portada";
  if (url) {
    div.style.backgroundImage = `url("${url}")`;
  } else {
    div.style.backgroundImage = fondoGenerico(texto || "?");
    div.textContent = ((texto || "").match(/[\p{L}\p{N}]/u) || ["♪"])[0].toUpperCase();
  }
  return div;
}

const portadaCancion = (nombre) => crearPortada(portadaDe(nombre), sinExtension(nombre));

function portadaLista(lista) {
  const primera = temasDe(lista)[0];
  return crearPortada(lista.portada || (primera && portadaDe(primera)), lista.nombre);
}

// ================= Imágenes propias =================
function elegirArchivo() {
  return new Promise((resolver) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.hidden = true;
    document.body.appendChild(input);
    const terminar = (archivo) => {
      input.remove();
      resolver(archivo);
    };
    input.addEventListener("change", () => terminar(input.files[0] || null));
    input.addEventListener("cancel", () => terminar(null));
    input.click();
  });
}

// Recorta la imagen en cuadrado y la achica (así pesa poco)
async function recortarCuadrado(archivo, maximo = 900) {
  if (!archivo.type.startsWith("image/")) throw new Error("Ese archivo no es una imagen.");
  if (archivo.size > 40e6) throw new Error("La imagen es demasiado grande.");
  let imagen;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new Error("No se pudo abrir esa imagen. Usa un archivo JPG o PNG.");
  }
  const lado = Math.min(imagen.width, imagen.height);
  const salida = Math.min(maximo, lado);
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = salida;
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#FFFFFF"; // las imágenes transparentes quedan con fondo blanco
  ctx.fillRect(0, 0, salida, salida);
  ctx.drawImage(imagen, (imagen.width - lado) / 2, (imagen.height - lado) / 2, lado, lado, 0, 0, salida, salida);
  if (imagen.close) imagen.close();
  const blob = await new Promise((r) => lienzo.toBlob(r, "image/jpeg", 0.88));
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  return blob;
}

async function subirImagen(tipo, id = "") {
  const archivo = await elegirArchivo();
  if (!archivo) return null;
  let blob;
  try {
    blob = await recortarCuadrado(archivo);
  } catch (error) {
    mostrarToast(error.message);
    return null;
  }
  try {
    const r = await fetch(`/api/imagen?tipo=${tipo}&id=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    if (!r.ok) throw new Error();
    return (await r.json()).url;
  } catch {
    mostrarToast("No se pudo guardar la imagen.");
    return null;
  }
}

async function borrarImagen(tipo, id = "") {
  try {
    const r = await fetch(`/api/imagen?tipo=${tipo}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.ok;
  } catch {
    return false;
  }
}

// ================= Ajustes =================
function normalizarAjustes(guardados) {
  const a = { ...copiar(AJUSTES_INICIALES), ...(esObjeto(guardados) ? guardados : {}) };
  a.nombre = typeof a.nombre === "string" ? a.nombre.slice(0, 24) : AJUSTES_INICIALES.nombre;
  if (!LOGOS[a.icono]) a.icono = "disco";
  if (!COLORES[a.color]) a.color = "contraste";
  if (!["claro", "oscuro", "auto"].includes(a.tema)) a.tema = "auto";
  const volumen = Number(a.volumen);
  a.volumen = Number.isFinite(volumen) ? Math.min(1, Math.max(0, volumen)) : 1;

  const d = { ...DISCO_INICIAL, ...(esObjeto(a.disco) ? a.disco : {}) };
  if (!DISCOS[d.color]) d.color = "negro";
  if (!["portada", "liso", "ninguno"].includes(d.centro)) d.centro = "portada";
  d.surcos = d.surcos !== false;
  if (typeof d.imagen !== "string" || !d.imagen.startsWith("/imagenes/")) d.imagen = null;
  a.disco = d;
  return a;
}

function svgLogo(id, acento) {
  return (LOGOS[id] || LOGOS.disco).svg.replaceAll("{ACENTO}", acento);
}

function aplicarAjustes() {
  const color = COLORES[ajustes.color];
  raiz.style.setProperty("--ac-claro", color.claro[0]);
  raiz.style.setProperty("--so-claro", color.claro[1]);
  raiz.style.setProperty("--ac-oscuro", color.oscuro[0]);
  raiz.style.setProperty("--so-oscuro", color.oscuro[1]);
  raiz.dataset.tema = ajustes.tema;

  const nombre = ajustes.nombre.trim() || AJUSTES_INICIALES.nombre;
  $("nombreApp").textContent = nombre;
  document.title = nombre;

  // Colores reales del tema actual (para el logo y el ícono de la pestaña)
  const estilo = getComputedStyle(raiz);
  const acento = estilo.getPropertyValue("--acento").trim() || "#141414";
  const sobre = estilo.getPropertyValue("--sobre-acento").trim() || "#FFFFFF";
  $("logo").innerHTML = svgLogo(ajustes.icono, acento);
  document.querySelectorAll("#opcionesIcono .logo").forEach((el) => {
    el.innerHTML = svgLogo(el.dataset.icono, acento);
  });
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="${acento}"/><g transform="translate(5 5) scale(.92)" color="${sobre}">${svgLogo(ajustes.icono, acento)}</g></svg>`;
  $("favicon").href = "data:image/svg+xml," + encodeURIComponent(favicon);

  aplicarDisco();
}

function aplicarDisco() {
  const d = ajustes.disco;
  raiz.dataset.disco = d.color;
  raiz.dataset.surcos = d.surcos ? "si" : "no";
  raiz.dataset.centro = d.centro;
  raiz.dataset.discoImagen = d.imagen ? "si" : "no";
  raiz.style.setProperty("--disco-imagen", d.imagen ? `url("${d.imagen}")` : "none");
  $("btnQuitarImagenDisco").hidden = !d.imagen;
  $("btnImagenDisco").textContent = d.imagen ? "Cambiar imagen" : "Elegir imagen";
  actualizarCentros();
  actualizarAnimaciones();
}

// El centro de cada disco muestra la portada de la canción que suena
function actualizarCentros() {
  const fondo = (nombre) => {
    if (!nombre) return "none";
    const url = portadaDe(nombre);
    return url ? `url("${url}")` : fondoGenerico(sinExtension(nombre));
  };
  const sonando = actual();
  document.querySelectorAll("#repVinilo .vinilo-centro, #viniloGrande .vinilo-centro").forEach((el) => {
    el.style.backgroundImage = fondo(sonando);
  });
  const muestra = sonando || (canciones[0] && canciones[0].nombre);
  $("viniloMuestra").firstElementChild.style.backgroundImage = fondo(muestra);
}

// Si el Mac cambia de claro a oscuro, se actualizan el logo y el ícono
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", aplicarAjustes);

function pintarAjustes() {
  $("ajusteNombre").value = ajustes.nombre;

  const iconos = $("opcionesIcono");
  iconos.innerHTML = "";
  const acento = getComputedStyle(raiz).getPropertyValue("--acento").trim();
  Object.entries(LOGOS).forEach(([id, logo]) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="icono" value="${id}"><span class="logo" data-icono="${id}">${svgLogo(id, acento)}</span><span>${logo.nombre}</span>`;
    label.querySelector("input").checked = ajustes.icono === id;
    iconos.appendChild(label);
  });

  const colores = $("opcionesColor");
  colores.innerHTML = "";
  Object.entries(COLORES).forEach(([id, color]) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="color" value="${id}"><span class="muestra" style="background:linear-gradient(135deg, ${color.claro[0]} 50%, ${color.oscuro[0]} 50%)"></span><span>${color.nombre}</span>`;
    label.querySelector("input").checked = ajustes.color === id;
    colores.appendChild(label);
  });

  const discos = $("opcionesDisco");
  discos.innerHTML = "";
  Object.entries(DISCOS).forEach(([id, disco]) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="disco" value="${id}"><span class="muestra" style="background:${disco.hex}"></span><span>${disco.nombre}</span>`;
    label.querySelector("input").checked = ajustes.disco.color === id;
    discos.appendChild(label);
  });

  document.querySelectorAll('input[name="tema"]').forEach((r) => (r.checked = r.value === ajustes.tema));
  document.querySelectorAll('input[name="centro"]').forEach((r) => (r.checked = r.value === ajustes.disco.centro));
  $("ajusteSurcos").checked = ajustes.disco.surcos;
}

$("ajusteNombre").addEventListener("input", (e) => {
  ajustes.nombre = e.target.value.slice(0, 24);
  aplicarAjustes();
  guardarAjustes();
});

$("vista-ajustes").addEventListener("change", (e) => {
  const { name, value, id, checked } = e.target;
  if (name === "icono" || name === "color" || name === "tema") ajustes[name] = value;
  else if (name === "disco") ajustes.disco.color = value;
  else if (name === "centro") ajustes.disco.centro = value;
  else if (id === "ajusteSurcos") ajustes.disco.surcos = checked;
  else return;
  aplicarAjustes();
  guardarAjustes();
});

$("btnImagenDisco").addEventListener("click", async () => {
  const url = await subirImagen("disco");
  if (!url) return;
  ajustes.disco.imagen = url;
  aplicarDisco();
  guardarAjustes();
  mostrarToast("Imagen del disco cambiada");
});

$("btnQuitarImagenDisco").addEventListener("click", async () => {
  await borrarImagen("disco");
  ajustes.disco.imagen = null;
  aplicarDisco();
  guardarAjustes();
});

// ================= Menú flotante (⋯) =================
let menuActual = null;

function cerrarMenu(devolverFoco = false) {
  if (!menuActual) return;
  const { menu, boton } = menuActual;
  menu.remove();
  boton.setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", alTocarFuera, true);
  menuActual = null;
  if (devolverFoco) boton.focus();
}

function alTocarFuera(e) {
  if (menuActual && !menuActual.menu.contains(e.target) && !menuActual.boton.contains(e.target)) cerrarMenu();
}

// items: { texto, accion, nota, deshabilitado, peligro } | { titulo } | "-"
function abrirMenu(boton, items) {
  const yaAbierto = menuActual && menuActual.boton === boton;
  cerrarMenu();
  if (yaAbierto) return; // un segundo clic lo cierra

  const menu = document.createElement("div");
  menu.className = "menu-flotante";
  menu.setAttribute("role", "menu");
  items.forEach((item) => {
    if (item === "-") {
      menu.appendChild(document.createElement("hr"));
    } else if (item.titulo) {
      const t = document.createElement("div");
      t.className = "menu-flotante-titulo";
      t.textContent = item.titulo;
      menu.appendChild(t);
    } else {
      const b = document.createElement("button");
      b.className = "menu-opcion" + (item.peligro ? " peligro" : "");
      b.setAttribute("role", "menuitem");
      b.innerHTML = "<span></span>";
      b.firstChild.textContent = item.texto;
      if (item.nota) {
        const nota = document.createElement("small");
        nota.textContent = item.nota;
        b.appendChild(nota);
      }
      b.disabled = !!item.deshabilitado;
      b.onclick = () => {
        cerrarMenu();
        item.accion();
      };
      menu.appendChild(b);
    }
  });
  document.body.appendChild(menu);

  // Se coloca debajo del botón (o arriba si no cabe)
  const r = boton.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  let arriba = r.bottom + 6;
  if (arriba + m.height > window.innerHeight - 8) arriba = Math.max(8, r.top - m.height - 6);
  const izquierda = Math.max(8, Math.min(r.right - m.width, window.innerWidth - m.width - 8));
  menu.style.top = arriba + "px";
  menu.style.left = izquierda + "px";

  boton.setAttribute("aria-expanded", "true");
  menuActual = { menu, boton };
  document.addEventListener("pointerdown", alTocarFuera, true);

  const opciones = () => [...menu.querySelectorAll(".menu-opcion:not(:disabled)")];
  if (opciones()[0]) opciones()[0].focus();
  menu.addEventListener("keydown", (e) => {
    const lista = opciones();
    const i = lista.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      cerrarMenu(true);
    } else if (e.key === "ArrowDown" && lista.length) {
      e.preventDefault();
      lista[(i + 1) % lista.length].focus();
    } else if (e.key === "ArrowUp" && lista.length) {
      e.preventDefault();
      lista[(i - 1 + lista.length) % lista.length].focus();
    } else if (e.key === "Tab") {
      cerrarMenu();
    }
  });
}
principal.addEventListener("scroll", () => cerrarMenu());
window.addEventListener("resize", () => cerrarMenu());

// ================= Navegación =================
document.querySelectorAll("[data-vista]").forEach((b) => {
  b.addEventListener("click", () => irA(b.dataset.vista));
});
document.querySelectorAll("[data-ir]").forEach((b) => {
  b.addEventListener("click", () => {
    irA(b.dataset.ir);
    if (b.dataset.ancla) $(b.dataset.ancla).scrollIntoView({ block: "start" });
  });
});
$("btnNuevaListaLateral").addEventListener("click", () => {
  irA("listas");
  $("nombreLista").focus();
});
$("btnAhora").addEventListener("click", () => irA("sonando"));

function irA(nuevaVista, idLista = null) {
  cerrarMenu();
  vista = nuevaVista;
  listaActual = idLista;
  document.querySelectorAll(".vista").forEach((s) => {
    s.hidden = s.id !== "vista-" + vista;
  });
  principal.scrollTop = 0;
  pintar();
}

function pintar() {
  document.querySelectorAll(".menu-item").forEach((b) => {
    const activo = b.dataset.vista === vista || (vista === "lista" && b.dataset.vista === "listas");
    b.classList.toggle("activo", activo);
  });
  $("avisoConexion").hidden = !sinConexion;
  pintarMenuListas();
  if (vista === "inicio") pintarInicio();
  if (vista === "canciones") pintarCanciones();
  if (vista === "listas") pintarTarjetasListas();
  if (vista === "lista") pintarLista();
  if (vista === "sonando") pintarSonando();
  if (vista === "ajustes") pintarAjustes();
  actualizarSonando();
}

// ================= Inicio =================
function saludo() {
  const hora = new Date().getHours();
  if (hora >= 5 && hora < 12) return "Buenos días";
  if (hora >= 12 && hora < 19) return "Buenas tardes";
  return "Buenas noches";
}

function pintarInicio() {
  $("saludo").textContent = saludo();
  const cont = $("recientes");
  cont.innerHTML = "";
  if (canciones.length === 0) {
    cont.innerHTML = '<p class="vacio">Todavía no hay canciones. Pega un link arriba para descargar la primera.</p>';
    return;
  }
  const todas = canciones.map((c) => c.nombre);
  canciones.slice(0, 8).forEach((c, i) => {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta";
    tarjeta.dataset.cancion = c.nombre;

    const boton = document.createElement("button");
    boton.className = "tarjeta-boton";
    boton.setAttribute("aria-label", "Reproducir " + sinExtension(c.nombre));
    const portada = portadaCancion(c.nombre);
    portada.insertAdjacentHTML("beforeend", `<span class="play-flotante icono-play">${ICONOS.play}</span>`);
    boton.appendChild(portada);
    boton.insertAdjacentHTML("beforeend", '<span class="tarjeta-titulo"></span>');
    boton.querySelector(".tarjeta-titulo").textContent = sinExtension(c.nombre);
    boton.onclick = () => reproducir(todas, i, "Tus canciones");

    tarjeta.appendChild(boton);
    cont.appendChild(tarjeta);
  });
}

// ================= Filas de canciones =================
function crearFila(nombre, colaFila, indice, origen, lista = null) {
  const c = porNombre.get(nombre);
  const titulo = sinExtension(nombre);
  const li = document.createElement("li");
  li.className = "fila";
  li.dataset.cancion = nombre;

  const tocar = document.createElement("button");
  tocar.className = "fila-tocar";
  tocar.setAttribute("aria-label", "Reproducir " + titulo);
  tocar.appendChild(portadaCancion(nombre));
  tocar.insertAdjacentHTML("beforeend", `<span class="icono-play">${ICONOS.play}</span>`);
  tocar.onclick = () => reproducir(colaFila, indice, origen);

  const info = document.createElement("div");
  info.className = "fila-info";
  info.innerHTML = '<span class="fila-titulo"></span><span class="fila-detalle"></span>';
  info.querySelector(".fila-titulo").textContent = titulo;
  info.querySelector(".fila-detalle").textContent = c ? megas(c.tamano) : "";
  info.onclick = () => reproducir(colaFila, indice, origen);

  const opciones = document.createElement("button");
  opciones.className = "btn-opciones";
  opciones.setAttribute("aria-label", "Opciones de " + titulo);
  opciones.setAttribute("aria-haspopup", "menu");
  opciones.innerHTML = ICONOS.opciones;
  opciones.onclick = () => menuCancion(opciones, nombre, lista);

  li.append(tocar, info, opciones);
  return li;
}

function menuCancion(boton, nombre, lista) {
  const c = porNombre.get(nombre);
  const items = [{ titulo: "Añadir a una lista" }];
  if (listas.length === 0) {
    items.push({ texto: "Crear una lista nueva", accion: () => { irA("listas"); $("nombreLista").focus(); } });
  }
  listas.forEach((l) => {
    const yaEsta = l.canciones.includes(nombre);
    items.push({ texto: l.nombre, nota: yaEsta ? "Ya está" : "", deshabilitado: yaEsta, accion: () => agregarALista(l.id, nombre) });
  });
  items.push("-");
  items.push({ texto: "Cambiar portada", accion: () => cambiarPortadaCancion(nombre) });
  if (c && c.portadaPropia) items.push({ texto: "Usar la portada original", accion: () => quitarPortadaCancion(nombre) });
  if (lista) {
    items.push("-");
    items.push({ texto: "Quitar de esta lista", peligro: true, accion: () => quitarDeLista(lista, nombre) });
  }
  abrirMenu(boton, items);
}

async function cambiarPortadaCancion(nombre) {
  const url = await subirImagen("cancion", nombre);
  if (!url) return;
  await cargarCanciones();
  pintar();
  mostrarToast("Portada cambiada");
}

async function quitarPortadaCancion(nombre) {
  if (!(await borrarImagen("cancion", nombre))) {
    mostrarToast("No se pudo quitar la portada.");
    return;
  }
  await cargarCanciones();
  pintar();
}

// ================= Canciones =================
$("buscar").addEventListener("input", pintarCanciones);
$("btnCarpeta").addEventListener("click", () => {
  fetch("/api/abrir-carpeta", { method: "POST" }).catch(() => mostrarToast("No se pudo abrir la carpeta."));
});
$("btnTodas").addEventListener("click", () => {
  if (canciones.length) reproducir(canciones.map((c) => c.nombre), 0, "Tus canciones");
});

function pintarCanciones() {
  const total = canciones.reduce((s, c) => s + c.tamano, 0);
  $("detalleCanciones").textContent = canciones.length
    ? `${plural(canciones.length, "canción", "canciones")}, ${megas(total)}`
    : "";
  $("btnTodas").disabled = canciones.length === 0;

  const busqueda = $("buscar").value.trim();
  const texto = busqueda.toLowerCase();
  const visibles = canciones.map((c) => c.nombre).filter((n) => sinExtension(n).toLowerCase().includes(texto));

  const ul = $("canciones");
  ul.innerHTML = "";
  if (canciones.length === 0) {
    ul.innerHTML = '<li class="vacio">Aún no tienes canciones. Descárgalas desde Inicio.</li>';
    return;
  }
  if (visibles.length === 0) {
    const li = document.createElement("li");
    li.className = "vacio";
    li.textContent = `Ninguna canción coincide con «${busqueda}».`;
    ul.appendChild(li);
    return;
  }
  visibles.forEach((n, i) => ul.appendChild(crearFila(n, visibles, i, "Tus canciones")));
}

// ================= Listas =================
const temasDe = (lista) => lista.canciones.filter(existe);
const nombreRepetido = (nombre, sinId = null) =>
  listas.some((l) => l.id !== sinId && l.nombre.toLowerCase() === nombre.toLowerCase());

$("formLista").addEventListener("submit", (e) => {
  e.preventDefault();
  const nombre = $("nombreLista").value.trim();
  $("avisoLista").textContent = "";
  if (!nombre) {
    $("avisoLista").textContent = "Escribe un nombre para la lista.";
    return;
  }
  if (nombreRepetido(nombre)) {
    $("avisoLista").textContent = "Ya tienes una lista con ese nombre.";
    return;
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  listas.push({ id, nombre, canciones: [], portada: null });
  $("nombreLista").value = "";
  guardarListas();
  mostrarToast(`Lista «${nombre}» creada`);
  irA("lista", id);
});

function agregarALista(id, nombre) {
  const lista = listas.find((l) => l.id === id);
  if (!lista || lista.canciones.includes(nombre)) return;
  lista.canciones.push(nombre);
  guardarListas();
  pintarMenuListas();
  mostrarToast(`Añadida a «${lista.nombre}»`);
}

function quitarDeLista(lista, nombre) {
  lista.canciones = lista.canciones.filter((n) => n !== nombre);
  guardarListas();
  pintar();
}

function pintarMenuListas() {
  const ul = $("menuListas");
  ul.innerHTML = "";
  if (listas.length === 0) {
    ul.innerHTML = '<li class="menu-vacio">Sin listas todavía</li>';
    return;
  }
  listas.forEach((lista) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "menu-lista" + (vista === "lista" && listaActual === lista.id ? " activo" : "");
    b.appendChild(portadaLista(lista));
    b.insertAdjacentHTML("beforeend", "<span></span>");
    b.lastChild.textContent = lista.nombre;
    b.onclick = () => irA("lista", lista.id);
    li.appendChild(b);
    ul.appendChild(li);
  });
}

function pintarTarjetasListas() {
  const cont = $("tarjetasListas");
  cont.innerHTML = "";
  if (listas.length === 0) {
    cont.innerHTML = '<p class="vacio">Crea tu primera lista con el nombre que quieras.</p>';
    return;
  }
  listas.forEach((lista) => {
    const temas = temasDe(lista);
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta";

    const abrir = document.createElement("button");
    abrir.className = "tarjeta-boton";
    abrir.appendChild(portadaLista(lista));
    abrir.insertAdjacentHTML("beforeend", '<span class="tarjeta-titulo"></span><span class="tarjeta-detalle"></span>');
    abrir.querySelector(".tarjeta-titulo").textContent = lista.nombre;
    abrir.querySelector(".tarjeta-detalle").textContent = plural(temas.length, "canción", "canciones");
    abrir.onclick = () => irA("lista", lista.id);
    tarjeta.appendChild(abrir);

    if (temas.length) {
      const capa = document.createElement("div");
      capa.className = "tarjeta-capa";
      const play = document.createElement("button");
      play.className = "play-flotante";
      play.setAttribute("aria-label", "Reproducir " + lista.nombre);
      play.innerHTML = ICONOS.play;
      play.onclick = () => reproducir(temas, 0, "Lista: " + lista.nombre);
      capa.appendChild(play);
      tarjeta.appendChild(capa);
    }
    cont.appendChild(tarjeta);
  });
}

// ================= Una lista =================
function pintarLista() {
  const lista = listas.find((l) => l.id === listaActual);
  if (!lista) {
    irA("listas");
    return;
  }
  const temas = temasDe(lista);
  const origen = "Lista: " + lista.nombre;

  // Portada propia, o un collage con las primeras 4 portadas
  const collage = $("collageLista");
  collage.innerHTML = "";
  if (!lista.portada && temas.length >= 4) temas.slice(0, 4).forEach((n) => collage.appendChild(portadaCancion(n)));
  else collage.appendChild(portadaLista(lista));

  $("tituloLista").textContent = lista.nombre;
  $("detalleLista").textContent = plural(temas.length, "canción", "canciones");
  $("btnReproducirLista").disabled = temas.length === 0;
  $("btnReproducirLista").onclick = () => reproducir(temas, 0, origen);
  $("btnMenuLista").onclick = () => menuLista($("btnMenuLista"), lista);

  const ul = $("cancionesLista");
  ul.innerHTML = "";
  if (temas.length === 0) {
    ul.innerHTML = '<li class="vacio">Esta lista está vacía. Ve a Canciones y usa el botón ⋯ de cada canción para añadirla.</li>';
    return;
  }
  temas.forEach((n, i) => ul.appendChild(crearFila(n, temas, i, origen, lista)));
}

function menuLista(boton, lista) {
  const items = [
    { texto: "Renombrar", accion: () => renombrar(lista) },
    { texto: "Cambiar portada", accion: () => cambiarPortadaLista(lista) },
  ];
  if (lista.portada) items.push({ texto: "Quitar portada", accion: () => quitarPortadaLista(lista) });
  items.push("-", { texto: "Eliminar lista", peligro: true, accion: () => eliminarLista(lista) });
  abrirMenu(boton, items);
}

async function cambiarPortadaLista(lista) {
  const url = await subirImagen("lista", lista.id);
  if (!url) return;
  lista.portada = url;
  guardarListas();
  pintar();
}

async function quitarPortadaLista(lista) {
  await borrarImagen("lista", lista.id);
  lista.portada = null;
  guardarListas();
  pintar();
}

function eliminarLista(lista) {
  if (!confirm(`¿Eliminar la lista «${lista.nombre}»? Las canciones no se borran.`)) return;
  listas = listas.filter((l) => l.id !== lista.id);
  if (lista.portada) borrarImagen("lista", lista.id);
  guardarListas();
  mostrarToast(`Lista «${lista.nombre}» eliminada`);
  irA("listas");
}

// Cambia el título por una caja de texto para renombrar la lista
function renombrar(lista) {
  const titulo = $("tituloLista");
  const caja = document.createElement("input");
  caja.className = "renombrar";
  caja.maxLength = 40;
  caja.value = lista.nombre;
  caja.setAttribute("aria-label", "Nuevo nombre de la lista");
  titulo.replaceChildren(caja);
  caja.focus();
  caja.select();

  let terminado = false;
  const terminar = (guardar) => {
    if (terminado) return;
    terminado = true;
    const nuevo = caja.value.trim();
    if (guardar && nuevo && nuevo !== lista.nombre) {
      if (nombreRepetido(nuevo, lista.id)) {
        mostrarToast("Ya tienes una lista con ese nombre");
      } else {
        lista.nombre = nuevo;
        guardarListas();
      }
    }
    pintar();
  };
  caja.addEventListener("keydown", (e) => {
    if (e.key === "Enter") terminar(true);
    if (e.key === "Escape") terminar(false);
  });
  caja.addEventListener("blur", () => terminar(true));
}

// ================= Sonando ahora =================
function pintarSonando() {
  const nombre = actual();
  $("sonandoTitulo").textContent = nombre ? sinExtension(nombre) : "Nada sonando";
  $("sonandoOrigen").textContent = nombre ? origenActual : "Elige una canción para verla aquí.";
  const ul = $("siguientes");
  ul.innerHTML = "";
  const siguientes = nombre
    ? cola.slice(posicion + 1).map((n, i) => [n, posicion + 1 + i]).filter(([n]) => existe(n))
    : [];
  $("cabeceraSiguientes").hidden = siguientes.length === 0;
  siguientes.forEach(([n, indice]) => ul.appendChild(crearFila(n, cola, indice, origenActual)));
}

// ================= Descargar =================
$("btnDescargar").addEventListener("click", iniciarDescarga);

async function iniciarDescarga() {
  const txt = $("links");
  // Un link por línea (o varios en la misma línea separados por espacios), sin repetir.
  // Una línea sin links cuenta como un solo error, no uno por palabra.
  const entradas = [];
  for (const linea of txt.value.split("\n")) {
    const texto = linea.trim();
    if (!texto) continue;
    const urls = texto.match(/https?:\/\/\S+/gi);
    if (urls) entradas.push(...urls);
    else entradas.push(texto);
  }
  const links = [...new Set(entradas)];
  $("avisos").innerHTML = "";
  if (links.length === 0) {
    mostrarError("Pega al menos un link de YouTube.");
    return;
  }
  if (links.length > 30) {
    mostrarError("Pega hasta 30 links a la vez.");
    return;
  }

  $("btnDescargar").disabled = true;
  descargando = true;
  actualizarAnimaciones();
  $("progreso").hidden = false;

  let nuevas = 0;
  let repetidas = 0;
  const fallidos = [];
  for (let i = 0; i < links.length; i++) {
    $("contador").textContent = `${i + 1} de ${links.length}`;
    const resultado = await descargarUno(links[i]);
    if (!resultado.ok) {
      fallidos.push(links[i]);
      mostrarError(resultado.mensaje, links[i]);
    } else if (resultado.yaEstaba) {
      repetidas++;
    } else {
      nuevas++;
    }
    await cargarCanciones();
    pintar();
  }

  const partes = [plural(nuevas, "canción nueva", "canciones nuevas")];
  if (repetidas) partes.push(`${repetidas} que ya tenías`);
  if (fallidos.length) partes.push(`${fallidos.length} con problemas`);
  $("contador").textContent = "";
  $("tituloActual").textContent = "Listo: " + partes.join(", ");
  $("estado").textContent = fallidos.length ? "Los links con problemas quedaron en la caja para que los revises." : "";
  $("relleno").style.width = "0%";
  txt.value = fallidos.join("\n");
  descargando = false;
  actualizarAnimaciones();
  $("btnDescargar").disabled = false;
}

function descargarUno(link) {
  return new Promise((resolver) => {
    $("tituloActual").textContent = "Buscando el video...";
    $("estado").textContent = "Preparando...";
    $("relleno").style.width = "0%";

    const params = new URLSearchParams({ url: link, calidad: $("calidad").value });
    const fuente = new EventSource(`/api/descargar?${params}`);
    let terminado = false;
    const terminar = (resultado) => {
      if (terminado) return;
      terminado = true;
      fuente.close();
      resolver(resultado);
    };

    fuente.onmessage = (e) => {
      let d;
      try {
        d = JSON.parse(e.data);
      } catch {
        return;
      }
      if (d.tipo === "titulo") $("tituloActual").textContent = d.titulo;
      if (d.tipo === "progreso") $("relleno").style.width = Math.min(100, d.valor) + "%";
      if (d.tipo === "estado") $("estado").textContent = d.mensaje;
      if (d.tipo === "listo") terminar({ ok: true, yaEstaba: !!d.yaEstaba });
      if (d.tipo === "error") terminar({ ok: false, mensaje: d.mensaje });
    };
    fuente.onerror = () => {
      terminar({ ok: false, mensaje: "Se perdió la conexión con el programa. Ciérralo y vuelve a abrirlo." });
    };
  });
}

function mostrarError(mensaje, link = null) {
  const li = document.createElement("li");
  li.className = "aviso";
  li.innerHTML = "<strong></strong>";
  li.firstChild.textContent = mensaje;
  if (link) {
    const span = document.createElement("span");
    span.className = "aviso-link";
    span.textContent = link;
    li.appendChild(span);
  }
  $("avisos").appendChild(li);
}

// En el navegador, avisa antes de cerrar la pestaña si hay una descarga en curso
window.addEventListener("beforeunload", (e) => {
  if (descargando && !esElectron) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ================= Reproductor =================
function reproducir(nuevaCola, inicio, origen) {
  if (!nuevaCola.length || !nuevaCola[inicio]) return;
  const mismaCancion = nuevaCola[inicio] === actual();
  cola = nuevaCola.slice();
  posicion = inicio;
  origenActual = origen;
  $("repOrigen").textContent = origen;
  if (mismaCancion) {
    alternar();
    if (vista === "sonando") pintarSonando();
  } else {
    tocar();
  }
}

function tocar() {
  const nombre = actual();
  const titulo = sinExtension(nombre);
  audio.src = urlCancion(nombre);
  audio.play().catch(() => {});
  $("repTitulo").textContent = titulo;
  [btnPlay, $("btnAnterior"), $("btnSiguiente"), barraTiempo].forEach((b) => (b.disabled = false));

  // Controles del sistema (teclas de música del Mac y Centro de control)
  if ("mediaSession" in navigator) {
    const portada = portadaDe(nombre);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titulo,
      album: origenActual,
      artwork: portada ? [{ src: location.origin + portada }] : [],
    });
  }
  if (vista === "sonando") pintarSonando();
  actualizarSonando();
}

function alternar() {
  if (!actual()) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function siguiente() {
  if (posicion < cola.length - 1) {
    posicion++;
    tocar();
  }
}

function anterior() {
  if (audio.currentTime > 3 || posicion === 0) {
    audio.currentTime = 0;
  } else {
    posicion--;
    tocar();
  }
}

btnPlay.onclick = alternar;
$("btnAnterior").onclick = anterior;
$("btnSiguiente").onclick = siguiente;
audio.addEventListener("ended", siguiente);
audio.addEventListener("play", actualizarSonando);
audio.addEventListener("pause", actualizarSonando);

// Si una canción no se puede reproducir (por ejemplo, se borró), se pasa a la siguiente
audio.addEventListener("error", () => {
  if (!actual() || !audio.getAttribute("src")) return;
  mostrarToast(`No se pudo reproducir «${sinExtension(actual())}»`);
  if (posicion < cola.length - 1) setTimeout(siguiente, 1200);
});

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => audio.play().catch(() => {}));
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", anterior);
  navigator.mediaSession.setActionHandler("nexttrack", siguiente);
}

// Barra espaciadora = pausa / reproducir
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || menuActual) return;
  if (e.target.closest("input, textarea, select, button, [contenteditable]")) return;
  e.preventDefault();
  alternar();
});

// Marca la canción que suena en todas las vistas
function actualizarSonando() {
  const nombre = actual();
  const pausado = audio.paused;
  document.querySelectorAll("[data-cancion]").forEach((el) => {
    const es = el.dataset.cancion === nombre;
    el.classList.toggle("sonando", es);
    const icono = el.querySelector(".icono-play");
    if (icono) icono.innerHTML = es && !pausado ? ICONOS.ecualizador : ICONOS.play;
  });
  btnPlay.innerHTML = pausado ? ICONOS.play : ICONOS.pausa;
  btnPlay.setAttribute("aria-label", pausado ? "Reproducir" : "Pausar");
  actualizarCentros();
  actualizarAnimaciones();
}

function actualizarAnimaciones() {
  const sonando = !!actual() && !audio.paused;
  document.querySelectorAll(".vinilo").forEach((v) => v.classList.toggle("girando", sonando));
  $("logo").classList.toggle("girando", ajustes.icono === "disco" && (descargando || sonando));
}

// Barra de tiempo
let arrastrando = false;
const formatoTiempo = (s) => {
  s = Math.floor(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

audio.addEventListener("loadedmetadata", () => {
  $("tiempoTotal").textContent = formatoTiempo(audio.duration);
});
audio.addEventListener("timeupdate", () => {
  if (arrastrando || !audio.duration) return;
  barraTiempo.value = (audio.currentTime / audio.duration) * 100;
  $("tiempoActual").textContent = formatoTiempo(audio.currentTime);
});
barraTiempo.addEventListener("input", () => {
  arrastrando = true;
  $("tiempoActual").textContent = formatoTiempo((barraTiempo.value / 100) * (audio.duration || 0));
});
barraTiempo.addEventListener("change", () => {
  if (audio.duration) audio.currentTime = (barraTiempo.value / 100) * audio.duration;
  arrastrando = false;
});

// Volumen (se recuerda en Ajustes)
$("volumen").addEventListener("input", (e) => {
  audio.volume = Number(e.target.value);
  ajustes.volumen = audio.volume;
  guardarAjustes();
});

// ================= Mensaje flotante =================
let temporizadorToast;
function mostrarToast(texto) {
  const toast = $("toast");
  toast.textContent = texto;
  toast.classList.add("visible");
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => toast.classList.remove("visible"), 2600);
}

// ================= Inicio del programa =================
async function iniciar() {
  const [guardados] = await Promise.all([pedir("/api/ajustes", {}), cargarListas(), cargarCanciones()]);
  ajustes = normalizarAjustes(guardados);
  aplicarAjustes();
  audio.volume = ajustes.volumen;
  $("volumen").value = ajustes.volumen;
  btnPlay.innerHTML = ICONOS.play;
  irA("inicio");
}

iniciar();
