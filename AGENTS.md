# The Watch

Unofficial Argonauts player. Not affiliated with ACK or Muse Facktory.

## Product
- Static site only. No backend, no wallet, no analytics, no prices.
- Watch / Take apart / Draw.
- Art is loaded from Ethereum via tokenURI / render. Do not invent pixels.
- Copyright stays with ACK. Do not say we made the Argonauts.
- Do not use “score”, rarity, floor, or flip language in the UI.

## Stack
- Plain HTML, CSS, JS. No React, no bundler unless truly needed.
- Local first. Publishing is GitHub Pages from this static tree (no server), on the **ArgoWatch** hobby account — not a company GitHub. Free Pages needs a **public** repo; private Pages needs GitHub Pro.
- Integer pixel scaling only. image-rendering: pixelated.
- The plate is 4 physical inches square (the print). Do not use CSS `4in` — browsers treat that as 96dpi (384px), which is not a ruler inch on most panels. Pick the integer scale nearest 4in from the screen's pixel size and a typical diagonal; shrink only if the window cannot fit it.

## Contract
- 0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C
- traitsOf(uint256) → uint8[7]
- Slots: 0 Palette, 1 Bones, 2 Cloak, 3 Relic, 4 Sight, 5 Artifact, 6 Crown
- tokenURI may revert for unminted ids
- traitsOf is meant to be frozen (TableFrozen). Renderer can change via setRenderer. Art is always live. The trait snapshot is not.
- After ACK touches the table (or burned/fate-style extras appear), re-run `node scripts/fetch-traits.mjs`. `node scripts/check-traits.mjs` samples live traitsOf against the snapshot. The player also canaries the current id when Watch starts and when Take apart opens. SVG cache is keyed by renderer+id and expires after 5 minutes so Fate/burn art can change without setRenderer. Strip always fetches tokenURI fresh. Do not add a nightly Action that re-fetches 9,999 tokenURIs.

## Taste
- Dark salon / parchment / hairline gold. Quiet. No rarity badges.
- The work is the picture. Transport chrome is text-only and appears on hover (tap the plate on touch).
- Wordmark: The Watch. **Play** toggles play / pause. **Strip** toggles explode / reassemble.
- Isolation well is 2in square on desktop (half the 4in plate). On narrow screens, isolation is half the assembled scale and sits to the right of the plate list. None plates are not clickable. Well color is locked per trait name (all Woodpipes share one well). Dark names (Death, Corsair, Eye Patch, pipe, etc.) use paper; otherwise luma of the isolation.
- Touch: tap empty canvas to show transport chrome for 3s; interacting with a control resets the timer. Sheet sits under the mode row in Draw. Fate (and other non-slot extras except Print) are inert, like None.
- Isolate occupancy on a **bare skeleton** (so covered smoke still belongs to the artifact). Recolor visible cells from the **tokenURI** print — `render(traits)` and `tokenURI` can disagree (Dragon's Breath tip is green in the print, blue in render). Skip ACK print stamps (1×1 black/white at fill-opacity ~0.11–0.14) so they do not show as solid dots on Bones or any plate. Covered cells keep the trait's own pixel. Palette = ground color. Bones and accessories on black. Print links to Harbor `/argonaut/{id}`.
- **Draw** paints the current SVG rects in document order, including `fill-opacity` (the faint black/white stamps ACK overlays on every print). While plotting, the Draw label reads **Pause**; press it to pause, again to resume. **Reset** restarts the plot. **Play** in Draw mode leaves Draw and resumes the slideshow. **Sheet** sits under the mode row in Draw and downloads a night-mode 24×24 graph-paper PDF (white field only; site colors elsewhere).
- Play wrap easter egg (only after a full 1→9999 play streak): “There is only serve the Muse”.
- Plates are clickable to highlight. The assembled work stays whole on the left.
- Watch speed is 0.5× / 1× / 2×. Default is 0.5×. 2× is the cap. 1× = one id per second. Prev, Next, and typing an id pause the slideshow until Play.
- `main` is production (GitHub Pages). `staging` is for upgrades; merge to `main` to ship.
- Explode = museum plate list, not particles. SVG is flat rects — do not fake per-layer isolation.

## Security
- No wallet, no cookies, no analytics, no third-party scripts, no inline JS.
- CSP in index.html: default-src none; connect-src is `'self'` plus the RPC allowlist.
- Rebuild SVG from rect + hex fills. Drop scripts, urls, foreignObject, event handlers.
- eth_call only. Token ids 1–9999. Do not commit RPC keys.
