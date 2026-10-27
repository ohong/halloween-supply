# Decomposition eval: OpenCV service vs luna

Generated 2026-10-27T00:08:31.241Z by `bun scripts/eval-decompose.ts`. 25 catalog editorial images, 120 ground-truth components drafted from the catalog (see eval/README.md for limitations).

A prediction matches a ground-truth component when its slot is in the same slot group (top and outer are interchangeable) and its garment phrase has similarity ≥ 0.5 (same head noun = 1, same garment class = 0.75, compatible class = 0.5). Slot accuracy counts exact slot (or a listed alternate) among matched pairs. Color accuracy counts a predicted color name in the ground-truth color family among matched pairs.

| metric | opencv | luna |
|---|---|---|
| precision | 87.5% | 88.1% |
| recall | 70.0% | 98.3% |
| slot accuracy (matched) | 84.5% | 100.0% |
| color-name accuracy (matched) | 69.0% | 86.4% |
| pieces predicted / truth | 96 / 120 | 134 / 120 |
| failed requests | 0 | 0 |
| latency p50 / p95 (client wall) | 2624 / 7046 ms | 5528 / 7293 ms |
| server time p50 (opencv timings_ms.total) | 2561 ms | n/a |
| cost per image | server 3148 ms/image (set OPENCV_USD_PER_HOUR for $) | 2413 in / 455 out tokens (set LUNA_USD_PER_M_INPUT/OUTPUT for $) |

## Per costume (recall · precision · color)

| costume | opencv | luna |
|---|---|---|
| autumn-scarecrow | 4/4 · 4/6 · 2/4 | 4/4 · 4/5 · 2/4 |
| candy-corn-sorceress | 5/5 · 5/5 · 5/5 | 5/5 · 5/5 · 4/5 |
| celestial-sorcerer | 3/4 · 3/4 · 3/3 | 4/4 · 4/6 · 4/4 |
| clockwork-aviator | 3/6 · 3/3 · 3/3 | 6/6 · 6/8 · 5/6 |
| coral-mermaid | 3/4 · 3/3 · 2/3 | 4/4 · 4/5 · 4/4 |
| cosmic-cowboy | 4/5 · 4/5 · 4/4 | 5/5 · 5/6 · 5/5 |
| desert-alchemist | 4/5 · 4/5 · 2/4 | 5/5 · 5/6 · 5/5 |
| disco-phantom | 3/5 · 3/3 · 2/3 | 5/5 · 5/5 · 5/5 |
| enchanted-jester | 5/5 · 5/5 · 1/5 | 5/5 · 5/5 · 1/5 |
| forest-sprite | 3/5 · 3/4 · 3/3 | 5/5 · 5/5 · 5/5 |
| garden-beekeeper | 3/4 · 3/4 · 3/3 | 4/4 · 4/6 · 3/4 |
| linen-ghost | 1/2 · 1/2 · 1/1 | 2/2 · 2/2 · 2/2 |
| midnight-pirate | 5/6 · 5/5 · 4/5 | 6/6 · 6/6 · 6/6 |
| moon-moth | 1/4 · 1/3 · 0/1 | 3/4 · 3/3 · 1/3 |
| pumpkin-harlequin | 2/4 · 2/3 · 2/2 | 4/4 · 4/4 · 4/4 |
| raven-scholar | 3/6 · 3/3 · 2/3 | 5/6 · 5/7 · 4/5 |
| retro-astronaut | 4/5 · 4/5 · 0/4 | 5/5 · 5/5 · 4/5 |
| rose-garden-queen | 3/5 · 3/3 · 0/3 | 5/5 · 5/5 · 4/5 |
| snow-owl | 3/5 · 3/3 · 2/3 | 5/5 · 5/6 · 5/5 |
| starlight-witch | 4/4 · 4/4 · 2/4 | 4/4 · 4/5 · 4/4 |
| storm-chaser | 3/4 · 3/3 · 2/3 | 4/4 · 4/4 · 3/4 |
| velvet-ringmaster | 3/6 · 3/3 · 3/3 | 6/6 · 6/7 · 5/6 |
| velvet-vampire | 4/5 · 4/4 · 3/4 | 5/5 · 5/6 · 5/5 |
| victorian-detective | 4/6 · 4/4 · 4/4 | 6/6 · 6/6 · 6/6 |
| woodland-mushroom | 4/6 · 4/4 · 3/4 | 6/6 · 6/6 · 6/6 |

