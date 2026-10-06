const mode = process.env.POS_ENV || "development";
const review = process.env.POS_REVIEW === "1";
if (review && mode !== "development")
  throw new Error("POS review is development-only");
const api =
  process.env.EXPO_PUBLIC_POS_API_URL ||
  (mode === "production"
    ? "https://api.klikpesantren.com"
    : "http://127.0.0.1:3000");
const url = new URL(api);
if (!["development", "staging", "production"].includes(mode))
  throw new Error("Invalid POS environment");
if (mode !== "development" && url.protocol !== "https:")
  throw new Error("POS requires HTTPS");
if (url.username || url.password || url.search || url.hash)
  throw new Error("Credential-free API base required");
if (
  url.protocol !== "https:" &&
  !["127.0.0.1", "localhost", "10.0.2.2"].includes(url.hostname)
)
  throw new Error("Local HTTP only");
module.exports = {
  expo: {
    name: "POS KlikPesantren",
    slug: "klikpesantren-pos",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    android: {
      package: "com.klikpesantren.pos",
      versionCode: 1,
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_IMAGES",
      ],
    },
    plugins: ["expo-secure-store"],
    extra: { posEnvironment: mode, apiUrl: api, posReview: review },
    web: { bundler: "metro" },
  },
};
