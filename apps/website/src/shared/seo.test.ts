import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { staticPricingPlans } from "./pricing";
import {
  absoluteUrl,
  homeStructuredData,
  PAGE_SEO,
  PUBLIC_SEO_PAGES,
  seoPageForPath,
  structuredDataForPage,
} from "./seo";

const publicDir = resolve(import.meta.dirname, "../../public");

describe("SEO metadata", () => {
  it("gives every public page unique indexable metadata and an absolute canonical", () => {
    const pages = PUBLIC_SEO_PAGES.map((page) => PAGE_SEO[page]);
    expect(new Set(pages.map((page) => page.path)).size).toBe(pages.length);
    expect(new Set(pages.map((page) => page.title)).size).toBe(pages.length);
    expect(new Set(pages.map((page) => page.description)).size).toBe(pages.length);

    for (const page of pages) {
      expect(page.index).toBe(true);
      expect(absoluteUrl(page.path)).toMatch(/^https:\/\/sietch\.sole-pierce\.ts\.net:8443\//);
    }
  });

  it("resolves direct and trailing-slash routes without treating unknown paths as pages", () => {
    expect(seoPageForPath("/")).toBe("home");
    expect(seoPageForPath("/docs/")).toBe("docs");
    expect(seoPageForPath("/a/launched/")).toBe("launched");
    expect(seoPageForPath("/dashboard")).toBe("dashboard");
    expect(seoPageForPath("/missing")).toBeNull();
  });

  it("publishes factual, parseable home-page entities", () => {
    const data = homeStructuredData();
    const json = JSON.stringify(data);
    expect(JSON.parse(json)).toEqual(data);
    expect(json).toContain('"SoftwareApplication"');
    expect(json).toContain('"operatingSystem":"Android"');
    expect(json).toContain('"price":"0"');
    expect(json).not.toContain("apps.apple.com");
  });

  it("adds breadcrumbs to indexable child pages without marking private pages up", () => {
    expect(JSON.stringify(structuredDataForPage("docs"))).toContain('"BreadcrumbList"');
    expect(structuredDataForPage("dashboard")).toBeNull();
  });

  it("publishes the Android information page without stale launch metadata", () => {
    const data = structuredDataForPage("launched");
    const json = JSON.stringify(data);
    expect(json).toContain('"@type":"WebPage"');
    expect(json).not.toContain('"@type":"Article"');
    expect(json).not.toContain("datePublished");
  });

  it("uses the same public pricing facts in the fallback catalog", () => {
    const plans = staticPricingPlans().plans;
    expect(plans.map((plan) => [plan.name, plan.priceMonthly])).toEqual([["Self-hosted", 0]]);
  });
});

describe("crawler files", () => {
  it("publishes a sitemap containing only canonical public HTML pages", async () => {
    const sitemap = await readFile(resolve(publicDir, "sitemap.xml"), "utf8");
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locations).toEqual(PUBLIC_SEO_PAGES.map((page) => absoluteUrl(PAGE_SEO[page].path)));
    expect(sitemap).not.toContain("<video:video>");
  });

  it("points crawlers to the sitemap without hiding pages that carry noindex", async () => {
    const robots = await readFile(resolve(publicDir, "robots.txt"), "utf8");
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Sitemap: https://sietch.sole-pierce.ts.net:8443/sitemap.xml");
    expect(robots).not.toContain("Disallow: /dashboard");
    expect(robots).not.toContain("Disallow: /cli/authorize");
  });
});
