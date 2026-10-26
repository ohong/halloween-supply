# Decomposition eval: OpenCV service vs luna

Generated 2026-10-26T23:53:58.471Z by `bun scripts/eval-decompose.ts`. 25 catalog editorial images, 120 ground-truth components drafted from the catalog (see eval/README.md for limitations).

A prediction matches a ground-truth component when its slot is in the same slot group (top and outer are interchangeable) and its garment phrase has similarity ≥ 0.5 (same head noun = 1, same garment class = 0.75, compatible class = 0.5). Slot accuracy counts exact slot (or a listed alternate) among matched pairs. Color accuracy counts a predicted color name in the ground-truth color family among matched pairs.

| metric | luna |
|---|---|
| precision | 88.1% |
| recall | 98.3% |
| slot accuracy (matched) | 100.0% |
| color-name accuracy (matched) | 86.4% |
| pieces predicted / truth | 134 / 120 |
| failed requests | 0 |
| latency p50 / p95 (client wall) | 5528 / 7293 ms |
| server time p50 (opencv timings_ms.total) | n/a |
| cost per image | 2413 in / 455 out tokens (set LUNA_USD_PER_M_INPUT/OUTPUT for $) |

## Per costume (recall · precision · color)

| costume | luna |
|---|---|
| autumn-scarecrow | 4/4 · 4/5 · 2/4 |
| candy-corn-sorceress | 5/5 · 5/5 · 4/5 |
| celestial-sorcerer | 4/4 · 4/6 · 4/4 |
| clockwork-aviator | 6/6 · 6/8 · 5/6 |
| coral-mermaid | 4/4 · 4/5 · 4/4 |
| cosmic-cowboy | 5/5 · 5/6 · 5/5 |
| desert-alchemist | 5/5 · 5/6 · 5/5 |
| disco-phantom | 5/5 · 5/5 · 5/5 |
| enchanted-jester | 5/5 · 5/5 · 1/5 |
| forest-sprite | 5/5 · 5/5 · 5/5 |
| garden-beekeeper | 4/4 · 4/6 · 3/4 |
| linen-ghost | 2/2 · 2/2 · 2/2 |
| midnight-pirate | 6/6 · 6/6 · 6/6 |
| moon-moth | 3/4 · 3/3 · 1/3 |
| pumpkin-harlequin | 4/4 · 4/4 · 4/4 |
| raven-scholar | 5/6 · 5/7 · 4/5 |
| retro-astronaut | 5/5 · 5/5 · 4/5 |
| rose-garden-queen | 5/5 · 5/5 · 4/5 |
| snow-owl | 5/5 · 5/6 · 5/5 |
| starlight-witch | 4/4 · 4/5 · 4/4 |
| storm-chaser | 4/4 · 4/4 · 3/4 |
| velvet-ringmaster | 6/6 · 6/7 · 5/6 |
| velvet-vampire | 5/5 · 5/6 · 5/5 |
| victorian-detective | 6/6 · 6/6 · 6/6 |
| woodland-mushroom | 6/6 · 6/6 · 6/6 |

## Details

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
