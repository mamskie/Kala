import { firebaseConfig, galleryDomain } from "./firebase-config.mjs";
import { connect } from "./cloud.mjs";
const $ = id => document.getElementById(id);
const map = $("map");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hostSlug = galleryDomain && location.hostname.endsWith("." + galleryDomain)
  ? location.hostname.slice(0, -(galleryDomain.length + 1)) : "";
const publicSlug = hostSlug || new URLSearchParams(location.search).get("galeri");
const regions = new Map();
const photoUrls = new Set();
const overview = [0, 0, 1000, 350];
const globe = [-30300, -7900, 44000, 15400];
const lockedLayer = document.createElementNS(map.namespaceURI, "g");
map.append(lockedLayer);
const mapLabels = [
  ["Laut Jawa", 110.3, -5.7],
  ["Madura", 113.5, -6.65],
  ["Samudra Hindia", 108.5, -8.55],
];
const project = (lon, lat) => [(lon - 104.8) * 83, (-4.85 - lat) * 83];
let records = [], selected, user, cloud, uid, profile, view = overview, renderId = 0;
let sessionId = 0;
const demo = !firebaseConfig && !publicSlug;
const demoRequestMessage = "Usulan tersimpan di browser ini selama mode demo.";
const titleCase = name => name.toLowerCase().replace(/\b\p{L}/gu, letter => letter.toUpperCase());
const message = text => { $("status").textContent = text; };
const canAdd = () => demo || Boolean(user && uid === user.uid && !publicSlug);

function localDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("atlas-kenangan", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("photos", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function localPhotos(record) {
  const database = await localDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("photos", record ? "readwrite" : "readonly");
      const store = transaction.objectStore("photos");
      const request = record ? store.add(record) : store.getAll();
      transaction.oncomplete = () => resolve(record || request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function setView(next) {
  const [x, y, w, h] = next;
  const [west, north] = project(-180, 90);
  const [east, south] = project(180, -90);
  const clamp = (position, length, start, end) => length >= end - start
    ? (start + end - length) / 2
    : Math.max(start - length * .1, Math.min(end - length * .9, position));
  view = [
    clamp(x, w, west, east), clamp(y, h, north, south), w, h,
  ];
  map.setAttribute("viewBox", view.join(" "));
  map.classList.toggle("map-zoomed", w < 780 || w > 1600);
  map.classList.toggle("global-view", w > 5000);
}

function zoom(factor) {
  const [x, y, width, height] = view;
  if (width * factor >= globe[2]) { setView(globe); return; }
  const scale = Math.max(22, width * factor) / width;
  setView([x + width * (1-scale)/2, y + height * (1-scale)/2, width * scale, height * scale]);
}

function draw(data, locked = false) {
  const shapes = document.createDocumentFragment();
  for (const feature of data.features) {
    const { id, district, province } = feature.properties;
    if (!feature.geometry) continue;
    const name = locked ? district : titleCase(district);
    const provinceName = titleCase(province).replace(/^Dki /, "DKI ");
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const geometry = polygons.flatMap(polygon => polygon.map(ring =>
      ring.map(([lon, lat], index) => (index ? "L" : "M") +
        project(lon, lat).map(value => value.toFixed(2)).join(",")).join("") + "Z"
    )).join("");
    path.setAttribute("d", geometry);
    path.setAttribute("class", locked ? "district locked" : "district active");
    path.setAttribute("fill-rule", "evenodd");
    const label = document.createElementNS(path.namespaceURI, "title");
    label.textContent = name + (provinceName ? ", " + provinceName : "") + (locked ? " · Segera hadir" : "");
    path.append(label);
    path.addEventListener("click", () => { if (!dragged) select(id); });
    regions.set(id, { name, province: provinceName, path, locked });
    shapes.append(path);
  }
  if (locked) { lockedLayer.append(shapes); render(); return; }
  map.append(shapes);
  const labels = document.createElementNS(map.namespaceURI, "g");
  labels.classList.add("map-labels");
  labels.setAttribute("aria-hidden", "true");
  for (const [name, lon, lat] of mapLabels) {
    const label = document.createElementNS(map.namespaceURI, "text");
    const [x, y] = project(lon, lat);
    label.setAttribute("x", x);
    label.setAttribute("y", y);
    label.textContent = name;
    labels.append(label);
  }
  map.append(labels);
  $("search").placeholder = "Contoh: Kota Bandung";
  $("search").disabled = false;
  render();
}

function select(id, focus = false) {
  selected = id;
  $("search").value = "";
  $("results").replaceChildren();
  if (focus) {
    const box = regions.get(id).path.getBBox();
    const width = Math.min(globe[2], Math.max(28, box.width * 1.7, box.height * 4.8));
    const height = width * overview[3] / overview[2];
    setView([box.x + (box.width-width)/2, box.y + (box.height-height)/2, width, height]);
  }
  render();
  if (matchMedia("(max-width:760px)").matches) $("region").scrollIntoView({ block:"nearest" });
}

async function render() {
  const generation = ++renderId;
  const activeRecords = records.filter(photo => regions.has(photo.region) && !regions.get(photo.region).locked);
  const occupied = new Set(activeRecords.map(photo => photo.region));
  $("colored").textContent = occupied.size;
  $("total").textContent = activeRecords.length;
  for (const [id, { path }] of regions) {
    path.classList.toggle("filled", occupied.has(id));
    path.classList.toggle("selected", id === selected);
  }
  for (const url of photoUrls) URL.revokeObjectURL(url);
  photoUrls.clear();
  $("photos").replaceChildren();
  const place = regions.get(selected);
  $("add").hidden = !place || place.locked || !canAdd();
  $("request").hidden = !place?.locked;
  $("requestStatus").hidden = true;
  $("requestStatus").textContent = "";
  $("region").textContent = place?.name || "Pilih daerah";
  if (place?.locked) {
    $("detail").textContent = "Segera hadir · Album wilayah ini masih terkunci.";
    if (demo) {
      try {
        if (localStorage.getItem("atlas-request:" + selected)) {
          $("requestStatus").hidden = false;
          $("requestStatus").textContent = demoRequestMessage;
        }
      } catch {
        // A browser can block local storage without blocking the map.
      }
    }
    return;
  }
  const photos = records.filter(photo => photo.region === selected).sort((a,b) => b.created-a.created);
  $("detail").textContent = place
    ? place.province + " · " + (photos.length ? photos.length + " foto" : "Belum ada foto")
    : "Klik wilayah di peta atau cari namanya untuk membuka album.";
  for (const [index, photo] of photos.entries()) {
    try {
      const blob = photo.blob || await cloud.photo(uid, photo.id);
      if (generation !== renderId) return;
      const url = URL.createObjectURL(blob);
      photoUrls.add(url);
      const button = document.createElement("button");
      const image = new Image();
      image.src = url;
      image.alt = "Foto kenangan di " + place.name;
      button.append(image);
      if (index === 0) {
        button.classList.add("album-cover");
        const caption = document.createElement("span");
        caption.textContent = photos.length + " foto";
        button.append(caption);
      }
      button.onclick = () => { $("full").src = url; $("full").alt = image.alt; $("viewer").showModal(); };
      $("photos").append(button);
    } catch {
      if (generation === renderId) $("detail").textContent = place.province + " · Sebagian foto gagal dimuat.";
    }
  }
}

$("search").oninput = () => {
  const query = $("search").value.trim().toLowerCase();
  const list = $("results");
  list.replaceChildren();
  if (!query) return;
  const term = query.replace(/^kab\.?\s+/, "kabupaten ");
  const rank = ({name, province}) => {
    const full = name.toLowerCase();
    const short = full.replace(/^(kabupaten|kota) /, "");
    if (full === term) return 0;
    if (short === term) return 1;
    if (full.startsWith(term) || short.startsWith(term)) return 2;
    return (full + " " + province.toLowerCase()).includes(term) ? 3 : Infinity;
  };
  const matches = [...regions].filter(([, place]) => Number.isFinite(rank(place)))
    .sort(([, a], [, b]) => rank(a) - rank(b) || Number(a.locked) - Number(b.locked));
  for (const [id, place] of matches.slice(0, 12)) {
    const item = document.createElement("button");
    item.textContent = place.name + (place.locked ? " · Segera hadir" : " · " + place.province);
    item.onclick = () => select(id, true);
    list.append(item);
  }
  if (!list.children.length) list.textContent = "Daerah atau negara tidak ditemukan.";
};
$("search").onkeydown = event => {
  if (event.key === "Enter") $("results").querySelector("button")?.click();
  if (event.key === "Escape") $("results").replaceChildren();
};
document.addEventListener("click", event => {
  if (!event.target.closest(".search")) $("results").replaceChildren();
});
$("plus").onclick = () => zoom(.65);
$("minus").onclick = () => zoom(1/.65);
$("world").onclick = () => setView(globe);
$("reset").onclick = () => setView(overview);
let drag, dragged = false;
map.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !event.isPrimary) return;
  dragged = false;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view };
});
map.addEventListener("pointermove", event => {
  if (drag?.id !== event.pointerId) return;
  const x = event.clientX - drag.x, y = event.clientY - drag.y;
  if (!dragged && Math.hypot(x,y) < 5) return;
  if (!dragged) map.setPointerCapture(event.pointerId);
  dragged = true;
  const ratio = drag.view[2] / map.clientWidth;
  setView([drag.view[0]-x*ratio, drag.view[1]-y*ratio, ...drag.view.slice(2)]);
});
window.addEventListener("pointerup", () => { drag = null; setTimeout(() => { dragged = false; }, 0); });
window.addEventListener("pointercancel", () => { drag = null; dragged = false; });