## Details

### opencv

**autumn-scarecrow**

- ✓ hat: "straw scarecrow hat" (head, rust)
- ✓ boots: "fur trim boots" (feet, brown)
- ✓ overalls: "corduroy overalls" (bottom, charcoal) · color ≠ blue
- ✓ shirt: "beekeeper jacket" (top, brown) · color ≠ yellow
- + extra "pirate head bandana" (accessory, tan) [crop](crops/autumn-scarecrow-p2.jpg)
- + extra "burlap sack" (accessory, tan) [crop](crops/autumn-scarecrow-p3.jpg)

**candy-corn-sorceress**

- ✓ hat: "straw scarecrow hat" (head, rust)
- ✓ dress: "candy corn dress" (top, orange)
- ✓ stockings: "striped stockings" (bottom, orange)
- ✓ boots: "knee-high boots" (feet, black)
- ✓ cape: "velvet cape" (top, black) · slot differs

**celestial-sorcerer**

- ✓ hat: "starry wizard hat" (head, navy)
- ✓ robe: "hooded wizard robe" (top, navy)
- ✓ boots: "witch buckle boots" (feet, black)
- ✗ missed belt: silver rope belt (accessory)
- + extra "velvet cape" (top, navy) [crop](crops/celestial-sorcerer-p2.jpg)

**clockwork-aviator**

- ✓ boots: "pointed western boots" (feet, chocolate)
- ✓ jacket: "shearling flight jacket" (top, chocolate) · slot differs
- ✓ trousers: "cargo pants" (bottom, brown)
- ✗ missed cap: brown leather aviator cap with goggles (head)
- ✗ missed shirt: white button shirt (top)
- ✗ missed belt: brown leather belt (accessory)

**coral-mermaid**

- ✓ skirt: "mermaid skirt" (bottom, teal)
- ✓ jacket: "feather shoulder cape" (top, gray) · slot differs · color ≠ pink
- ✓ blouse: "sequin mermaid gown" (top, teal)
- ✗ missed crown: pink shell crown (head)

**cosmic-cowboy**

- ✓ hat: "felt cowboy hat" (head, gray)
- ✓ neckerchief: "knotted neckerchief" (accessory, navy)
- ✓ boots: "pointed western boots" (feet, gray)
- ✓ jacket: "flared disco jumpsuit" (top, silver)
- ✗ missed trousers: silver metallic flared trousers (bottom)
- + extra "satin pantaloons" (bottom, gray) [crop](crops/cosmic-cowboy-p3.jpg)

**desert-alchemist**

- ✓ belt: "wide leather belt" (accessory, chocolate)
- ✓ boots: "pointed western boots" (feet, brown)
- ✓ cloak: "hooded cloak" (outer, rust) · color ≠ beige
- ✓ tunic: "hooded cape" (top, tan) · color ≠ orange
- ✗ missed trousers: white loose trousers (bottom)
- + extra "hooded knit cowl" (accessory, chocolate) [crop](crops/desert-alchemist-p1.jpg)

**disco-phantom**

- ✓ boots: "metallic space boots" (feet, gray)
- ✓ cape: "feather shoulder cape" (top, gray) · slot differs
- ✓ jumpsuit: "satin cocktail dress" (top, silver) · color ≠ white
- ✗ missed belt: silver metallic belt (accessory)
- ✗ missed gloves: silver gloves (accessory)

**enchanted-jester**

- ✓ tunic: "theatrical tunic" (top, chocolate) · color ≠ purple
- ✓ trousers: "velvet trousers" (bottom, burgundy) · color ≠ purple
- ✓ boots: "buckled pirate boots" (feet, chocolate) · color ≠ purple
- ✓ collar: "carpet bag" (accessory, cream)
- ✓ cap: "belled jester cap" (head, olive) · color ≠ purple

**forest-sprite**

