# Restore the four complete shopping catalogs

The database health check found all 50 costume records and every product photo, but only 46 complete price-tier sets. The four exceptions were Jellyfish Bloom, Venus Flytrap, Walking Thundercloud, and Silent Film Star.

The daily refresh treated an omitted shopper size as permission to choose the cheapest size in the selected color family. Shopify stores pack weights, felt sheet dimensions, and fabric samples in size options. This changed a yard of fabric to a 99-cent swatch, a 32-ounce filling bag to a 12-ounce bag, and larger makeup jars to the smaller jar's price. The saved merchant links and product descriptions still selected the original variants.

Replacing the products would require new merchant research and photos while leaving refresh able to corrupt the replacements. The fix retains an explicitly pinned variant during refresh. An explicit shopper size can still select another size in the same color/material family. Missing variants fail verification. If the variant API is unavailable, generic page offers cannot price a pinned variant.

The direct merchant Ajax product and cart endpoints confirmed 13 existing offers in USD. The real application verifier passed 13 refresh selections, 13 pinned checkout selections, explicit shopper size selection, a sold-out pinned offer, a removed variant, and an invalid size. The attached JSON records variant IDs, exact prices, stock, timestamps, source endpoints and the repair plan. No model or paid research API was called.

Representative corrected prices:

| Selected product | Corrupted database price | Verified price |
| --- | ---: | ---: |
| Pink organza, one yard | $0.99 | $2.99 |
| Pearl organza, one yard | $0.99 | $4.49 |
| White felt, 12 × 18 inches | $1.50 | $2.50 |
| White felt, half yard | $1.50 | $6.00 |
| Ben Nye makeup, 3 oz | $10.00 | $12.00 |
| Ben Nye makeup, 8 oz | $10.00 | $24.00 |
| Poly Fil, 32 oz | $8.49 | $19.99 |

Seven bundled catalogs share the 13 offers. Their price, size and checked-at facts are synchronized. Product IDs, merchant links, photos, descriptions, component choices, and ordering are preserved. The database repair updates only the verified price, stock, size and timestamp fields across shared product references; it does not replace entire live catalogs.

Reproduce the read-only live merchant checks:

```
bun scripts/verify-catalog-variants.ts --output=/tmp/catalog-variant-evidence.json
```

After deploying the verifier fix, apply a fresh verified database repair with authorized Turso credentials:

```
bun --env-file=.env.local scripts/verify-catalog-variants.ts --apply --output=/tmp/catalog-repair-result.json
bun --env-file=.env.local scripts/verify-full-catalog.ts https://halloween.supply
```

The repair validates all 50 projected catalog price sets before writing, backs up the current catalog, and patches only the 13 verified product IDs. The full release check reads the database and confirms all 50 pages, three price points per component, real merchant photos, public image bytes and bundled fallback behavior.

Merchant prices and stock can change after verification. Checkout continues to check the selected offer live. Source protocol: https://shopify.dev/docs/api/ajax/reference/product .

## Applied result

The scoped repair updated all 13 product IDs successfully. The live database health response changed from HTTP 503 with 46/50 complete looks to HTTP 200, status `ok`, 50/50 complete looks and no missing costume slugs. All four browser shopping flows passed locally. Their four unpaid Stripe TEST sessions each contained the five selected product lines and were expired after verification. Production page/image release checks run after the verifier fix deploys from main.
