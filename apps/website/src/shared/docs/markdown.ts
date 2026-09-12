/**
 * Serialises the docs content model to markdown for `/docs.md` and `/agents.md`,
 * and writes the `/llms.txt` pointer file.
 *
 * There is no prose in this module: every sentence comes from `./content.ts` and
 * every heading from `./nav.ts`, which is what keeps the markdown and the HTML
 * page from drifting.
 */
import {
  DOC_CONTENT,
  DOCS_MARKDOWN_URL,
  DOCS_TITLE,
  DOCS_URL,
  type DocBlock,
  type DocTableBlock,
} from "./content";
import { docLabel } from "./nav";

/** Pipe tables cannot contain a raw `|` or a newline. */
function cell(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replaceAll("|", "\\|");
}

function table(headers: string[], rows: string[][]): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function tableBlock(block: DocTableBlock): string {
  switch (block.variant) {
    case "field":
      return table(
        ["Field", "Type", "Description"],
        block.rows.map((row) => [`\`${row.name}\``, row.type, row.detail]),
      );
    case "flag":
      return table(
        ["Flag", "Type", "Description"],
        block.rows.map((row) => [`\`${row.name}\``, row.type, row.detail]),
      );
    case "route":
      return table(
        ["Route", "Purpose"],
        block.rows.map((row) => [`\`${row.method} ${row.path}\``, row.detail]),
      );
    case "plan":
      return table(
        ["Limit", "Free", "Pro"],
        block.rows.map((row) => [row.limit, row.free, row.pro]),
      );
  }
}

function blockToMarkdown(block: DocBlock): string {
  switch (block.kind) {
    case "p":
      return block.text;
    case "note":
      return `> ${block.text}`;
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    case "bullets":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "code":
      return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
    case "copy":
      return `${block.label}:\n\n\`\`\`text\n${block.value}\n\`\`\``;
    case "stylePreviews":
      return block.styles.map((style) => `- \`${style.name}\` — ${style.description}`).join("\n");
    case "table":
      return tableBlock(block);
  }
}

/** The full documentation as markdown, mirroring the `/docs` page exactly. */
export function docsMarkdown(): string {
  const parts: string[] = [
    `# Hark — ${DOCS_TITLE}`,
    `Hark documentation. HTML version: ${DOCS_URL}`,
  ];

  for (const section of DOC_CONTENT) {
    parts.push(`## ${docLabel(section.id)}`);
    parts.push(section.lead);

    for (const subsection of section.subsections) {
      parts.push(`### ${docLabel(subsection.id)}`);
      for (const block of subsection.blocks) parts.push(blockToMarkdown(block));
    }
  }

  return `${parts.join("\n\n")}\n`;
}

/** The /llms.txt pointer file: what Hark is, and where the docs live. */
export function llmsTxt(): string {
  return `# Hark

> Hark turns an HTTP request into an Android notification. Create a service in the dashboard, then
> POST JSON to its secret webhook URL. The Notification API sends one-shot pushes and optional
> response prompts. The Activity API drives an ongoing progress notification and requests promoted
> Live Update treatment on supported Android devices.

## Docs

- [Documentation](${DOCS_URL}): ${DOCS_TITLE} — quickstart, Notification API, Activity API, CLI, and coding-agent permissions.
- [Documentation as markdown](${DOCS_MARKDOWN_URL}): the same content as plain markdown.
- [Agent documentation](https://sietch.sole-pierce.ts.net:8443/agents.md): agent-oriented alias of the complete Markdown docs.
- [Coding-agent permission setup](https://sietch.sole-pierce.ts.net:8443/docs#cli-permissions): Claude Code, Codex, OpenCode V1, and OpenCode V2.

## Product

- [Home](https://sietch.sole-pierce.ts.net:8443/): product overview and webhook example.
- [Pricing](https://sietch.sole-pierce.ts.net:8443/pricing): self-hosting requirements and included features.

## Agent tools

- \`node packages/harkctl/bin/harkctl.mjs\`: run the CLI from this fork for notifications, approvals, replies, Activity API updates, and webhook services.

## Notes

- Webhook API requests are authenticated by the token in the URL; harkctl uses a scoped agent token. Treat both as credentials.
- Self-hosted mode enables device targeting, interactive responses, callbacks, and the Activity API for every account.
- Hark sends data-only messages directly through FCM. Provider acceptance does not prove that Android displayed a notification.
- Set \`HARK_API_URL\` when the CLI should use a backend other than its built-in self-hosted default.
`;
}
