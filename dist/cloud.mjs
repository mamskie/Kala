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

  return {
    subscribe: onUser => auth.onAuthStateChanged(session, onUser),
    login: () => auth.signInWithPopup(session, new auth.GoogleAuthProvider()),
    logout: () => auth.signOut(session),
    async profile(uid) {
      return (await db.getDoc(profileRef(uid))).data();
    },
    async gallery(slug) {
      return (await db.getDoc(slugRef(slug))).data()?.uid;
    },
    async list(uid) {
      const snapshot = await db.getDocs(photoList(uid));
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    async save(uid, region, blob) {
      const doc = db.doc(photoList(uid));
      const object = storage.ref(bucket, "memories/" + uid + "/" + doc.id);
      await storage.uploadBytes(object, blob, { contentType: blob.type, cacheControl: "private, no-store" });
      try {
        await db.setDoc(doc, { region, created: Date.now() });
      } catch (error) {
        await storage.deleteObject(object).catch(console.error);
        throw error;
      }
      return { id: doc.id, region, created: Date.now(), blob };
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