async function prepare(file) {
  if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024) throw new Error("Pilih foto yang didukung, maksimal 25 MB per file.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const image = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .84));
  if (!image || image.size > 5 * 1024 * 1024) throw new Error("Foto ini gagal dikompresi.");
  return image;
}

$("add").onclick = () => $("files").click();
$("request").onclick = async () => {
  const id = selected;
  const place = regions.get(id);
  if (!place?.locked) return;
  const status = $("requestStatus");
  $("request").disabled = true;
  let outcome;
  try {
    if (demo) {
      localStorage.setItem("atlas-request:" + id, place.name);
      outcome = demoRequestMessage;
    } else if (cloud && user) {
      await cloud.request(user.uid, id, place.name);
      outcome = "Usulan wilayah terkirim.";
    } else {
      outcome = "Masuk dengan Google di halaman utama untuk mengirim usulan.";
    }
  } catch {
    outcome = "Usulan gagal disimpan. Coba lagi.";
  } finally {
    $("request").disabled = false;
  }
  if (id === selected) {
    status.hidden = false;
    status.textContent = outcome;
  }
};
$("files").onchange = async () => {
  if (!canAdd() || !regions.has(selected) || regions.get(selected).locked) return;
  const region = selected, owner = uid, generation = sessionId;
  const files = Array.from($("files").files);
  if (!files.length) return;
  $("files").value = "";
  $("add").disabled = true;
  message("Menyimpan foto…");
  let saved = 0, failures = 0;
  try {
    for (const file of files) {
      if (generation !== sessionId) break;
      try {
        const blob = await prepare(file);
        if (generation !== sessionId) break;
        const record = demo
          ? await localPhotos({ id: crypto.randomUUID(), region, blob, created: Date.now() })
          : await cloud.save(owner, region, blob);
        if (generation !== sessionId) break;
        records.push(record);
        saved++;
      } catch (error) {
        console.error(error);
        failures++;
      }
    }
    if (generation === sessionId) {
      message(saved + " foto tersimpan." + (failures ? " " + failures + " foto gagal. Coba format lain atau pilih file di bawah 25 MB." : ""));
      render();
    }
  } finally {
    $("add").disabled = false;
  }
};

