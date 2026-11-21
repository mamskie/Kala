import { firebaseConfig, galleryDomain } from "./firebase-config.mjs";
import { connect } from "./cloud.mjs";
import { retention, memoryDay, memoryLabel, lastYearDay, validSlug } from "./memory.mjs";
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
const pinLayer = document.createElementNS(map.namespaceURI, "g");
pinLayer.classList.add("memory-pins");
map.append(lockedLayer);
const mapLabels = [
  ["Laut Jawa", 110.3, -5.7],
  ["Madura", 113.5, -6.65],
  ["Samudra Hindia", 108.5, -8.55],
];
const project = (lon, lat) => [(lon - 104.8) * 83, (-4.85 - lat) * 83];
let records = [], selected, user, cloud, uid, profile, view = overview, renderId = 0;
let sessionId = 0;
let viewedPhoto;
let viewerUrl;
let deleting = false;
let yearFilter = "";
let previousYear = false;
let wallMode = false;
let slideshow;
let trashRecords = [];
let slugCheck = 0;
const filteredPhotos = () => records.filter(photo => !photo.deletedAt
  && (!yearFilter || memoryDay(photo).startsWith(yearFilter))
  && (!previousYear || memoryDay(photo) === lastYearDay()));
const demo = !firebaseConfig && !publicSlug;
const demoRequestMessage = "Usulan tersimpan di browser ini selama mode demo.";
const albumTrack = $("photos");
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

