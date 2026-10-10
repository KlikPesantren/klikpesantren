import { useEffect } from "react";

const siteUrl = "https://klikpesantren.com";
const siteName = "KlikPesantren";
const defaultImage = `${siteUrl}/landing/dashboard-admin.png`;
const defaultDescription =
  "KlikPesantren adalah platform SaaS untuk administrasi santri, keuangan pesantren, RFID, Wali Santri App, perizinan, pelanggaran, dashboard, dan multi tenant.";

function ensureMeta(selector, attributes) {
  let element = document.head.querySelector(selector);

  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
}

function ensureLink(selector, attributes) {
  let element = document.head.querySelector(selector);

  if (!element) {
    element = document.createElement("link");
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
}

function ensureJsonLd(id, data) {
  let element = document.head.querySelector(`#${id}`);

  if (!element) {
    element = document.createElement("script");
    element.id = id;
    element.type = "application/ld+json";
    document.head.appendChild(element);
  }

  element.textContent = JSON.stringify(data);
}

export function buildCanonical(path = "/", baseUrl = siteUrl) {
  const normalizedBase = String(baseUrl || siteUrl).replace(/\/$/, "");
  if (path === "/") return `${normalizedBase}/`;
  return `${normalizedBase}${path}`;
}

export function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: buildCanonical(item.path),
    })),
  };
}

export const homepageJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteName,
    url: buildCanonical("/"),
    logo: `${siteUrl}/landing/logo.png`,
    email: "hello@klikpesantren.com",
    sameAs: ["https://instagram.com/klikpesantren"],
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteName,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, Android",
    url: buildCanonical("/"),
    image: defaultImage,
    description: defaultDescription,
    brand: {
      "@type": "Brand",
      name: siteName,
      slogan: "Satu Klik, Semua Terhubung.",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: buildCanonical("/"),
    inLanguage: "id-ID",
    publisher: {
      "@type": "Organization",
      name: siteName,
    },
  },
];

export default function Seo({
  title,
  description = defaultDescription,
  path = "/",
  image = defaultImage,
  imageAlt = "Dashboard admin KlikPesantren",
  jsonLd,
  canonicalBaseUrl = siteUrl,
}) {
  useEffect(() => {
    const canonical = buildCanonical(path, canonicalBaseUrl);

    document.title = title;
    ensureMeta('meta[name="description"]', {
      name: "description",
      content: description,
    });
    ensureLink('link[rel="canonical"]', {
      rel: "canonical",
      href: canonical,
    });

    ensureMeta('meta[property="og:type"]', {
      property: "og:type",
      content: "website",
    });
    ensureMeta('meta[property="og:locale"]', {
      property: "og:locale",
      content: "id_ID",
    });
    ensureMeta('meta[property="og:site_name"]', {
      property: "og:site_name",
      content: siteName,
    });
    ensureMeta('meta[property="og:title"]', {
      property: "og:title",
      content: title,
    });
    ensureMeta('meta[property="og:description"]', {
      property: "og:description",
      content: description,
    });
    ensureMeta('meta[property="og:url"]', {
      property: "og:url",
      content: canonical,
    });
    ensureMeta('meta[property="og:image"]', {
      property: "og:image",
      content: image,
    });
    ensureMeta('meta[property="og:image:alt"]', {
      property: "og:image:alt",
      content: imageAlt,
    });

    ensureMeta('meta[name="twitter:card"]', {
      name: "twitter:card",
      content: "summary_large_image",
    });
    ensureMeta('meta[name="twitter:title"]', {
      name: "twitter:title",
      content: title,
    });
    ensureMeta('meta[name="twitter:description"]', {
      name: "twitter:description",
      content: description,
    });
    ensureMeta('meta[name="twitter:image"]', {
      name: "twitter:image",
      content: image,
    });

    if (jsonLd) {
      ensureJsonLd("kp-route-jsonld", jsonLd);
    }
  }, [canonicalBaseUrl, description, image, imageAlt, jsonLd, path, title]);

  return null;
}
