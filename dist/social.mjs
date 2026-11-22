export function gallerySocial(db, database, session) {
  const stats = uid => db.doc(database, "gallerySocial", uid);
  const member = (uid, kind, actor) => db.doc(database, "gallerySocial", uid, kind, actor);
  const messages = uid => db.collection(database, "gallerySocial", uid, "messages");
  const empty = { views: 0, likes: 0, comments: 0, lastComment: "" };

  async function change(uid, kind, desired, text) {
    const account = session.currentUser;
    if (!account) throw new Error("Masuk dahulu.");
    const photoMap = stats(uid);
    const event = kind === "comments" ? db.doc(messages(uid)) : member(uid, kind, account.uid);
    const name = kind === "comments" ? (await account.getIdTokenResult()).claims.name ?? "Pengunjung" : "";
    return db.runTransaction(database, async tx => {
      const current = { ...empty, ...(await tx.get(photoMap)).data() };
      if (kind !== "comments") {
        const exists = (await tx.get(event)).exists();
        if (exists === desired) return;
        if (desired) tx.set(event, { createdAt: db.serverTimestamp() });
        else tx.delete(event);
      } else {
        tx.set(event, { author: account.uid, name, text, createdAt: db.serverTimestamp() });
        current.lastComment = event.id;
      }
      current[kind] += desired ? 1 : -1;
      tx.set(photoMap, current);
    });
  }

  return {
    view: uid => change(uid, "views", true),
    like: (uid, desired) => change(uid, "likes", desired),
    comment: (uid, text) => change(uid, "comments", true, text),
    watch(uid, actor, render, onError) {
      const stop = [
        db.onSnapshot(stats(uid), snapshot => render({ totals: snapshot.data() ?? empty }), onError),
        db.onSnapshot(member(uid, "likes", actor), snapshot => render({ liked: snapshot.exists() }), onError),
        db.onSnapshot(db.query(messages(uid), db.orderBy("createdAt", "desc"), db.limit(20)),
          snapshot => render({ messages: snapshot.docs.map(doc => doc.data()) }), onError),
      ];
      return () => stop.forEach(unsubscribe => unsubscribe());
    },
  };
}
