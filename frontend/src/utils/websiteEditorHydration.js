function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, cloneValue(nestedValue)])
  );
}

function normalizeLegacyHomepage(source) {
  if (!isPlainObject(source)) return {};
  const normalized = cloneValue(source);
  const homepage = normalized.homepage;
  if (!isPlainObject(homepage)) return normalized;
  const hero = isPlainObject(homepage.hero) ? { ...homepage.hero } : {};
  const aliases = {
    hero_title: "title",
    hero_subtitle: "subtitle",
    primary_cta_label: "primary_cta_label",
    primary_cta_url: "primary_cta_url",
    secondary_cta_label: "secondary_cta_label",
    secondary_cta_url: "secondary_cta_url",
  };
  for (const [legacyKey, currentKey] of Object.entries(aliases)) {
    if (hero[currentKey] === undefined && typeof homepage[legacyKey] === "string") {
      hero[currentKey] = homepage[legacyKey];
    }
  }
  if (Object.keys(hero).length > 0) normalized.homepage = { ...homepage, hero };
  return normalized;
}

function mergeTypedValue(currentValue, candidateValue) {
  if (candidateValue === undefined || candidateValue === null) return cloneValue(currentValue);
  if (Array.isArray(currentValue)) {
    return Array.isArray(candidateValue) ? cloneValue(candidateValue) : cloneValue(currentValue);
  }
  if (isPlainObject(currentValue)) {
    if (!isPlainObject(candidateValue)) return cloneValue(currentValue);
    const merged = cloneValue(currentValue);
    for (const [key, candidateChild] of Object.entries(candidateValue)) {
      merged[key] = Object.prototype.hasOwnProperty.call(merged, key)
        ? mergeTypedValue(merged[key], candidateChild)
        : cloneValue(candidateChild);
    }
    return merged;
  }
  return typeof candidateValue === typeof currentValue ? candidateValue : currentValue;
}

export function mergeWebsiteContent(defaults, ...sources) {
  return sources.reduce(
    (merged, source) => mergeTypedValue(merged, normalizeLegacyHomepage(source)),
    cloneValue(defaults)
  );
}

export function hydrateWebsiteEditorContent(defaults, payload = {}) {
  const published = isPlainObject(payload.published_content) ? payload.published_content : {};
  const draft = isPlainObject(payload.content) ? payload.content : {};
  return mergeWebsiteContent(defaults, published, draft);
}

export function getWebsiteContentValue(content, path) {
  return path.split(".").reduce((value, key) => value?.[key], content);
}

export function setWebsiteContentValue(content, path, value) {
  const keys = path.split(".");
  const next = Array.isArray(content) ? [...content] : { ...content };
  let cursor = next;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    cursor[key] = Array.isArray(cursor[key])
      ? [...cursor[key]]
      : { ...(isPlainObject(cursor[key]) ? cursor[key] : {}) };
    cursor = cursor[key];
  });
  return next;
}
