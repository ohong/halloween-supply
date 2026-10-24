# Halloween Supply

A small Halloween costume gallery, inspired by minimal product directories.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000. For a production build, run `bun run build`, then `bun run start`.

## Included

- Five original costume concepts and transparent PNG cutouts in `public/costumes/`.
- Category filters, alphabetical sorting, and browser-local saved looks.
- A page for each costume with outfit pieces and styling notes.
- Responsive layouts, keyboard focus states, and reduced-motion support.

Costume content lives in `lib/costumes.ts`. Image prompts and generation details live in `docs/design/costume-image-prompts.json`. The built-in image tool generated the assets; it does not expose a model selector to confirm the requested Sunburst model.

## Checks

```sh
bun run lint
bun run build
```

The page is a costume inspiration gallery. It has no commerce or signup backend.
