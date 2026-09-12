/** Prerenders public pages and writes noindex shells for private application routes. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { App } from "../src/client/App";
import {
  absoluteUrl,
  PAGE_SEO,
  PRIVATE_SEO_PAGES,
  PUBLIC_SEO_PAGES,
  type SeoPage,
  structuredDataForPage,
} from "../src/shared/seo";

const clientDir = resolve(import.meta.dirname, "../dist/client");
const shellPath = resolve(clientDir, "index.html");
const shell = await readFile(shellPath, "utf8");
if (!shell.includes('<div id="root"></div>')) {
  throw new Error("Cannot prerender public pages: dist/client/index.html has no empty #root div");
}
if (!/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/.test(shell)) {
  throw new Error("Cannot write page metadata: dist/client/index.html has no SEO marker block");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function seoHead(page: SeoPage): string {
  const seo = PAGE_SEO[page];
  const canonical = absoluteUrl(seo.path);
  const robots = seo.index
    ? "index, follow, max-image-preview:large, max-video-preview:-1"
    : "noindex, nofollow";
  const title = escapeAttribute(seo.title);
  const description = escapeAttribute(seo.description);
  const structuredData = structuredDataForPage(page);
  const lines = [
    "<!-- seo:start -->",
    `    <title data-seo="true">${title}</title>`,
    `    <meta data-seo="true" name="description" content="${description}" />`,
    `    <meta data-seo="true" name="robots" content="${robots}" />`,
    '    <meta data-seo="true" name="application-name" content="Hark" />',
    `    <link data-seo="true" rel="canonical" href="${canonical}" />`,
    `    <meta data-seo="true" property="og:type" content="${seo.type ?? "website"}" />`,
    '    <meta data-seo="true" property="og:site_name" content="Hark" />',
    '    <meta data-seo="true" property="og:locale" content="en_US" />',
    `    <meta data-seo="true" property="og:title" content="${title}" />`,
    `    <meta data-seo="true" property="og:description" content="${description}" />`,
    `    <meta data-seo="true" property="og:url" content="${canonical}" />`,
    '    <meta data-seo="true" name="twitter:card" content="summary" />',
    `    <meta data-seo="true" name="twitter:title" content="${title}" />`,
    `    <meta data-seo="true" name="twitter:description" content="${description}" />`,
  ];

  if (seo.type === "article" && seo.publishedTime) {
    lines.push(
      `    <meta data-seo="true" property="article:published_time" content="${seo.publishedTime}" />`,
      `    <meta data-seo="true" property="article:modified_time" content="${seo.modifiedTime ?? seo.publishedTime}" />`,
    );
  }

  if (seo.markdownAlternate) {
    lines.push(
      `    <link data-seo="true" rel="alternate" type="text/markdown" href="${seo.markdownAlternate}" />`,
    );
  }

  if (structuredData) {
    const json = JSON.stringify(structuredData).replaceAll("<", "\\u003c");
    lines.push(`    <script data-seo="true" type="application/ld+json">${json}</script>`);
  }
  lines.push("    <!-- seo:end -->");
  return lines.join("\n");
}

function renderPage(page: SeoPage, prerender: boolean): string {
  const seo = PAGE_SEO[page];
  const markup = prerender
    ? renderToString(
        <StrictMode>
          <StaticRouter location={seo.path}>
            <App />
          </StaticRouter>
        </StrictMode>,
      )
    : "";

  return shell
    .replace('<div id="root"></div>', `<div id="root">${markup}</div>`)
    .replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, seoHead(page));
}

for (const page of PUBLIC_SEO_PAGES) {
  const seo = PAGE_SEO[page];
  const outputPath =
    seo.path === "/" ? shellPath : resolve(clientDir, seo.path.slice(1), "index.html");
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  const html = renderPage(page, true);
  await writeFile(outputPath, html);
  console.log(`prerendered ${seo.path} → ${outputPath} (${html.length} bytes)`);
}

for (const page of PRIVATE_SEO_PAGES) {
  const seo = PAGE_SEO[page];
  const outputPath = resolve(clientDir, seo.path.slice(1), "index.html");
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  const html = renderPage(page, false);
  await writeFile(outputPath, html);
  console.log(`wrote noindex shell ${seo.path} → ${outputPath}`);
}
