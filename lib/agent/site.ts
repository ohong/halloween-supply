export const site = {
  name: "Halloween Supply",
  url: "https://halloween.supply",
  title: "Halloween Supply — Halloween costume ideas and shopping guides",
  description: "Discover Halloween costume ideas, see the individual clothing pieces, try on a look, and compare products from retailers and marketplaces.",
  contentUpdated: "2026-10-27",
  catalogUpdated: "2026-10-26",
};

export type SiteArticle = {
  title: string;
  description: string;
  sections: { heading: string; paragraphs: string[]; links?: { label: string; href: string }[] }[];
};

export const articles: Record<"about" | "contact" | "privacy", SiteArticle> = {
  about: {
    title: "About Halloween Supply",
    description: "How Halloween Supply turns costume ideas into individual clothing pieces and shopping options.",
    sections: [
      { heading: "Costumes built from pieces", paragraphs: [
        "Halloween Supply helps you discover a Halloween costume and understand the clothing and accessories that make it recognizable. Browse the curated looks, open a costume guide, and compare the individual pieces. You can use clothing you already own and choose the pieces you still need.",
        "Each guide describes a look, lists its main pieces, and offers a styling tip. Product options come from retailers and marketplaces. Prices, sizes, shipping, and availability can change. Check the current product details and checkout information before you commit to a purchase.",
      ] },
      { heading: "Ideas and previews", paragraphs: [
        "Costume illustrations and virtual try-on images help explain the intended style. Generated previews are approximate. They do not measure fit or guarantee the exact color, material, or appearance of a delivered item. Use the product photographs and descriptions when comparing real items.",
        "You can browse without submitting a personal photo. Optional photo and camera features require your choice to use them. Read our Privacy page before sharing images. For questions about a look, product listing, or privacy, the Contact page explains what information helps us investigate.",
      ] },
    ],
  },
  contact: {
    title: "Contact Halloween Supply",
    description: "Information for product questions, listing corrections, checkout questions, and privacy requests.",
    sections: [
      { heading: "Questions about a costume or product", paragraphs: [
        "When asking about a look, include the costume name and its page link. For a product question or a listing correction, include the item name, merchant, and product link. Describe the problem, such as an unavailable item, a changed price, or a photograph that does not match the description. These details help distinguish the costume guide from the merchant listing.",
        "For an order question, use any contact route included in your checkout confirmation or receipt. Include the order reference only in that private route when requested. Do not post payment card numbers, account passwords, private camera links, or personal photos in a public message. Delivery, sizing, and return terms can differ by item and merchant.",
      ] },
      { heading: "Privacy and site feedback", paragraphs: [
        "For a privacy question, identify the feature you used and describe your request without sending the image again. Our Privacy page explains browser storage, optional image processing, and checkout data. For a website issue, include the page link, device type, and the action that failed.",
        "Report non-sensitive website issues through the public project issue tracker linked below. A GitHub account is required to post. Public issues are visible to everyone, so do not use them for order details, personal data, or image uploads. A general support email and business mailing address have not been published on this site; confirmed details will be added when available.",
      ], links: [{ label: "Report a website issue on GitHub", href: "https://github.com/ohong/halloween-supply/issues" }] },
    ],
  },
  privacy: {
    title: "Privacy at Halloween Supply",
    description: "How browser preferences, optional photo features, and checkout information are used.",
    sections: [
      { heading: "Browsing and browser storage", paragraphs: [
        "You can browse costume guides without sending a personal photograph. The site uses your browser’s local storage to remember saved looks, cart choices, size selections, and model preferences. Clearing site data in your browser removes these stored preferences. It may also clear your saved looks and cart. Operational requests can expose ordinary connection information, including an IP address, to hosting and service providers.",
      ] },
      { heading: "Optional photos and camera features", paragraphs: [
        "Photo previews send the image you choose to the application and the image service needed to produce the result. Camera features require browser permission. A phone-camera link can connect a phone camera with your computer; keep its link and code private. Stop the session or revoke camera permission to end camera access.",
        "The standard virtual try-on interface keeps the selected photo and generated preview in page memory rather than saving them in local storage. Closing or reloading the page clears that page state. This does not establish that every provider deletes its processing records immediately. Image, live-session, and optional 3D providers process information under their own policies. Use photos you have permission to share, and avoid sensitive documents or unrelated people.",
      ] },
      { heading: "Search and checkout", paragraphs: [
        "Costume ideas and search terms may be sent to model and search services to find relevant clothing. Custom-look requests can create a stored record of the request and its product results. Checkout uses Stripe and can collect contact and shipping details needed for the transaction. Merchant and payment pages have their own privacy terms. Never send card information through a general feedback message.",
      ] },
      { heading: "Your choices and questions", paragraphs: [
        "Photo, live-camera, and 3D features are optional. You can decline camera access, stop an active session, and clear browser site data. This page describes current application behavior; it does not promise a universal retention period across external providers. Use the contact route on your receipt for order questions. Our Contact page records the availability of general support details and what to include in a privacy request.",
      ] },
    ],
  },
};

export function organizationSchema() {
  return {
    "@type": "Organization",
    "@id": `${site.url}/#organization`,
    name: site.name,
    url: site.url,
    description: site.description,
    logo: `${site.url}/icon.svg`,
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", url: `${site.url}/contact` },
  };
}