- ✓ tunic: "leaf green tunic" (top, olive)
- ✓ boots: "witch buckle boots" (feet, chocolate)
- ✓ cape: "feather shoulder cape" (top, olive) · slot differs
- ✗ missed crown: green leaf crown (head)
- ✗ missed leggings: olive leggings (bottom)
- + extra "peter pan collar" (accessory, olive) [crop](crops/forest-sprite-p2.jpg)

**garden-beekeeper**

- ✓ jacket: "beekeeper jacket" (top, cream)
- ✓ boots: "lace-up work boots" (feet, brown)
- ✓ trousers: "cargo pants" (bottom, cream)
- ✗ missed gloves: yellow gloves (accessory)
- + extra "leather flight cap" (head, chocolate) [crop](crops/garden-beekeeper-p0.jpg)

**linen-ghost**

- ✓ boots: "pointed western boots" (feet, chocolate)
- ✗ missed sheet: white ghost sheet (outer)
- + extra "white bedsheet ghost" (top, ivory) [crop](crops/linen-ghost-p0.jpg)

**midnight-pirate**

- ✓ hat: "tricorn pirate hat" (head, black)
- ✓ boots: "buckled pirate boots" (feet, black)
- ✓ coat: "long pirate coat" (top, black) · slot differs · color ≠ navy
- ✓ trousers: "pirate breeches" (bottom, black)
- ✓ sash: "pirate head bandana" (accessory, burgundy)
- ✗ missed shirt: white ruffled shirt (top)

**moon-moth**

- ✓ wings: "feather shoulder cape" (top, beige) · slot differs · color ≠ green
- ✗ missed antennae: white antennae headband (head)
- ✗ missed collar: white faux fur collar (accessory)
- ✗ missed unitard: green unitard (top)
- + extra "fitted tights" (bottom, chocolate) [crop](crops/moon-moth-p1.jpg)
- + extra "thigh-high boots" (feet, chocolate) [crop](crops/moon-moth-p2.jpg)

**pumpkin-harlequin**

- ✓ boots: "knee-high boots" (feet, black)
- ✓ jumpsuit: "diamond harlequin bodysuit" (top, rust)
- ✗ missed beret: orange beret (head)
- ✗ missed collar: orange ruff collar (accessory)
- + extra "flared trousers" (bottom, black) [crop](crops/pumpkin-harlequin-p1.jpg)

**raven-scholar**

- ✓ skirt: "ruffled tiered skirt" (bottom, black)
- ✓ boots: "platform ankle boots" (feet, black)
- ✓ waistcoat: "feather shoulder cape" (top, black) · color ≠ gray
- ✗ missed headpiece: black raven headpiece (head)
- ✗ missed capelet: black feather capelet (outer)
- ✗ missed blouse: white blouse (top)

**retro-astronaut**

- ✓ helmet: "rounded astronaut helmet" (head, black) · color ≠ silver
- ✓ jumpsuit: "flight jumpsuit" (top, beige) · color ≠ white
- ✓ belt: "buckled belt" (accessory, beige) · color ≠ gray
- ✓ boots: "metallic space boots" (feet, charcoal) · color ≠ silver
- ✗ missed gloves: white gloves (accessory)
- + extra "cargo pants" (bottom, beige) [crop](crops/retro-astronaut-p3.jpg)

**rose-garden-queen**

- ✓ gown: "medieval princess gown" (top, chocolate) · color ≠ burgundy
- ✓ boots: "pointed western boots" (feet, chocolate) · color ≠ black
- ✓ cape: "velvet cape" (top, charcoal) · slot differs · color ≠ green
- ✗ missed crown: gold crown (head)
- ✗ missed gloves: burgundy opera gloves (accessory)

**snow-owl**

- ✓ boots: "pointed western boots" (feet, brown)
- ✓ cape: "feather shoulder cape" (top, cream) · slot differs
- ✓ trousers: "linen pants" (bottom, silver) · color ≠ white
- ✗ missed headpiece: white owl headpiece (head)
- ✗ missed tunic: white tunic (top)

**starlight-witch**

- ✓ boots: "witch buckle boots" (feet, black)
- ✓ hat: "starry wizard hat" (head, black) · color ≠ navy
- ✓ cape: "velvet cape" (top, black) · slot differs · color ≠ navy
- ✓ dress: "velvet ball gown" (top, navy)

