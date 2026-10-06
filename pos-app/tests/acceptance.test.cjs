const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const configPath = require.resolve("../app.config.js");
function config(env) {
  const keys = [
    "POS_ENV",
    "POS_REVIEW",
    "EXPO_PUBLIC_POS_ACCEPTANCE",
    "EXPO_PUBLIC_POS_API_URL",
  ];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    delete require.cache[configPath];
    return require(configPath).expo;
  } finally {
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
    delete require.cache[configPath];
  }
}
const env = {
  POS_ENV: "acceptance",
  POS_REVIEW: "1",
  EXPO_PUBLIC_POS_ACCEPTANCE: "1",
  EXPO_PUBLIC_POS_API_URL: "https://pos-acceptance.invalid",
};
test("standalone acceptance identity and profile are isolated; no real API or production flag", () => {
  const c = config(env);
  assert.equal(c.name, "POS KlikPesantren");
  assert.equal(c.android.package, "com.klikpesantren.pos");
  assert.equal(c.extra.apiUrl, env.EXPO_PUBLIC_POS_API_URL);
  assert.throws(() => config({ ...env, POS_ENV: "production" }));
  assert.throws(() => config({ ...env, POS_REVIEW: "0" }));
  assert.throws(() => config({ ...env, EXPO_PUBLIC_POS_ACCEPTANCE: "0" }));
  assert.throws(() =>
    config({
      ...env,
      EXPO_PUBLIC_POS_API_URL: "https://api.klikpesantren.com",
    }),
  );
  const p = config({ POS_ENV: "production" });
  assert.equal(p.extra.posReview, false);
  assert.equal(p.extra.apiUrl, "https://api.klikpesantren.com");
  const profile = require("../eas.json").build.acceptance;
  assert.equal(profile.android.buildType, "apk");
  assert.equal(profile.developmentClient, false);
  assert.equal(profile.distribution, "internal");
  assert.deepEqual(profile.env, env);
});
test("acceptance makeApi rejects before fetch even if fixture adapter is not selected", async () => {
  const source = fs
    .readFileSync(require.resolve("../src/api.js"), "utf8")
    .replace('import Constants from "expo-constants";', "")
    .replace("export function makeApi", "function makeApi");
  let calls = 0;
  const makeApi = new Function(
    "Constants",
    "fetch",
    source + ";return makeApi;",
  )(
    {
      expoConfig: {
        extra: {
          apiUrl: env.EXPO_PUBLIC_POS_API_URL,
          posEnvironment: "acceptance",
        },
      },
    },
    () => {
      calls++;
      throw Error("UNEXPECTED_NETWORK");
    },
  );
  for (const method of ["GET", "POST", "PATCH", "DELETE"])
    await assert.rejects(() => makeApi(null)("/pos/checkout", { method }), {
      code: "REVIEW_NETWORK_DISABLED",
    });
  assert.equal(calls, 0);
});
