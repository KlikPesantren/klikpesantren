// Chunked SecureStore journal: keep each native value below 2KB. Manifest last.
// No UID/token/payload is persisted in AsyncStorage or browser localStorage.
function createVault(store) {
  const prefix = "kp.pos.";
  return {
    async read(key) {
      const manifest = await store.getItemAsync(prefix + key);
      if (!manifest) return null;
      const m = JSON.parse(manifest);
      if (
        m.phase !== "READY" ||
        !Number.isInteger(m.count) ||
        m.count < 1 ||
        m.count > 160
      )
        throw Error("VAULT_CORRUPT");
      const chunks = [];
      for (let i = 0; i < m.count; i++) {
        const chunk = await store.getItemAsync(`${prefix}${key}.${i}`);
        if (chunk == null) throw Error("VAULT_CORRUPT");
        chunks.push(chunk);
      }
      return JSON.parse(chunks.join(""));
    },
    async write(key, value) {
      if (await store.getItemAsync(prefix + key)) throw Error("VAULT_EXISTS");
      const text = JSON.stringify(value),
        chunks = []; // UTF-16 slices 400 chars <= 1600 UTF-8 bytes.
      for (let i = 0; i < text.length; i += 400)
        chunks.push(text.slice(i, i + 400));
      if (chunks.length > 160) throw Error("PAYLOAD_TOO_LARGE");
      // Record cleanup extent BEFORE any sensitive chunk. Interrupted writes
      // fail closed and remain fully erasable on logout; no orphan secrets.
      await store.setItemAsync(
        prefix + key,
        JSON.stringify({ count: chunks.length, phase: "PREPARING" }),
      );
      for (let i = 0; i < chunks.length; i++)
        await store.setItemAsync(`${prefix}${key}.${i}`, chunks[i]);
      await store.setItemAsync(
        prefix + key,
        JSON.stringify({ count: chunks.length, phase: "READY" }),
      );
    },
    async remove(key) {
      const text = await store.getItemAsync(prefix + key);
      if (text) {
        const m = JSON.parse(text);
        // Erase chunks first: if interrupted, journal fails closed rather than enabling a new checkout.
        for (let i = 0; i < m.count; i++)
          await store.deleteItemAsync(`${prefix}${key}.${i}`);
        await store.deleteItemAsync(prefix + key);
      }
    },
  };
}
module.exports = { createVault };
