(() => {
  const storeName = "images";
  const lifetime = 2 * 60 * 1000;

  async function supportedFormat(file) {
    const first = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const png = first.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => first[i] === byte);
    const jpeg = first[0] === 255 && first[1] === 216 && first[2] === 255;
    const webp = String.fromCharCode(...first.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...first.slice(8, 12)) === "WEBP";
    return png || jpeg || webp;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("screenshot-redactor-handoff", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName).createIndex("expiresAt", "expiresAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function useFiles(operation) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const files = transaction.objectStore(storeName);
        const expired = files.index("expiresAt").openKeyCursor(IDBKeyRange.upperBound(Date.now()));
        expired.onsuccess = () => {
          const cursor = expired.result;
          if (!cursor) return;
          files.delete(cursor.primaryKey);
          cursor.continue();
        };

        const request = operation(files);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  async function send(file) {
    const token = crypto.randomUUID();
    const image = file.slice(0, file.size, file.type);
    await useFiles(files => files.add({ image, expiresAt: Date.now() + lifetime }, token));
    return token;
  }

  async function take(token) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(token)) return null;
    // Reading and deleting in one transaction prevents two editor tabs opening the same handoff.
    const entry = await useFiles(files => {
      const request = files.get(token);
      request.onsuccess = () => {
        if (request.result) files.delete(token);
      };
      return request;
    });
    return entry?.expiresAt > Date.now() ? entry.image : null;
  }

  window.screenshotHandoff = { supportedFormat, send, take };
})();
