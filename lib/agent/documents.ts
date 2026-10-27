import { costumes } from "../costumes";
import { articles, site } from "./site";

export const homepageIntroduction = [
  "Halloween Supply helps you find Halloween costume ideas and build a look from individual clothing pieces and accessories. Explore the costume guides below, compare their colors and shapes, and start with pieces you already own. Each look includes a practical piece list and a styling tip so you can decide what to borrow, make, or buy.",
  "Open a costume page to review available product options. Retailer prices, sizes, stock, and delivery terms can change, so check the current item details before checkout. Generated costume illustrations and optional try-on previews show an intended style; they do not guarantee fit or the exact appearance of a product. You can browse every guide without uploading a personal photo.",
];

const navigation = `\n## More information\n\n- [About](${site.url}/about)\n- [Contact](${site.url}/contact)\n- [Privacy](${site.url}/privacy)\n- [Agent instructions](${site.url}/llms.txt)\n- [Sitemap](${site.url}/sitemap.xml)\n`;

function costumeMarkdown(costume: (typeof costumes)[number], level: string) {
  return `${level} [${costume.name}](${site.url}/costumes/${costume.slug})\n\n${costume.description}\n\n${costume.pieces.map((piece) => `- ${piece}`).join("\n")}\n\nStyling tip: ${costume.tip}`;
}

export function documentMarkdown(pathname: string): { status: number; body: string } {
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/") return { status: 200, body: `# ${site.name} — Halloween costume ideas\n\n${homepageIntroduction.join("\n\n")}\n\n## Costume guides\n\n${costumes.map((costume) => costumeMarkdown(costume, "###")).join("\n\n")}${navigation}` };
  const articleKey = path.slice(1);
  const article = Object.hasOwn(articles, articleKey) ? articles[articleKey as keyof typeof articles] : undefined;
  if (article) return { status: 200, body: `# ${article.title}\n\n${article.description}\n\n${article.sections.map(({ heading, paragraphs, links }) => `## ${heading}\n\n${paragraphs.join("\n\n")}${links ? `\n\n${links.map(({ label, href }) => `- [${label}](${href})`).join("\n")}` : ""}`).join("\n\n")}${navigation}` };
  const costume = costumes.find((item) => path === `/costumes/${item.slug}`);
  if (costume) return { status: 200, body: `${costumeMarkdown(costume, "#")}\n\nThis is a costume styling guide. Open the HTML page to compare current merchant products and use interactive shopping features.${navigation}` };
  if (["/screenshot", "/capture"].includes(path)) return { status: 200, body: `# ${path === "/screenshot" ? "Use a costume screenshot" : "Phone camera connection"}\n\nThis optional interactive experience requires a browser. Ask the shopper before uploading an image or enabling a camera. Use only images they have permission to share. Keep private camera links and connection codes out of agent logs. Read the [privacy information](${site.url}/privacy) before starting.${navigation}` };
  return { status: 404, body: `# Page not found\n\nThis page does not exist on Halloween Supply. Start with the [costume guides](${site.url}/), check the [sitemap](${site.url}/sitemap.xml), or read the [agent instructions](${site.url}/llms.txt).\n` };
}

export function agentInstructions() {
  return `# ${site.name}\n\n> Halloween costume ideas, individual clothing pieces, and merchant product options. Read-only discovery does not require a personal photo.\n\nUse this site when someone needs a distinctive Halloween costume, a list of pieces to recreate a look, or styling guidance using clothing they already own. Use the costume guides to compare the intended style before opening current product options in the browser.\n\nRequest public pages with Accept: text/markdown for a Markdown representation at the same URL. Accept: text/html returns the normal storefront. Quality weights are honored; unsupported document media types receive HTTP 406. Unknown document paths return HTTP 404 with recovery links.\n\nDo not infer stock, fit, shipping, or final prices from a styling guide. Merchant details can change. Generated reference and try-on images are approximate. Ask the shopper before uploads, camera access, cart changes, or checkout. Never purchase without explicit approval. No public autonomous-purchase API or MCP endpoint is advertised.\n\n## When to use this\n\n- [Browse costume ideas](${site.url}/): Find a look and read its description, clothing pieces, and styling tip.\n- [Cosmic Cowboy example](${site.url}/costumes/cosmic-cowboy): Follow /costumes/{slug} links from the homepage; request Markdown to read a specific guide.\n- [Screenshot experience](${site.url}/screenshot): Let a consenting shopper use an image in the interactive browser flow.\n\n## Site information\n\n- [About](${site.url}/about): Product purpose and preview limits.\n- [Contact](${site.url}/contact): Contact availability and information for listing, order, or privacy questions.\n- [Privacy](${site.url}/privacy): Browser storage, image processing, and checkout information.\n- [Sitemap](${site.url}/sitemap.xml): Indexable public pages.\n`;
}
