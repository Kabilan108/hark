export const SITE_URL = "https://sietch.sole-pierce.ts.net:8443";

export type SeoPage =
  | "home"
  | "docs"
  | "pricing"
  | "launched"
  | "privacy"
  | "terms"
  | "dashboard"
  | "cliAuthorize";

export interface PageSeo {
  path: string;
  title: string;
  description: string;
  index: boolean;
  markdownAlternate?: string;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
}

export const PAGE_SEO: Record<SeoPage, PageSeo> = {
  home: {
    path: "/",
    title: "Hark — Self-hosted Android Notifications",
    description:
      "Send Android notifications, approvals, replies, and live progress updates from webhooks and coding agents through your own Hark server.",
    index: true,
  },
  docs: {
    path: "/docs",
    title: "Hark API Docs — Android Notifications and Live Updates",
    description:
      "Use the Hark webhook API and CLI to send Android notifications, request approvals or replies, and update ongoing tasks through direct FCM delivery.",
    index: true,
    markdownAlternate: `${SITE_URL}/docs.md`,
  },
  pricing: {
    path: "/pricing",
    title: "Hark Pricing — Self-hosted Android Notifications",
    description:
      "Self-host Hark with Android notifications, device routing, interactive responses, callbacks, and Live Updates included.",
    index: true,
  },
  launched: {
    path: "/a/launched",
    title: "Hark for Android — Self-hosted Notifications",
    description:
      "Run Hark's Android app with your own Node and SQLite backend and direct Firebase Cloud Messaging delivery.",
    index: true,
  },
  privacy: {
    path: "/privacy",
    title: "Privacy Policy — Hark",
    description:
      "How a self-hosted Hark deployment processes account, webhook, notification, device, interaction, and Live Update information.",
    index: true,
  },
  terms: {
    path: "/terms",
    title: "Terms of Service — Hark",
    description:
      "The terms governing a self-hosted Hark deployment, webhook notifications, and agent interactions.",
    index: true,
  },
  dashboard: {
    path: "/dashboard",
    title: "Dashboard — Hark",
    description: "Manage your private Hark services, devices, activity, and agent connections.",
    index: false,
  },
  cliAuthorize: {
    path: "/cli/authorize",
    title: "Authorize Hark CLI",
    description: "Review and authorize a Hark CLI connection.",
    index: false,
  },
};

export const PUBLIC_SEO_PAGES = [
  "home",
  "docs",
  "pricing",
  "launched",
  "privacy",
  "terms",
] as const;
export const PRIVATE_SEO_PAGES = ["dashboard", "cliAuthorize"] as const;

export function absoluteUrl(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

export function seoPageForPath(pathname: string): SeoPage | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const [page, seo] of Object.entries(PAGE_SEO) as [SeoPage, PageSeo][]) {
    if (seo.path === normalized) return page;
  }
  return null;
}

const provider = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#provider`,
  name: "Hark deployment",
  url: SITE_URL,
};

/** Factual entities visible on the home page. Avoids ratings, reviews, and unsupported claims. */
export function homeStructuredData(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      provider,
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: "Hark",
        description: PAGE_SEO.home.description,
        inLanguage: "en-US",
        publisher: { "@id": `${SITE_URL}/#provider` },
      },
      {
        "@type": ["SoftwareApplication", "MobileApplication"],
        "@id": `${SITE_URL}/#app`,
        name: "Hark",
        alternateName: "Hark for Android",
        url: `${SITE_URL}/`,
        description: PAGE_SEO.home.description,
        applicationCategory: "CommunicationApplication",
        operatingSystem: "Android",
        softwareHelp: `${SITE_URL}/docs`,
        provider: { "@id": `${SITE_URL}/#provider` },
        featureList: [
          "Webhook to Android notifications",
          "Agent approval and text reply requests",
          "Ongoing progress notifications and supported Android Live Updates",
          "Scoped CLI access tokens",
        ],
        offers: [
          {
            "@type": "Offer",
            name: "Hark self-hosted",
            price: "0",
            priceCurrency: "USD",
            url: `${SITE_URL}/pricing`,
          },
        ],
      },
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/#webpage`,
        url: `${SITE_URL}/`,
        name: PAGE_SEO.home.title,
        description: PAGE_SEO.home.description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        mainEntity: { "@id": `${SITE_URL}/#app` },
        inLanguage: "en-US",
      },
    ],
  };
}

export function structuredDataForPage(page: SeoPage): Record<string, unknown> | null {
  if (page === "home") return homeStructuredData();

  const seo = PAGE_SEO[page];
  if (!seo.index) return null;
  const url = absoluteUrl(seo.path);
  const article = seo.type === "article";
  const graph: Record<string, unknown>[] = [];
  if (article) graph.push(provider);
  graph.push(
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: seo.title,
      description: seo.description,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      breadcrumb: { "@id": `${url}#breadcrumb` },
      ...(article ? { mainEntity: { "@id": `${url}#article` } } : {}),
      inLanguage: "en-US",
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Hark",
          item: `${SITE_URL}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: seo.title.replace(/\s+[—-]\s+Hark$/, ""),
          item: url,
        },
      ],
    },
  );
  if (article) {
    graph.push({
      "@type": "Article",
      "@id": `${url}#article`,
      headline: seo.title,
      description: seo.description,
      url,
      mainEntityOfPage: { "@id": `${url}#webpage` },
      author: { "@id": `${SITE_URL}/#provider` },
      publisher: { "@id": `${SITE_URL}/#provider` },
      datePublished: seo.publishedTime,
      dateModified: seo.modifiedTime ?? seo.publishedTime,
      inLanguage: "en-US",
    });
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}