async function localPhotos(record, removeId) {
  const database = await localDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("photos", record || removeId ? "readwrite" : "readonly");
      const store = transaction.objectStore("photos");
      const request = removeId ? store.delete(removeId) : record ? store.put(record) : store.getAll();
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
  map.append(pinLayer);
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

function albumPosition() {
  const pages = [...albumTrack.children];
  const index = Math.max(0, Math.round(albumTrack.scrollLeft / (albumTrack.clientWidth || 1)));
  return { pages, index: Math.min(index, Math.max(0, pages.length - 1)) };
}

function updateAlbumNav() {
  const {pages, index} = albumPosition();
  $("albumNav").hidden = pages.length < 2;
  $("photoPosition").textContent = (index + 1) + " / " + pages.length;
  $("prevPhoto").disabled = index === 0;
  $("nextPhoto").disabled = index >= pages.length - 1;
  $("slideshow").hidden = pages.length < 2;
}

function moveAlbum(step) {
  const {pages, index} = albumPosition();
  const target = Math.min(Math.max(index + step, 0), pages.length - 1);
  goToPhoto(target);
}

function goToPhoto(target) {
  albumTrack.scrollTo({left: target * albumTrack.clientWidth,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
}

albumTrack.addEventListener("scroll", updateAlbumNav, {passive:true});
$("prevPhoto").onclick = () => moveAlbum(-1);
$("nextPhoto").onclick = () => moveAlbum(1);

function updateTimeline() {
  const years = [...new Set(records.filter(photo => !photo.deletedAt).map(photo => memoryDay(photo).slice(0, 4)))].sort();
  const year = $("year");
  if (!years.includes(yearFilter)) yearFilter = "";
  year.max = years.length;
  year.value = yearFilter ? years.indexOf(yearFilter) + 1 : 0;
  $("timeline").hidden = years.length === 0;
  $("yearLabel").textContent = yearFilter || "Semua tahun";
  year.setAttribute("aria-valuetext", $("yearLabel").textContent);
  year.oninput = () => { yearFilter = years[Number(year.value) - 1] || ""; previousYear = false; render(); };
}

function showPhoto(photo, url) {
  viewedPhoto = photo;
  viewerUrl = url;
  $("full").src = url;
  $("full").alt = "Foto kenangan di " + regions.get(photo.region)?.name;
  $("downloadPhoto").href = url;
  $("confirmDelete").hidden = true;
  $("deletePhoto").hidden = $("editMemory").hidden = $("makeCover").hidden = !canAdd();
  updatePhotoInfo(photo);
  if (!$("viewer").open) $("viewer").showModal();
}

function updatePhotoInfo(photo) {
  $("photoRegion").textContent = regions.get(photo.region)?.name || "";
  $("photoDate").textContent = (photo.date ? "Tanggal kenangan · " : "Diunggah · ") + memoryLabel(photo);
  $("photoCaption").textContent = photo.caption || "";
  $("photoPeople").textContent = photo.people || "";
  $("memoryDate").value = photo.date || "";
  $("memoryCaption").value = photo.caption || "";
  $("memoryPeople").value = photo.people || "";
  $("memoryPublic").checked = photo.visibility === "public";
  $("memoryStatus").textContent = "";
}

async function photoUrl(photo) {
  let blob = photo.blob;
  if (!blob) blob = await cloud.photo(uid, photo.id);
  return URL.createObjectURL(blob);
}

function drawPins(grouped) {
  pinLayer.replaceChildren();
  if (wallMode) return;
  for (const [id, {count}] of grouped) {
    const {path, name} = regions.get(id);
    const [x, y] = path.__pin || (path.__pin = (() => {
      const box = path.getBBox();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })());
    const pin = document.createElementNS(map.namespaceURI, "path");
    pin.setAttribute("d", "M-5-6h10v12h-10z M-3-4h6v6h-6z");
    pin.setAttribute("transform", "translate(" + x + " " + y + ")");
    pin.setAttribute("fill-rule", "evenodd");
    pin.setAttribute("aria-label", name + ", " + count + " foto");
    pin.onclick = () => { if (!dragged) select(id); };
    pinLayer.append(pin);
  }
}

async function render() {
  const generation = ++renderId;
  updateTimeline();
  $("lastYear").setAttribute("aria-pressed", String(previousYear));
  $("mapMode").setAttribute("aria-pressed", String(!wallMode));
  $("wallMode").setAttribute("aria-pressed", String(wallMode));
  $("workspace").hidden = wallMode;
  $("wall").hidden = !wallMode;
  const activeRecords = filteredPhotos().filter(photo => regions.has(photo.region) && !regions.get(photo.region).locked);
  const grouped = new Map();
  for (const photo of activeRecords) {
    const entry = grouped.get(photo.region) || {count: 0, latest: photo};
    entry.count++;
    if (memoryDay(photo) > memoryDay(entry.latest)) entry.latest = photo;
    grouped.set(photo.region, entry);
  }
  $("colored").textContent = grouped.size;
  $("total").textContent = activeRecords.length;
  const activeCount = [...regions.values()].filter(region => !region.locked).length;
  const favorite = [...grouped].sort(([, a], [, b]) => b.count - a.count)[0];
  const latest = activeRecords.reduce((best, photo) => !best || photo.created > best.created ? photo : best, null);
  $("progressText").textContent = activeCount ? grouped.size + " dari " + activeCount + " daerah terisi" +
    (favorite ? " · Terbanyak di " + regions.get(favorite[0]).name : "") +
    (latest ? " · Terakhir diisi: " + regions.get(latest.region).name : "") : "";
  $("regionProgress").hidden = !activeCount;
  $("regionProgress").max = activeCount || 1;
  $("regionProgress").value = grouped.size;
  $("randomPhoto").disabled = activeRecords.length === 0;
  $("trash").hidden = !canAdd();
  for (const [id, { path, name, province, locked }] of regions) {
    const entry = grouped.get(id);
    const count = entry?.count || 0;
    path.classList.toggle("filled", count > 0);
    path.dataset.heat = count >= 6 ? "3" : count >= 3 ? "2" : count ? "1" : "0";
    path.classList.toggle("selected", id === selected);
    if (!locked) path.firstChild.textContent = name + ", " + province +
      (entry ? " · " + count + " foto · terakhir " + memoryLabel(entry.latest) : "");
  }
  drawPins(grouped);
  for (const url of photoUrls) if (url !== viewerUrl) URL.revokeObjectURL(url);
  photoUrls.clear();
  albumTrack.replaceChildren();
  $("filmstrip").replaceChildren();
  $("wall").replaceChildren();
  albumTrack.scrollLeft = 0;
  updateAlbumNav();
  const place = regions.get(selected);
  $("add").hidden = !place || place.locked || !canAdd();
  $("dropHint").hidden = $("add").hidden;
  if (wallMode) {
    if (!activeRecords.length) $("wall").textContent = "Belum ada foto pada periode ini.";
    for (const photo of [...activeRecords].sort((a, b) => memoryDay(b).localeCompare(memoryDay(a)))) {
      try {
        const url = await photoUrl(photo);
        if (generation !== renderId) { URL.revokeObjectURL(url); return; }
        photoUrls.add(url);
        const card = document.createElement("button");
        const image = new Image();
        const caption = document.createElement("span");
        image.src = url;
        image.alt = regions.get(photo.region).name;
        image.loading = "lazy";
        caption.textContent = [photo.caption || image.alt, memoryLabel(photo)].join(" · ");
        card.append(image, caption);
        card.onclick = () => showPhoto(photo, url);
        $("wall").append(card);
      } catch (error) { console.error(error); }
    }
    return;
  }
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
  const photos = activeRecords.filter(photo => photo.region === selected)
    .sort((a,b) => (b.coverAt || 0) - (a.coverAt || 0) || memoryDay(b).localeCompare(memoryDay(a)) || b.created-a.created);
  $("detail").textContent = place
    ? place.province + " · " + (photos.length ? photos.length + " foto" : "Belum ada foto")
    : "Klik wilayah di peta atau cari namanya untuk membuka album.";
  for (const [index, photo] of photos.entries()) {
    try {
      const url = await photoUrl(photo);
      if (generation !== renderId) { URL.revokeObjectURL(url); return; }
      photoUrls.add(url);
      const button = document.createElement("button");
      const image = new Image();
      image.src = url;
      image.alt = "Foto kenangan di " + place.name;
      button.append(image);
      const note = document.createElement("small");
      note.textContent = [photo.caption, memoryLabel(photo)].filter(Boolean).join(" · ");
      button.append(note);
      if (index === 0) {
        button.classList.add("album-cover");
        const caption = document.createElement("span");
        caption.textContent = photos.length + " foto";
        button.append(caption);
      }
      button.onclick = () => showPhoto(photo, url);
      albumTrack.append(button);
      const thumb = document.createElement("button");
      const thumbnail = new Image();
      thumbnail.src = url;
      thumbnail.alt = "Ke foto " + (index + 1);
      const position = albumTrack.children.length - 1;
      thumb.onclick = () => goToPhoto(position);
      thumb.append(thumbnail);
      $("filmstrip").append(thumb);
      updateAlbumNav();
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
  const memoryMatches = new Set(filteredPhotos().filter(photo =>
    ((photo.caption || "") + " " + (photo.people || "")).toLowerCase().includes(term)
  ).map(photo => photo.region));
  const matches = [...regions].filter(([id, place]) => Number.isFinite(rank(place)) || memoryMatches.has(id))
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
$("mapMode").onclick = () => { wallMode = false; render(); };
$("wallMode").onclick = () => { wallMode = true; stopSlideshow(); render(); };
$("lastYear").onclick = () => {
  previousYear = !previousYear;
  yearFilter = "";
  message(previousYear ? "Kenangan pada " + lastYearDay() + "." : "");
  render();
};
$("randomPhoto").onclick = async () => {
  const options = filteredPhotos().filter(photo => regions.has(photo.region));
  if (!options.length) return;
  const photo = options[Math.floor(Math.random() * options.length)];
  const generation = sessionId;
  try {
    const url = await photoUrl(photo);
    if (generation !== sessionId || $("viewer").open) { URL.revokeObjectURL(url); return; }
    showPhoto(photo, url);
  } catch { message("Foto gagal dibuka."); }
};
function stopSlideshow() {
  clearInterval(slideshow);
  slideshow = undefined;
  $("slideshow").textContent = "Putar slideshow";
}
$("slideshow").onclick = () => {
  if (slideshow) { stopSlideshow(); return; }
  $("slideshow").textContent = "Jeda slideshow";
  slideshow = setInterval(() => {
    const {pages, index} = albumPosition();
    if (pages.length < 2 || $("viewer").open) { stopSlideshow(); return; }
    goToPhoto((index + 1) % pages.length);
  }, 3500);
};
$("mapTheme").onchange = () => { map.closest(".chart").dataset.theme = $("mapTheme").value; };
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

async function inspectExif(file, fallbackRegion) {
  try {
    const {parse} = await import("./vendor/exifr.mjs");
    const exif = await parse(file);
    const taken = exif?.DateTimeOriginal;
    const date = taken instanceof Date && Number.isFinite(+taken)
      ? [taken.getFullYear(), String(taken.getMonth() + 1).padStart(2, "0"),
        String(taken.getDate()).padStart(2, "0")].join("-") : "";
    const lon = exif?.longitude, lat = exif?.latitude;
    let region = fallbackRegion;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      const [x, y] = project(lon, lat);
      const match = [...regions].find(([, place]) => !place.locked && place.path.isPointInFill(new DOMPoint(x, y)));
      if (match && match[0] !== fallbackRegion && confirm("Simpan foto di " + match[1].name + " sesuai lokasi foto?")) region = match[0];
    }
    return {region, date};
  } catch { return {region: fallbackRegion, date: ""}; }
}

$("add").onclick = () => $("files").click();
const albumPanel = $("region").closest("aside");
albumPanel.ondragover = event => {
  if (!$("add").hidden && event.dataTransfer.types.includes("Files")) event.preventDefault();
};
albumPanel.ondrop = event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  if (!$("add").hidden) savePhotos([...event.dataTransfer.files]);
};
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
$("files").onchange = () => {
  const files = Array.from($("files").files);
  $("files").value = "";
  savePhotos(files);
};
async function savePhotos(files) {
  if (!canAdd() || !regions.has(selected) || regions.get(selected).locked) return;
  const destination = selected, owner = uid, generation = sessionId;
  if (!files.length || $("add").disabled) return;
  $("add").disabled = true;
  message("Menyimpan foto…");
  let saved = 0, failures = 0;
  const firstRegions = new Set();
  try {
    for (const file of files) {
      if (generation !== sessionId) break;
      try {
        const blob = await prepare(file);
        if (generation !== sessionId) break;
        const {region, date} = await inspectExif(file, destination);
        if (generation !== sessionId) break;
        const first = !records.some(photo => photo.region === region);
        const record = demo
          ? await localPhotos({ id: crypto.randomUUID(), region, blob, created: Date.now(), date })
          : await cloud.save(owner, region, blob, date);
        if (generation !== sessionId) break;
        records.push(record);
        if (first) firstRegions.add(regions.get(region).name);
        saved++;
      } catch (error) {
        console.error(error);
        failures++;
      }
    }
    if (generation === sessionId) {
      message(saved + " foto tersimpan." +
        (firstRegions.size ? " Kenangan pertama di " + [...firstRegions].join(", ") + "." : "") +
        (failures ? " " + failures + " foto gagal. Coba format lain atau pilih file di bawah 25 MB." : ""));
      render();
    }
  } finally {
    $("add").disabled = false;
  }
}

function showLink() {
  const slug = profile?.slug;
  $("slug").value = slug || "";
  $("copy").hidden = $("publicLink").hidden = $("unpublish").hidden = !slug;
  $("publicLink").value = slug ? (galleryDomain
    ? "https://" + slug + "." + galleryDomain + "/"
    : location.origin + "/?galeri=" + encodeURIComponent(slug)) : "";
  $("publishButton").disabled = !uid || !cloud;
  previewLink();
}

function previewLink() {
  const draft = $("slug").value.trim();
  const name = validSlug(draft) ? draft : "nama-galeri";
  $("linkPreview").textContent = name + "." + (galleryDomain || "domainmu.id") + (galleryDomain ? "" : " (contoh alamat)");
}
$("slug").oninput = async () => {
  previewLink();
  const generation = ++slugCheck;
  const draft = $("slug").value.trim();
  const valid = validSlug(draft);
  $("slug").setCustomValidity(draft && !valid ? "Pakai 3–30 karakter dan hindari nama yang dicadangkan." : "");
  if (!valid || !cloud || !uid) return;
  await new Promise(resolve => setTimeout(resolve, 250));
  if (generation !== slugCheck) return;
  try {
    const claimant = await cloud.gallery(draft);
    if (generation !== slugCheck || !$("publish").open) return;
    const taken = claimant && claimant !== uid;
    $("shareError").textContent = taken ? "Sudah dipakai. Coba " + draft.slice(0, 25).replace(/-$/, "") + "-peta." : "Nama tersedia.";
    $("slug").setCustomValidity(taken ? "Nama sudah dipakai." : "");
  } catch { /* The transaction remains the final availability check. */ }
};
$("share").onclick = () => {
  $("shareError").textContent = demo ? "Berbagi publik memerlukan Firebase dan hosting publik. Subdomain juga memerlukan domain induk."
    : !uid ? "Masuk dengan Google untuk menerbitkan galeri."
    : !galleryDomain ? "Tautan biasa tersedia. Subdomain menunggu konfigurasi domain induk." : "";
  showLink();
  $("publish").showModal();
};
$("close").onclick = () => $("publish").close();
$("closeViewer").onclick = () => { if (!deleting) $("viewer").close(); };
$("viewer").oncancel = event => { if (deleting) event.preventDefault(); };
$("viewer").onclose = () => {
  if (viewerUrl && !photoUrls.has(viewerUrl)) URL.revokeObjectURL(viewerUrl);
  viewedPhoto = viewerUrl = undefined;
  $("full").removeAttribute("src");
  $("downloadPhoto").removeAttribute("href");
};
async function editPhoto(changes) {
  if (!viewedPhoto || !canAdd()) return;
  const generation = sessionId;
  const photo = { ...viewedPhoto, ...changes };
  try {
    if (demo) await localPhotos(photo);
    else await cloud.updatePhoto(uid, photo.id, changes);
    if (generation !== sessionId) return;
    records = records.map(item => item.id === photo.id ? photo : item);
    if (viewedPhoto?.id === photo.id) {
      viewedPhoto = photo;
      updatePhotoInfo(photo);
      $("memoryStatus").textContent = "Tersimpan.";
    }
    render();
  } catch {
    if (viewedPhoto?.id === photo.id) $("memoryStatus").textContent = "Gagal menyimpan detail.";
  }
}
$("editMemory").onsubmit = event => {
  event.preventDefault();
  editPhoto({date: $("memoryDate").value, caption: $("memoryCaption").value.trim(), people: $("memoryPeople").value.trim(),
    visibility: $("memoryPublic").checked ? "public" : "private"});
};
$("makeCover").onclick = () => editPhoto({coverAt: Date.now()});
$("deletePhoto").onclick = () => {
  $("deleteStatus").textContent = "Pindahkan foto ke tong sampah? Foto dapat dipulihkan selama 30 hari.";
  $("confirmDelete").hidden = false;
  $("cancelDelete").focus();
};
$("cancelDelete").onclick = () => { $("confirmDelete").hidden = true; $("deletePhoto").focus(); };
$("doDelete").onclick = async () => {
  if (!viewedPhoto || !canAdd() || deleting) return;
  const { id } = viewedPhoto;
  const owner = uid, generation = sessionId;
  const controls = $("viewer").querySelectorAll("button");
  deleting = true;
  controls.forEach(button => { button.disabled = true; });
  try {
    const photo = { ...viewedPhoto, deletedAt: Date.now() };
    if (demo) await localPhotos(photo);
    else await cloud.movePhoto(owner, id, false);
    if (generation !== sessionId) return;
    records = records.filter(photo => photo.id !== id);
    if (demo) trashRecords.push(photo);
    $("viewer").close();
    message("Foto dipindahkan ke tong sampah.");
    render();
  } catch {
    $("deleteStatus").textContent = "Foto gagal dihapus. Coba lagi.";
  } finally {
    deleting = false;
    controls.forEach(button => { button.disabled = false; });
  }
};
$("closeTrash").onclick = () => $("trashDialog").close();
$("trash").onclick = async () => {
  const generation = sessionId;
  const owner = uid;
  const list = $("trashList");
  list.textContent = "Memuat…";
  $("trashDialog").showModal();
  try {
    const deleted = (demo ? trashRecords : await cloud.trash(owner))
      .filter(photo => photo.deletedAt > Date.now() - retention);
    if (generation !== sessionId) return;
    list.textContent = deleted.length ? "" : "Tong sampah kosong.";
    for (const photo of deleted) {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = [regions.get(photo.region)?.name, photo.caption || memoryLabel(photo)].filter(Boolean).join(" · ");
      const restore = document.createElement("button");
      restore.textContent = "Pulihkan";
      restore.onclick = async () => {
        restore.disabled = true;
        try {
          if (!canAdd() || generation !== sessionId || photo.deletedAt <= Date.now() - retention) throw new Error();
          const {deletedAt, ...active} = photo;
          if (demo) await localPhotos(active);
          else await cloud.movePhoto(owner, photo.id, true);
          if (generation !== sessionId) return;
          trashRecords = trashRecords.filter(item => item.id !== photo.id);
          records.push(active);
          row.remove();
          if (!list.children.length) list.textContent = "Tong sampah kosong.";
          message("Foto dipulihkan.");
          render();
        } catch {
          restore.textContent = "Gagal, coba lagi";
          restore.disabled = false;
        }
      };
      row.append(label, restore);
      list.append(row);
    }
  } catch { list.textContent = "Tong sampah gagal dimuat."; }
};
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("publicLink").value);
    $("shareError").textContent = "Tautan disalin.";
  } catch {
    $("publicLink").select();
  }
};

async function publish(next) {
  if (!uid || !cloud) return;
  if (next && !validSlug(next)) return;
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
  if ($("viewer").open) $("viewer").close();
  if ($("trashDialog").open) $("trashDialog").close();
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
  $("share").hidden = Boolean(publicSlug);
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
    const saved = await localPhotos();
    records = saved.filter(photo => !photo.deletedAt);
    trashRecords = saved.filter(photo => photo.deletedAt > Date.now() - retention);
    for (const photo of saved) if (photo.deletedAt && photo.deletedAt <= Date.now() - retention) {
      await localPhotos(undefined, photo.id);
    }
    render();
    return;
  }
  if (!firebaseConfig) { message("Galeri publik tersedia setelah Firebase tersambung."); return; }
  cloud = await connect();
  if (!publicSlug) { cloud.subscribe(loadAccount); return; }
  uid = slugPattern.test(publicSlug) ? await cloud.gallery(publicSlug) : undefined;
  if (!uid) { message("Galeri ini tidak ditemukan atau sudah dijadikan privat."); return; }
  $("title").textContent = titleCase(publicSlug.replaceAll("-", " "));
  records = await cloud.list(uid, true);
  render();
}

start().catch(error => {
  console.error(error);
  message("Galeri gagal dimuat. Coba muat ulang halaman.");
});


