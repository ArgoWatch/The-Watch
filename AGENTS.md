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
- After ACK touches the table (or burned/fate-style extras appear), re-run `node scripts/fetch-traits.mjs`. `node scripts/check-traits.mjs` samples live traitsOf against the snapshot. The player canaries the current id (and once per session `id+97` and `id+333`) against the snapshot; on mismatch it keeps playing from live `traitsOf` for that id and asks to re-run the fetch script. SVG cache is keyed by renderer+id+source (`uri` or `render`), 5 minute TTL. Renderer address change drops other keys. Strip always fetches tokenURI fresh. Unmounted ids: the plate well tints to the palette and reads UNMINTED; the body is already in that square at opacity 0, then word and body crossfade in place — no stamp-lamp, no Draw-as-print. Print wins when `tokenURI` exists. Do not add a nightly Action that re-fetches 9,999 tokenURIs.

## Taste
- Dark salon / parchment / hairline gold. Quiet. No rarity badges.
- The work is the picture. Transport chrome is text-only: always on for mouse/desktop, tap-to-show for 3s on a phone.
- Wordmark: The Watch. **Play** toggles play / pause. **Strip** toggles explode / reassemble. Play from Strip or Draw leaves that mode and resumes the slideshow in one press.
- Isolation well is 2in square on desktop (half the 4in plate). On narrow screens, isolation is half the assembled scale and sits to the right of the plate list. None plates are not clickable. Well color is locked per trait name (all Woodpipes share one well). Dark names (Death, Corsair, Eye Patch, pipe, etc.) use paper; otherwise only near-black luma (not dark gold).
- Touch: tap empty canvas to show transport chrome for 3s; interacting with a control resets the timer. Sheet sits under the mode row in Draw. Fate (and other non-slot extras except Print) are inert, like None. On a phone, pull down from above the plate (mast, padding, or a vertical drag that started on Play/Strip/Draw) reloads. The picture itself does not. Desktop does not pull-to-reload — mouse drag from the header must not slide the salon or eat Play/Strip/Draw clicks.
- Isolate occupancy on a **bare skeleton** (so covered smoke still belongs to the artifact). Bones occupancy is vs the **render** ground, not the print ground, so a burnt field does not swallow the skeleton. Recolor those cells from the **tokenURI** print with `fill-opacity` composited, so translucent paint (Golden Fleece wool) matches the picture rather than the raw fill hex. `render(traits)` and `tokenURI` can disagree (Dragon's Breath tip is green in the print, blue in render; same Artifact id as Blueberry Kush — isolation follows the print, no renderer-blue toggle). Skip ACK print stamps (1×1 black/white at fill-opacity ~0.11–0.14) so they do not show as solid dots on Bones or any plate. Fainter #000/#fff 1×1s (below ~0.10) are paint, not stamps — Golden Fleece wool leaks two of these; they stay off the Stamp plate and are not flattened into solid grit on occupancy. Show true stamps on their own **Stamp** plate (value `print overlay`, not a trait; muted well so both polarities read; true opacity). Burns with no stamps get Stamp None, inert. Covered cells keep the trait's own pixel. Palette = ground color. Bones and accessories on black (paper only for named darks — Void, Death, pipes — and near-black luma). Print links to Harbor `/argonaut/{id}`. Draw still paints the Fleece blend in document order.
- **Draw** paints the current SVG rects in document order, including `fill-opacity` (the faint black/white stamps ACK overlays on every print). While plotting, the Draw label reads **Pause**; press it to pause, again to resume. **Reset** restarts the plot. **Play** in Draw mode leaves Draw and resumes the slideshow. **Sheet** sits under the mode row in Draw and downloads a night-mode 24×24 graph-paper PDF (white field only; site colors elsewhere).
- Play wrap easter egg (only after a full 1→9999 play streak at 0.5×): “There is only serve the Muse”. Faster speeds, or changing speed mid-run, do not count.
- Plates are clickable to highlight. The assembled work stays whole on the left.
- Watch speed is 0.5× / 1× / 2×. Default is 0.5×. 2× is the cap. 0.5× still beat is ~2.8s (stamp lamp in the middle, then a quiet print before the cut). The lamp is three overlay dots on top of the print — ACK often buries the real stamps under later paint. Each overlay keeps the stamp’s polarity (black stays black-family, white stays white-family). If a black cell sits on or under a dark fill it peaks as charcoal gray, not white; a white cell on or under a light fill peaks as dim silver. The print stamps never change. Play keeps the current picture until the next SVG is ready — no veil dim, no 0.7s opacity fade between Argos. html/body stay salon black (`theme-color` `#0c0a08`) so mobile Chrome does not flash a white hairline at the top on `replaceState`. Fate/Burned adds ~0.8s. GIF `tokenURI` images mount as `<img>`. On-chain SMIL (`animate` on rects) is kept. Burned `tokenURI.image` is still SVG with no `<animate>` (#7135, 2026-09-12); OpenSea `animation_url` has the fire SMIL — do not fetch that CDN. No fate caption in Play. Click the picture or gold `#` on a noticed burn to tick elapsed `deadSince` in the caption — including during Play, which pauses first. Any other action (prev, next, Play, Strip, Draw, a new id) dismisses it. Returning to the burn does not reopen the ticker — click the picture or `#` again. No DeadClock word, no clock colophon.
- Deep link: `?id=7135` or `#7135`. replaceState as the id changes so a copied URL is the current frame.
- Twins: same slots filled, differ in exactly one slot, and that slot is a subtle substitute (not None vs a value, not Palette/Bones/Cloak/Crown/Relic). Sight allowlist only: Chanel↔Prada, Shades↔Digital, Gucci↔Dior. The print must not add a second difference: if tokenURI pixels differ outside the Sight occupancy (Dragon's Breath green tip vs Blueberry Kush blue on the same Artifact id), they are not twins. Number is the 1px-offset door; the differing Sight cells pulse and are the same door. Fate has no twin or film door. Not Shades↔Glasses. Catalog `#` sits in salon gold on twins, film doors (stem and apex), and noticed burns; ordinary Argos keep parchment ink. No badge, no extra label.
- Stem film: each Bones+Palette family with a true stem has one path and two doors. Stem plays it forward, holds the apex, then cuts home to the stem still. The elected apex plays the same frames in reverse, holds the stem, then cuts home to the apex still. Nothing else starts a film. Hover pulse on both doors. Caption and URL follow the Argo on screen; after the far hold the door still and door number return. Path: stem → Sight/Artifact/Relic → crown chapter → cloak chapter (cloak last; never composite a cloak onto a crown). Reverse cuts from the last cloak to the matching crown (same inner loadout if it exists). Apex is the last real frame of that path, not “any 6-trait.” Skip Fate and render-only frames. One 1600ms beat per dress/undress frame, the far hold, and the door still after cutting home. Twin number is extra; during the film the catalog number is the current frame. Authored paths: #6012 plays 6012 → 3399 → 5332; #8778 plays 8778 → 2624 → 7100 → 1640 → 2973.
- Renderer last-6 sits in the footer colophon (not Strip). Hover (or a 3s tap on touch) expands to `renderer(0x…)`. `renderer()` is re-read each frame so setRenderer shows on the next picture, no modal.
- `main` is production (GitHub Pages). `staging` is for upgrades; merge to `main` to ship.
- Explode = museum plate list, not particles. SVG is flat rects — do not fake per-layer isolation.

## Security
- No wallet, no cookies, no analytics, no third-party scripts, no inline JS.
- CSP in index.html: default-src none; connect-src is `'self'` plus the RPC allowlist.
- Rebuild SVG from rect + hex fills. Drop scripts, urls, foreignObject, event handlers.
- eth_call only. Token ids 1–9999. Do not commit RPC keys.
