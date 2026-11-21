import { firebaseConfig } from "./firebase-config.mjs";

export async function connect() {
  const base = "https://www.gstatic.com/firebasejs/11.10.0/";
  const [app, auth, db, storage] = await Promise.all(
    ["app", "auth", "firestore", "storage"].map(name => import(base + "firebase-" + name + ".js"))
  );
  const instance = app.initializeApp(firebaseConfig);
  const session = auth.getAuth(instance);
  const database = db.getFirestore(instance);
  const bucket = storage.getStorage(instance);
  const profileRef = uid => db.doc(database, "profiles", uid);
  const slugRef = slug => db.doc(database, "galleries", slug);
  const photoList = uid => db.collection(database, "profiles", uid, "photos");
  const trashList = uid => db.collection(database, "profiles", uid, "trashedPhotos");

  return {
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
    async list(uid, published = false) {
      const photos = photoList(uid);
      const snapshot = await db.getDocs(published ? db.query(photos, db.where("visibility", "==", "public")) : photos);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      const doc = db.doc(photoList(uid));
      const object = storage.ref(bucket, "memories/" + uid + "/" + doc.id);
      const details = { region, created: Date.now(), date };
      await storage.uploadBytes(object, blob, { contentType: blob.type, cacheControl: "private, no-store" });
      try {
        await db.setDoc(doc, details);
      } catch (error) {
        await storage.deleteObject(object).catch(console.error);
        throw error;
      }
      return { id: doc.id, ...details, blob };
    },
    async photo(uid, id) {
      return storage.getBlob(storage.ref(bucket, "memories/" + uid + "/" + id), 5 * 1024 * 1024);
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


