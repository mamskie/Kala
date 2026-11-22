import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { firebaseConfig } from "../dist/firebase-config.mjs";

const project = firebaseConfig.projectId;
const firestore = "https://firestore.googleapis.com/v1/projects/" + project + "/databases/(default)/documents";
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const maxBytes = 4 * 1024 * 1024;
const noCache = { "Cache-Control": "private, no-store" };
const validUid = uid => typeof uid === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(uid);
const validId = id => /^[a-zA-Z0-9_-]{16,64}$/.test(id);
const error = (message, status) => Response.json({ error: message }, { status, headers: noCache });
const photoPath = (uid, id) => "/profiles/" + uid + "/photos/" + id;
const blobPath = (uid, id) => "memories/" + uid + "/" + id;

async function firebaseUser(token) {
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ["RS256"],
    issuer: "https://securetoken.google.com/" + project,
    audience: project,
    requiredClaims: ["sub", "iat", "exp", "auth_time"],
  });
  if (!validUid(payload.sub) || !Number.isFinite(payload.auth_time) ||
      payload.auth_time > Date.now() / 1000 || payload.iat > Date.now() / 1000) {
    throw new Error("Invalid Firebase token");
  }
  return payload.sub;
}

async function upload(request, params, uid, authorization) {
  const region = params.get("region") || "";
  const date = params.get("date") || "";
  if (region.length > 160 || !region.includes("/") || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return error("Data daerah atau tanggal tidak valid.", 400);
  }
  if (Number(request.headers.get("content-length")) > maxBytes) return error("Foto maksimal 4 MB.", 413);
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > maxBytes) return error("Foto maksimal 4 MB.", 413);
  const webp = bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (!webp && !png) return error("Gunakan foto WebP atau PNG.", 415);

  const id = randomUUID();
  const created = Date.now();
  const blob = await put(blobPath(uid, id), bytes, {
    access: "private",
    addRandomSuffix: false,
    contentType: webp ? "image/webp" : "image/png",
  });
  const saved = await fetch(firestore + photoPath(uid, id) + "?currentDocument.exists=false", {
    method: "PATCH",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: {
      region: { stringValue: region },
      date: { stringValue: date },
      created: { integerValue: String(created) },
    } }),
  });
  if (!saved.ok) {
    if (saved.status >= 400 && saved.status < 500) await del(blob.url).catch(() => {});
    return error("Data foto gagal disimpan.", 502);
  }
  return Response.json({ id, region, date, created }, { status: 201, headers: noCache });
}

async function download(params, authorization) {
  const uid = params.get("uid") || "";
  const id = params.get("id") || "";
  if (!validUid(uid) || !validId(id)) return error("Foto tidak ditemukan.", 404);
  const slug = params.get("gallery");
  if (!slug) {
    try {
      if (!authorization?.startsWith("Bearer ") || await firebaseUser(authorization.slice(7)) !== uid) {
        return error("Foto tidak ditemukan.", 404);
      }
    } catch { return error("Foto tidak ditemukan.", 404); }
  } else {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 40) return error("Galeri tidak ditemukan.", 404);
    const gallery = await fetch(firestore + "/galleries/" + slug, { cache: "no-store" });
    if (!gallery.ok || (await gallery.json()).fields?.uid?.stringValue !== uid) {
      return error("Galeri tidak ditemukan.", 404);
    }
  }
  // Firestore checks the requesting Firebase user's ownership or the photo's current public visibility.
  const record = await fetch(firestore + photoPath(uid, id), {
    headers: slug ? {} : { Authorization: authorization },
    cache: "no-store",
  });
  if (!record.ok) {
    if ([401, 403, 404].includes(record.status)) return error("Foto tidak ditemukan.", 404);
    return error("Foto gagal dimuat.", 502);
  }
  if (slug && (await record.json()).fields?.visibility?.stringValue !== "public") {
    return error("Foto tidak ditemukan.", 404);
  }
  const result = await get(blobPath(uid, id), { access: "private" });
  if (!result || result.statusCode !== 200) return error("Foto tidak ditemukan.", 404);
  return new Response(result.stream, {
    headers: { ...noCache, "Content-Type": result.blob.contentType, "X-Content-Type-Options": "nosniff" },
  });
}

export default {
  async fetch(request) {
    const params = new URL(request.url).searchParams;
    const authorization = request.headers.get("authorization");
    try {
      if (request.method === "GET") return await download(params, authorization);
      if (request.method !== "POST") return error("Metode tidak tersedia.", 405);
      if (!authorization?.startsWith("Bearer ")) return error("Masuk untuk mengunggah foto.", 401);
      let uid;
      try { uid = await firebaseUser(authorization.slice(7)); }
      catch { return error("Sesi tidak valid. Masuk kembali.", 401); }
      return await upload(request, params, uid, authorization);
    } catch {
      return error("Penyimpanan foto sedang tidak tersedia.", 502);
    }
  },
};
