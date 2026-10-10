function productImageUrl(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048)
    throw Object.assign(Error("INVALID_PRODUCT_IMAGE"), {
      code: "INVALID_PRODUCT_IMAGE",
      status: 400,
    });
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(Error("INVALID_PRODUCT_IMAGE"), {
      code: "INVALID_PRODUCT_IMAGE",
      status: 400,
    });
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      host,
    ) ||
    host.startsWith("[") ||
    [...url.searchParams.keys()].some((key) =>
      /token|secret|password|signature|credential|api.?key/i.test(key),
    )
  )
    throw Object.assign(Error("INVALID_PRODUCT_IMAGE"), {
      code: "INVALID_PRODUCT_IMAGE",
      status: 400,
    });
  return url.href;
}
module.exports = { productImageUrl };