**storm-chaser**

- ✓ trousers: "utility trousers" (bottom, navy)
- ✓ boots: "wellington boots" (feet, black) · color ≠ navy
- ✓ raincoat: "hooded utility jacket" (top, gold) · slot differs
- ✗ missed sweater: navy striped sweater (top)

**velvet-ringmaster**

- ✓ boots: "tall riding boots" (feet, black)
- ✓ tailcoat: "gold trim tailcoat" (top, burgundy) · slot differs
- ✓ trousers: "pirate breeches" (bottom, black)
- ✗ missed hat: black top hat (head)
- ✗ missed shirt: white ruffled shirt (top)
- ✗ missed waistcoat: gold waistcoat (outer)

**velvet-vampire**

- ✓ trousers: "velvet trousers" (bottom, black)
- ✓ boots: "platform ankle boots" (feet, black)
- ✓ cape: "long velvet cape" (outer, burgundy) · color ≠ black
- ✓ waistcoat: "velvet cape" (top, black)
- ✗ missed shirt: white ruffled shirt (top)

**victorian-detective**

- ✓ coat: "inverness cape coat" (top, brown) · slot differs
- ✓ hat: "deerstalker cap" (head, brown)
- ✓ trousers: "pirate breeches" (bottom, brown)
- ✓ shoes: "buckle pilgrim shoes" (feet, chocolate)
- ✗ missed shirt: white button shirt (top)
- ✗ missed waistcoat: brown waistcoat (outer)

**woodland-mushroom**

- ✓ boots: "platform ankle boots" (feet, brown)
- ✓ hat: "spotted mushroom hat" (head, rust) · color ≠ red
- ✓ shortalls: "corduroy overalls" (bottom, brown)
- ✓ blouse: "hooded cape" (top, cream)
- ✗ missed neckerchief: green neckerchief (accessory)
- ✗ missed tights: white tights (accessory)

### luna

**autumn-scarecrow**

- ✓ overalls: "Blue denim patchwork overalls" (bottom, blue)
- ✓ boots: "Brown lace-up work boots" (feet, brown)
- ✓ hat: "Brown floppy patchwork hat" (head, brown) · color ≠ orange
- ✓ shirt: "Brown plaid button-up shirt" (top, brown) · color ≠ yellow
- + extra "Straw scarecrow cuffs" (accessory, tan)

**candy-corn-sorceress**

- ✓ hat: "Orange, yellow, and cream pointed witch hat" (head, orange)
- ✓ cape: "Black velvet cape" (outer, black)
- ✓ dress: "Orange tiered costume dress with cream bodice" (top, orange)
- ✓ boots: "Black lace-up platform boots" (feet, black)
- ✓ stockings: "Candy-corn striped tights" (bottom, no color) · color ≠ orange

**celestial-sorcerer**

- ✓ hat: "Pointed celestial wizard hat" (head, navy)
- ✓ robe: "Embroidered wizard robe" (outer, navy)
- ✓ belt: "Braided cord belt" (accessory, silver)
- ✓ boots: "Black lace-up boots" (feet, black)
- + extra "Long star-front tunic" (top, navy)
- + extra "Crescent pendant necklace" (accessory, silver)

**clockwork-aviator**

- ✓ cap: "Brown leather aviator cap" (head, brown)
- ✓ shirt: "Cream button-up shirt" (top, cream)
- ✓ belt: "Brown leather belt" (accessory, brown)
- ✓ boots: "Brown lace-up combat boots" (feet, brown)
- ✓ trousers: "Olive cargo trousers" (bottom, olive) · color ≠ brown
- ✓ jacket: "Brown shearling flight bomber" (outer, brown)
- + extra "Brass aviator goggles" (accessory, brass)
- + extra "Brown leather crossbody satchel" (accessory, brown)

**coral-mermaid**

- ✓ jacket: "Coral embellished cropped jacket" (outer, coral)
- ✓ blouse: "Seafoam draped-sleeve blouse" (top, seafoam)
- ✓ skirt: "Teal scale mermaid skirt" (bottom, teal)
- ✓ crown: "Coral shell crown" (head, coral)
- + extra "Gold pendant necklace" (accessory, gold)

