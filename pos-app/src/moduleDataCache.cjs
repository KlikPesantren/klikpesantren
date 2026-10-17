"use strict";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 8;

function authorityKey(context, businessId) {
  if (!context || !businessId) return "";
  const permissions = [...(context.permissions || [])].sort().join(",");
  return [businessId, context.user_id || "", context.role || "", permissions].join("|");
}

function createModuleDataCache({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
  const entries = new Map();
  const cacheKey = (authority, module) => `${authority}::${module}`;
  const prune = () => {
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  };
  return {
    get(authority, module) {
      if (!authority) return null;
      const key = cacheKey(authority, module), entry = entries.get(key);
      if (!entry || now() - entry.savedAt > ttlMs) { entries.delete(key); return null; }
      entries.delete(key); entries.set(key, entry);
      return entry.value;
    },
    set(authority, module, value) {
      if (!authority) return;
      const key = cacheKey(authority, module);
      entries.delete(key); entries.set(key, { savedAt: now(), value }); prune();
    },
    invalidate(authority) {
      for (const key of entries.keys()) if (!authority || key.startsWith(`${authority}::`)) entries.delete(key);
    },
    clear() { entries.clear(); },
    size() { return entries.size; },
  };
}

function boundedRows(rows, limit) {
  const safe = Array.isArray(rows) ? rows : [];
  const bounded = Math.max(1, Number(limit) || 1);
  return { visible: safe.slice(0, bounded), total: safe.length, hasMore: safe.length > bounded };
}

module.exports = { authorityKey, boundedRows, createModuleDataCache, DEFAULT_TTL_MS, DEFAULT_MAX_ENTRIES };
