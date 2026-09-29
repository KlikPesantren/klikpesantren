import assert from "node:assert/strict";
import {
  getWebsiteContentValue,
  hydrateWebsiteEditorContent,
  setWebsiteContentValue,
} from "../src/utils/websiteEditorHydration.js";

const defaults = {
  brand: {
    website_name: "KlikPesantren",
    tagline: "Fallback tagline",
    logo_url: "/landing/logo.png",
  },
  homepage: {
    hero: {
      title: "Fallback title",
      subtitle: "Fallback subtitle",
    },
  },
  sections: [{ title: "Fallback section" }],
  enabled: true,
};

const publishedPayload = {
  status: "published",
  published_content: {
    brand: {
      website_name: "Published Website",
      logo_url: "https://cdn.example.com/published.png",
    },
    homepage: { hero_title: "Published legacy title" },
  },
  content: {
    brand: {
      website_name: "Published Website",
      logo_url: "https://cdn.example.com/published.png",
    },
    homepage: { hero_title: "Published legacy title" },
  },
};

const published = hydrateWebsiteEditorContent(defaults, publishedPayload);
assert.equal(published.brand.website_name, "Published Website");
assert.equal(published.brand.tagline, "Fallback tagline");
assert.equal(published.brand.logo_url, "https://cdn.example.com/published.png");
assert.equal(published.homepage.hero.title, "Published legacy title");
assert.equal(typeof published.brand.website_name, "string");
assert.notEqual(published.brand.website_name, "[object Object]");

const draft = hydrateWebsiteEditorContent(defaults, {
  ...publishedPayload,
  status: "draft",
  content: {
    brand: {
      website_name: "Draft Website",
      logo_url: { url: "https://bad-wrapper.example.com/logo.png" },
    },
  },
});
assert.equal(draft.brand.website_name, "Draft Website");
assert.equal(draft.brand.logo_url, "https://cdn.example.com/published.png");
assert.equal(draft.brand.tagline, "Fallback tagline");
assert.equal(draft.enabled, true);
assert.deepEqual(draft.sections, defaults.sections);

const edited = setWebsiteContentValue(draft, "brand.tagline", "Updated tagline");
assert.equal(getWebsiteContentValue(edited, "brand.tagline"), "Updated tagline");
assert.equal(edited.brand.website_name, "Draft Website");
assert.equal(draft.brand.tagline, "Fallback tagline");

console.log("Platform Website Editor hydration regression: PASS");
