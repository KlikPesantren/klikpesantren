const mode = process.env.POS_ENV || "development";
const review = process.env.POS_REVIEW === "1";
const acceptance = process.env.EXPO_PUBLIC_POS_ACCEPTANCE === "1";
if (acceptance !== (mode === "acceptance"))
  throw new Error(
    "Acceptance requires isolated environment and explicit build flag",
  );
if (review && !["development", "acceptance"].includes(mode))
  throw new Error("POS review is development-only");
if (mode === "acceptance" && !review)
  throw new Error("Acceptance requires synthetic review adapter");
const api =
  process.env.EXPO_PUBLIC_POS_API_URL ||
  (mode === "acceptance"
    ? "https://pos-acceptance.invalid"
    : mode === "production"
      ? "https://api.klikpesantren.com"
      : "http://127.0.0.1:3000");
if (mode === "acceptance" && api !== "https://pos-acceptance.invalid")
  throw new Error("Acceptance cannot target a real API");
const url = new URL(api);
if (!["development", "staging", "production", "acceptance"].includes(mode))
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
    name: "Suq Shogir",
    slug: "klikpesantren-pos",
    owner: "kliksantridemo",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    icon: "./assets/suq-shogir-icon.png",
    splash: {
      image: "./assets/suq-shogir-splash.png",
      resizeMode: "contain",
      backgroundColor: "#0E5A37",
    },
    android: {
      package: "com.klikpesantren.pos",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/suq-shogir-adaptive-foreground.png",
        backgroundColor: "#0E5A37",
      },
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_IMAGES",
      ],
    },
    plugins: ["expo-secure-store"],
    extra: {
      posEnvironment: mode,
      apiUrl: api,
      posReview: review,
      eas: { projectId: "28970813-9740-42d8-a81d-e762ca36d66c" },
    },
    web: { bundler: "metro" },
  },
};
