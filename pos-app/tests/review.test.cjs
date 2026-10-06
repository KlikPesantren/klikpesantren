const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createReviewAdapter } = require("../src/reviewFixtures.cjs");
test("review reads synthetic context and all five screen projections without network", async () => {
  const adapter = createReviewAdapter();
  const original = global.fetch;
  global.fetch = () => {
    throw Error("NETWORK_FORBIDDEN");
  };
  try {
    for (const route of [
      "/pos/mobile/context",
      "/pos/mobile/summary",
      "/pos/mobile/catalog",
      "/pos/mobile/transactions",
      "/pos/mobile/transactions/review-0",
      "/pos/mobile/credential-preview",
    ])
      assert.ok(await adapter.api(route));
    for (const route of [
      "/auth/login",
      "/pos/checkout",
      "/pos/refunds",
      "/pos/shifts",
      "https://api.klikpesantren.com",
    ])
      await assert.rejects(adapter.api(route), {
        code: "REVIEW_WRITE_DISABLED",
      });
  } finally {
    global.fetch = original;
  }
});
test("review states empty, offline, error and closed shift are deterministic", async () => {
  const adapter = createReviewAdapter();
  adapter.setState("empty");
  assert.deepEqual((await adapter.api("/pos/mobile/catalog")).products, []);
  adapter.setState("offline");
  await assert.rejects(adapter.api("/pos/mobile/catalog"), { code: "NETWORK" });
  adapter.setState("error");
  await assert.rejects(adapter.api("/pos/mobile/catalog"), { status: 403 });
  adapter.setState("shift closed");
  assert.equal(adapter.summary().shift, null);
  assert.throws(() => adapter.setState("unknown-state"));
});
test("review requires both development runtime and explicit opt-in; production rejects opt-in", () => {
  const app = fs.readFileSync(path.join(__dirname, "../App.js"), "utf8");
  assert.match(app, /__DEV__\s*&&/);
  assert.match(app, /posEnvironment\s*===\s*["']development["']/);
  assert.match(app, /posReview\s*===\s*true/);
  const previous = {
    POS_ENV: process.env.POS_ENV,
    POS_REVIEW: process.env.POS_REVIEW,
  };
  const configPath = require.resolve("../app.config.js");
  try {
    process.env.POS_ENV = "production";
    process.env.POS_REVIEW = "1";
    delete require.cache[configPath];
    assert.throws(() => require(configPath), /development-only/);
    process.env.POS_REVIEW = "0";
    delete require.cache[configPath];
    assert.equal(require(configPath).expo.extra.posReview, false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[configPath];
  }
});
