import { firebaseConfig } from "./firebase-config.mjs";
import { gallerySocial } from "./social.mjs";

export async function connect() {
  const base = "https://www.gstatic.com/firebasejs/11.10.0/";
  const [app, auth, db] = await Promise.all(
    ["app", "auth", "firestore"].map(name => import(base + "firebase-" + name + ".js"))
  );
  const instance = app.initializeApp(firebaseConfig);
  const session = auth.getAuth(instance);
  const database = db.getFirestore(instance);
  const profileRef = uid => db.doc(database, "profiles", uid);
  const slugRef = slug => db.doc(database, "galleries", slug);
  const photoList = uid => db.collection(database, "profiles", uid, "photos");
  const trashList = uid => db.collection(database, "profiles", uid, "trashedPhotos");
  const mapRef = uid => db.doc(database, "galleryMaps", uid);
  const accessList = uid => db.collection(profileRef(uid), "access");
  const accessRef = (uid, viewer) => db.doc(accessList(uid), viewer);

  async function authorization(uid) {
    if (!session.currentUser || session.currentUser.uid !== uid) throw new Error("Masuk kembali untuk mengakses foto.");
    return "Bearer " + await session.currentUser.getIdToken();
  }

  return {
    social: gallerySocial(db, database, session),
    request: (uid, place, name) => db.setDoc(db.doc(database, "regionRequests", uid, "places", place), {
      name, requestedAt: db.serverTimestamp(),
    }),
    subscribe: onUser => auth.onAuthStateChanged(session, onUser),
    login: () => auth.signInWithPopup(session, new auth.GoogleAuthProvider()),
    logout: () => auth.signOut(session),
    async profile(uid) {
      return (await db.getDoc(profileRef(uid))).data();
    },
    async gallery(slug) {
      return (await db.getDoc(slugRef(slug))).data()?.uid;
    },
    watchRegions(uid, onRegions, onError) {
      return db.onSnapshot(mapRef(uid), snapshot => onRegions(snapshot.data()?.regions || []), onError);
    },
    syncRegions(uid, onError) {
      let previous;
      return db.onSnapshot(photoList(uid), {includeMetadataChanges: true}, snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        const regions = [...new Set(snapshot.docs.map(photo => photo.data().region))].sort().slice(0, 119);
        const serialized = JSON.stringify(regions);
        if (serialized === previous) return;
        previous = serialized;
        db.setDoc(mapRef(uid), {regions}).catch(error => {
          if (previous === serialized) previous = undefined;
          onError(error);
        });
      }, onError);
    },
    watchAccess: (uid, viewer, onAccess, onError) =>
      db.onSnapshot(accessRef(uid, viewer), {includeMetadataChanges: true}, snapshot => {
        if (!snapshot.metadata.fromCache) onAccess(snapshot.data()?.status);
      }, onError),
    watchRequests: (uid, onRequests, onError) => db.onSnapshot(accessList(uid), snapshot => {
      onRequests(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})));
    }, onError),
    async askAccess(uid) {
      const account = session.currentUser;
      const token = await account.getIdTokenResult();
      await db.setDoc(accessRef(uid, account.uid), {
        name: token.claims.name ?? "Pengunjung", status: "pending", requestedAt: db.serverTimestamp(),
      });
    },
    approveAccess: (uid, viewer) => db.updateDoc(accessRef(uid, viewer), {status: "approved"}),
    removeAccess: (uid, viewer) => db.deleteDoc(accessRef(uid, viewer)),
    watchGalleryPhotos(uid, publicOnly, onPhotos, onError) {
      const photos = photoList(uid);
      const query = publicOnly ? db.query(photos, db.where("visibility", "==", "public")) : photos;
      return db.onSnapshot(query, {includeMetadataChanges: true}, snapshot => {
        if (!snapshot.metadata.fromCache) onPhotos(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})));
      }, onError);
    },
    async list(uid) {
      const snapshot = await db.getDocs(photoList(uid));
      return snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
    },
    async trash(uid) {
      const snapshot = await db.getDocs(trashList(uid));
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), deletedAt: doc.data().deletedAt.toMillis() }));
    },
    updatePhoto: (uid, id, changes) => db.updateDoc(db.doc(photoList(uid), id), changes),
    async movePhoto(uid, id, restore) {
      const active = db.doc(photoList(uid), id);
      const deleted = db.doc(trashList(uid), id);
      const from = restore ? deleted : active;
      const to = restore ? active : deleted;
      await db.runTransaction(database, async transaction => {
        const photo = (await transaction.get(from)).data();
        if (!photo) throw new Error("Foto tidak ditemukan.");
        const {deletedAt, ...details} = photo;
        transaction.set(to, restore ? details : {...details, deletedAt: db.serverTimestamp()});
        transaction.delete(from);
      });
    },
    async save(uid, region, blob, date) {
      const params = new URLSearchParams({ region, date });
      const response = await fetch("/api/photo?" + params, {
        method: "POST",
        headers: { Authorization: await authorization(uid), "Content-Type": "application/octet-stream" },
        body: blob,
      });
      if (!response.ok) throw new Error("Foto gagal disimpan (" + response.status + ").");
      return { ...await response.json(), blob };
    },
    async photo(uid, id, publicSlug) {
      const params = new URLSearchParams({ uid, id });
      if (publicSlug) params.set("gallery", publicSlug);
      const response = await fetch("/api/photo?" + params, {
        headers: { Authorization: await authorization(publicSlug ? session.currentUser?.uid : uid) },
      });
      if (!response.ok) throw new Error("Foto gagal dimuat (" + response.status + ").");
      return response.blob();
    },
    async publish(uid, next) {
      await db.runTransaction(database, async transaction => {
        const previous = (await transaction.get(profileRef(uid))).data()?.slug;
        if (next && next !== previous) {
          const target = await transaction.get(slugRef(next));
          if (target.exists()) throw new Error("Nama galeri ini sudah dipakai.");
        }
        if (previous && previous !== next) transaction.delete(slugRef(previous));
        if (next) transaction.set(slugRef(next), { uid });
        transaction.set(profileRef(uid), { slug: next });
      });
    },
  };
}


