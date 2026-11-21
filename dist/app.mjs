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
let records = [], selected, user, cloud, uid, profile, view = [0, 0, 1000, 390], renderId = 0;
let sessionId = 0;
const demo = !firebaseConfig && !publicSlug;
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
  view = next;
  map.setAttribute("viewBox", view.join(" "));
}

function zoom(factor) {
  const [x, y, width, height] = view;
  const scale = Math.max(90, Math.min(1000, width * factor)) / width;
  setView([x + width * (1-scale)/2, y + height * (1-scale)/2, width * scale, height * scale]);
}

function draw(data) {
  const shapes = document.createDocumentFragment();
  for (const feature of data.features) {
    const { id, district, province } = feature.properties;
    if (!feature.geometry) continue;
    const name = titleCase(district);
    const provinceName = titleCase(province);
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const geometry = polygons.flatMap(polygon => polygon.map(ring =>
      ring.map(([lon, lat], index) => (index ? "L" : "M") + ((lon-94)*20.7).toFixed(2) + "," + ((6.7-lat)*20.7).toFixed(2)).join("") + "Z"
    )).join("");
    path.setAttribute("d", geometry);
    path.setAttribute("class", "district");
    path.setAttribute("fill-rule", "evenodd");
    const label = document.createElementNS(path.namespaceURI, "title");
    label.textContent = name + ", " + provinceName;
    path.append(label);
    path.addEventListener("click", () => { if (!dragged) select(id); });
    regions.set(id, { name, province: provinceName, path });
    shapes.append(path);
  }
  map.append(shapes);
  render();
}

function select(id, focus = false) {
  selected = id;
  $("search").value = "";
  $("results").replaceChildren();
  if (focus) {
    const box = regions.get(id).path.getBBox();
    const width = Math.min(1000, Math.max(105, box.width * 2.4, box.height * 6));
    const height = width * .39;
    setView([box.x + (box.width-width)/2, box.y + (box.height-height)/2, width, height]);
  }
  render();
  if (matchMedia("(max-width:760px)").matches) $("region").scrollIntoView({ block:"nearest" });
}

async function render() {
  const generation = ++renderId;
  const occupied = new Set(records.map(photo => photo.region));
  $("colored").textContent = occupied.size;
  $("total").textContent = records.length;
  for (const [id, { path }] of regions) {
    path.classList.toggle("filled", occupied.has(id));
    path.classList.toggle("selected", id === selected);
  }
  for (const url of photoUrls) URL.revokeObjectURL(url);
  photoUrls.clear();
  $("photos").replaceChildren();
  $("add").hidden = !selected || !canAdd();
  const place = regions.get(selected);
  $("region").textContent = place?.name || "Pilih daerah";
  const photos = records.filter(photo => photo.region === selected).sort((a,b) => b.created-a.created);
  $("detail").textContent = place
    ? place.province + " · " + (photos.length ? photos.length + " foto" : "Belum ada foto")
    : "Klik wilayah di peta atau cari namanya untuk membuka album.";
  for (const photo of photos) {
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
  for (const [id, place] of [...regions].filter(([, p]) =>
    (p.name + " " + p.province).toLowerCase().includes(query)
  ).slice(0, 12)) {
    const item = document.createElement("button");
    item.textContent = place.name + " · " + place.province;
    item.onclick = () => select(id, true);
    list.append(item);
  }
  if (!list.children.length) list.textContent = "Daerah tidak ditemukan.";
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
$("reset").onclick = () => setView([0,0,1000,390]);
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
$("files").onchange = async () => {
  if (!canAdd()) return;
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
  }).then(draw).catch(() => { $("region").textContent = "Peta gagal dimuat"; });
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