function showLink() {
  const slug = profile?.slug;
  $("slug").value = slug || "";
  $("copy").hidden = $("publicLink").hidden = $("unpublish").hidden = !slug;
  $("publicLink").value = slug ? (galleryDomain
    ? "https://" + slug + "." + galleryDomain + "/"
    : location.origin + "/?galeri=" + encodeURIComponent(slug)) : "";
}

$("share").onclick = () => {
  $("shareError").textContent = "";
  showLink();
  $("publish").showModal();
};
$("close").onclick = () => $("publish").close();
$("closeViewer").onclick = () => $("viewer").close();
$("viewer").onclose = () => $("full").removeAttribute("src");
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("publicLink").value);
    $("shareError").textContent = "Tautan disalin.";
  } catch {
    $("publicLink").select();
  }
};

async function publish(next) {
  const generation = sessionId;
  const buttons = $("publishForm").querySelectorAll("button");
  buttons.forEach(button => { button.disabled = true; });
  try {
    await cloud.publish(uid, next);
    if (generation !== sessionId) return;
    profile = { slug: next };
    showLink();
    $("shareError").textContent = next ? "Galeri diterbitkan." : "Galeri sekarang privat.";
  } catch (error) {
    $("shareError").textContent = error.message;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}
$("publishForm").onsubmit = event => {
  event.preventDefault();
  publish($("slug").value.trim().toLowerCase());
};
$("unpublish").onclick = () => publish(null);

async function loadAccount(account) {
  const generation = ++sessionId;
  user = account;
  uid = undefined;
  profile = undefined;
  records = [];
  $("share").hidden = true;
  $("account").textContent = user ? "Keluar" : "Masuk dengan Google";
  if ($("publish").open) $("publish").close();
  render();
  if (!user) { message("Masuk dengan Google untuk menyimpan foto."); return; }
  message("Memuat galeri…");
  try {
    const [nextProfile, nextRecords] = await Promise.all([cloud.profile(account.uid), cloud.list(account.uid)]);
    if (generation !== sessionId) return;
    uid = account.uid;
    records = nextRecords;
    profile = nextProfile;
    $("share").hidden = false;
    message("");
    render();
  } catch {
    if (generation === sessionId) message("Galeri gagal dimuat. Coba muat ulang halaman.");
  }
}

$("account").onclick = async () => {
  if (!cloud) { message("Login Google tersedia setelah proyek Firebase tersambung. Foto demo tersimpan di browser ini."); return; }
  try {
    if (user) await cloud.logout(); else await cloud.login();
  } catch {
    message("Login Google gagal. Periksa apakah domain ini diizinkan di Firebase.");
  }
};

async function start() {
  $("account").hidden = Boolean(publicSlug);
  fetch("/regions.json").then(response => {
    if (!response.ok) throw new Error("Peta gagal dimuat");
    return response.json();
  }).then(draw).catch(() => {
    $("region").textContent = "Peta gagal dimuat";
    $("search").placeholder = "Peta gagal dimuat";
  });
  fetch("/world.json").then(response => {
    if (!response.ok) throw new Error("Peta dunia gagal dimuat");
    return response.json();
  }).then(data => {
    draw(data, true);
    if ($("search").value) $("search").oninput();
  }).catch(error => console.error(error));
  if (demo) {
    message("Mode demo · Foto disimpan di browser ini.");
    records = await localPhotos();
    render();
    return;
  }
  if (!firebaseConfig) { message("Galeri publik tersedia setelah Firebase tersambung."); return; }
  cloud = await connect();
  if (!publicSlug) { cloud.subscribe(loadAccount); return; }
  uid = slugPattern.test(publicSlug) ? await cloud.gallery(publicSlug) : undefined;
  if (!uid) { message("Galeri ini tidak ditemukan atau sudah dijadikan privat."); return; }
  $("title").textContent = titleCase(publicSlug.replaceAll("-", " "));
  records = await cloud.list(uid);
  render();
}

start().catch(error => {
  console.error(error);
  message("Galeri gagal dimuat. Coba muat ulang halaman.");
});


