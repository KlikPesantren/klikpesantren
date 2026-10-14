function createSaleJournal({ vault, key = "merchant-sale", send }) {
  const failure = code => Object.assign(Error(code), { code });
  async function read() { return vault.read(key); }
  async function submit(payload, authority) {
    let pending = await read();
    if (pending && payload) throw failure("PENDING_SALE_REQUIRES_RETRY");
    if (!pending) {
      if (!payload?.request_id || !authority?.business_id || !authority?.user_id) throw failure("INVALID_SALE");
      pending = { business_id: authority.business_id, user_id: authority.user_id, payload };
      await vault.write(key, pending);
    }
    if (pending.business_id !== authority.business_id || pending.user_id !== authority.user_id)
      throw failure("PENDING_SALE_AUTHORITY_MISMATCH");
    try {
      const result = await send(pending.payload);
      await vault.remove(key);
      return result;
    } catch (error) {
      // A definitive business rejection committed nothing. Unknown network/5xx
      // state keeps the immutable request for an exact retry.
      if (error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status))
        await vault.remove(key);
      throw error;
    }
  }
  return { read, submit };
}
module.exports = { createSaleJournal };