**cosmic-cowboy**

- ✓ hat: "Silver western cowboy hat" (head, silver)
- ✓ jacket: "Silver fringed western jacket" (outer, silver)
- ✓ trousers: "Silver flared trousers" (bottom, silver)
- ✓ boots: "Silver cowboy boots" (feet, silver)
- ✓ neckerchief: "Blue printed neck scarf" (accessory, blue)
- + extra "Silver western belt" (accessory, silver)

**desert-alchemist**

- ✓ cloak: "Sand hooded cloak" (outer, sand)
- ✓ tunic: "Rust wrap tunic" (top, rust)
- ✓ belt: "Dark leather utility belt" (accessory, brown)
- ✓ trousers: "Cream harem trousers" (bottom, cream)
- ✓ boots: "Brown lace-up boots" (feet, brown)
- + extra "Dark leather bracers" (accessory, brown)

**disco-phantom**

- ✓ cape: "Silver sequined hooded cape" (outer, silver)
- ✓ jumpsuit: "Ivory satin flared jumpsuit" (top, ivory)
- ✓ belt: "Silver jeweled belt" (accessory, silver)
- ✓ gloves: "Silver metallic gloves" (accessory, silver)
- ✓ boots: "Silver platform ankle boots" (feet, silver)

**enchanted-jester**

- ✓ collar: "Ivory ruffled collar" (accessory, ivory)
- ✓ tunic: "Burgundy and sage diamond jester tunic" (top, burgundy) · color ≠ purple
- ✓ trousers: "Burgundy fitted trousers" (bottom, burgundy) · color ≠ purple
- ✓ boots: "Burgundy curled-toe jester boots" (feet, burgundy) · color ≠ purple
- ✓ cap: "Two-tone jester cap with bells" (head, burgundy) · color ≠ purple

**forest-sprite**

- ✓ crown: "Twig and leaf crown" (head, green)
- ✓ cape: "Leaf cape" (outer, olive)
- ✓ leggings: "Olive leggings" (bottom, olive)
- ✓ boots: "Brown lace-up boots" (feet, brown)
- ✓ tunic: "Leaf-embellished dress" (top, green)

**garden-beekeeper**

- ✓ jacket: "Beekeeping jacket" (outer, cream)
- ✓ boots: "Lace-up work boots" (feet, brown)
- ✓ gloves: "Leather work gloves" (accessory, tan) · color ≠ yellow
- ✓ trousers: "Cargo work pants" (bottom, cream)
- + extra "Beekeeping hat with mesh veil" (head, white)
- + extra "Bee-shaped chest pin" (accessory, no color)

**linen-ghost**

- ✓ sheet: "Off-white ghost sheet" (outer, white)
- ✓ boots: "Brown lace-up boots" (feet, brown)

**midnight-pirate**

- ✓ hat: "Black feathered tricorn hat" (head, black)
- ✓ coat: "Navy brocade long coat" (outer, navy)
- ✓ shirt: "Ivory ruffled shirt" (top, ivory)
- ✓ sash: "Burgundy waist sash" (accessory, burgundy)
- ✓ trousers: "Black loose trousers" (bottom, black)
- ✓ boots: "Black tall pirate boots" (feet, black)

**moon-moth**

- ✓ wings: "Green moth-wing cape with pale collar" (outer, green)
- ✓ antennae: "Feather antenna headband" (head, gold) · color ≠ white
- ✓ unitard: "Dark fitted full-body suit" (top, gray) · color ≠ green
- ✗ missed collar: white faux fur collar (accessory)

**pumpkin-harlequin**

- ✓ collar: "Orange ruffled clown collar" (accessory, orange)
- ✓ jumpsuit: "Orange black diamond jumpsuit" (top, orange)
- ✓ boots: "Black heeled ankle boots" (feet, black)
- ✓ beret: "Orange pumpkin-shaped hat" (head, orange)

**raven-scholar**

