import { describe, expect, test } from "bun:test";
import { isBlockedDomain, isNoiseDomain, registrableDomain } from "../../../lib/sourcing/blocklist";

describe("isBlockedDomain", () => {
  test.each([
    "https://www.amazon.com/dp/B0",
    "https://amazon.co.uk/x",
    "https://smile.amazon.de/x",
    "https://www.spirithalloween.com/product/x",
    "https://partycity.com/x",
    "https://www.halloweencity.com/x",
    "https://m.walmart.com/ip/1",
    "https://target.com/p/1",
    "https://www.temu.com/x",
    "https://us.shein.com/x",
    "https://aliexpress.com/item/1",
    "https://www.wish.com/x",
    "https://www.bootbarn.com/x",
    "https://www.zappos.com/x",
    "https://shop.nordstrom.com/s/1",
    "https://www.macys.com/x",
    "https://www.kohls.com/x",
    "https://www.asos.com/x",
    "https://www.urbanoutfitters.com/x",
    "https://www.revolve.com/x",
    "https://www.fashionnova.com/x",
    "https://www.dillards.com/x",
    "https://www.jcpenney.com/x",
    "https://oldnavy.gap.com/x",
    "https://www.gap.com/x",
    "https://www2.hm.com/en_us/x",
    "https://www.zara.com/us/x",
    "https://www.lulus.com/x",
    "https://www.ebay.com/itm/1",
    "www.ebay.com/itm/1",
    "not a url",
  ])("blocks %s", (u) => expect(isBlockedDomain(u)).toBe(true));

  test.each([
    "https://www.etsy.com/listing/1/hat",
    "https://wildwest.example/products/hat",
    "https://hmm.com/x", // not hm.com
    "https://notamazon.com/x",
    "https://gapjunction.com/x",
    "https://targetpractice.example/x",
    "https://ebaystore.example/x",
    "https://www.gypsywagonsf.com/x",
  ])("allows %s", (u) => expect(isBlockedDomain(u)).toBe(false));

  test("noise domains and registrable domain", () => {
    expect(isNoiseDomain("https://www.pinterest.com/pin/1")).toBe(true);
    expect(isNoiseDomain("https://www.etsy.com/listing/1")).toBe(false);
    expect(registrableDomain("https://shop.example.co.uk/x")).toBe("example.co.uk");
    expect(registrableDomain("https://www.etsy.com/x")).toBe("etsy.com");
  });
});