- ✓ capelet: "Black feather shoulder capelet" (outer, black)
- ✓ blouse: "Ivory high-neck puff-sleeve blouse" (top, ivory)
- ✓ skirt: "Black layered gothic skirt" (bottom, black)
- ✓ boots: "Black lace-up heeled boots" (feet, black)
- ✓ waistcoat: "Black Victorian buttoned vest" (top, black) · color ≠ gray
- ✗ missed headpiece: black raven headpiece (head)
- + extra "Black feather raven mask" (head, black)
- + extra "Antique-style jeweled neck brooch" (accessory, no color)

**retro-astronaut**

- ✓ helmet: "Silver astronaut helmet" (head, silver)
- ✓ gloves: "Cream padded gloves" (accessory, cream)
- ✓ boots: "Silver knee-high boots" (feet, silver)
- ✓ belt: "Beige shoulder harness and belt" (accessory, beige) · color ≠ gray
- ✓ jumpsuit: "Cream padded astronaut coverall" (top, cream)

**rose-garden-queen**

- ✓ crown: "Rose crown" (head, gold)
- ✓ gown: "Burgundy velvet ball gown" (top, burgundy)
- ✓ gloves: "Burgundy embroidered opera gloves" (accessory, burgundy)
- ✓ boots: "Dark brown embroidered ankle boots" (feet, brown) · color ≠ black
- ✓ cape: "Sage embroidered capelet" (outer, sage)

**snow-owl**

- ✓ headpiece: "Feathered headpiece" (head, ivory)
- ✓ cape: "Spotted feather cape" (outer, ivory)
- ✓ tunic: "V-neck tunic" (top, ivory)
- ✓ trousers: "Loose trousers" (bottom, ivory)
- ✓ boots: "Wrap boots" (feet, brown)
- + extra "Rope belt" (accessory, tan)

**starlight-witch**

- ✓ hat: "Pointed celestial witch hat" (head, navy)
- ✓ cape: "Starry hooded cape" (outer, navy)
- ✓ boots: "Lace-up heeled boots" (feet, black)
- ✓ dress: "Corset-bodice ball gown" (top, navy)
- + extra "Crescent moon necklace" (accessory, silver)

**storm-chaser**

- ✓ raincoat: "Mustard hooded raincoat" (outer, mustard)
- ✓ sweater: "Navy and cream striped sweater" (top, navy)
- ✓ trousers: "Dark navy trousers" (bottom, navy)
- ✓ boots: "Black rubber rain boots" (feet, black) · color ≠ navy

**velvet-ringmaster**

- ✓ hat: "Black top hat" (head, black)
- ✓ tailcoat: "Red velvet tailcoat" (outer, red)
- ✓ shirt: "Ivory ruffled shirt" (top, ivory)
- ✓ trousers: "Black trousers" (bottom, black)
- ✓ boots: "Black knee-high boots" (feet, black)
- ✓ waistcoat: "Black brocade waistcoat" (top, black) · color ≠ gold
- + extra "Gold collar brooch" (accessory, gold)

**velvet-vampire**

- ✓ cape: "Black velvet cape with burgundy lining" (outer, black)
- ✓ shirt: "White ruffled dress shirt" (top, white)
- ✓ waistcoat: "Black brocade waistcoat" (top, black)
- ✓ trousers: "Black dress trousers" (bottom, black)
- ✓ boots: "Black ankle boots" (feet, black)
- + extra "Silver vest chain" (accessory, silver)

**victorian-detective**

- ✓ coat: "Brown tweed cape coat" (outer, brown)
- ✓ waistcoat: "Dark brown button waistcoat" (top, brown)
- ✓ shirt: "White button-up dress shirt" (top, white)
- ✓ trousers: "Brown tweed trousers" (bottom, brown)
- ✓ hat: "Brown tweed deerstalker cap" (head, brown)
- ✓ shoes: "Brown leather brogue shoes" (feet, brown)

**woodland-mushroom**

- ✓ hat: "Red spotted mushroom cap hat" (head, red)
- ✓ blouse: "Cream puff-sleeve blouse" (top, cream)
- ✓ neckerchief: "Olive neckerchief" (accessory, olive)
- ✓ tights: "Cream ribbed tights" (accessory, cream)
- ✓ boots: "Brown leather ankle boots" (feet, brown)
- ✓ shortalls: "Brown corduroy short overalls" (bottom, brown)
