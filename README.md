# The Watch

Unofficial fan player for the on-chain Argonauts. Not affiliated with ACK or Muse Facktory. Art and copyright stay with ACK / Muse Facktory.

This repo is a **player**. It does not store 9,999 PNGs. Frames are read live from Ethereum `tokenURI` and cached in your browser. It is not a scoring tool and not a flip helper.

Harbor: [argonauts.musefacktory.com](https://argonauts.musefacktory.com)

## Now

**Play**, **Strip**, and **Draw**.

The assembled plate is **4 physical inches**. Click **Play** / **Pause**. **Strip** lists the traits; click it again to reassemble. Click a worn trait to open a **2×2 inch** isolation on the right. **None** is not clickable. Print opens that Argonaut on Harbor.

Play walks 1→9999 and wraps. If you let it run the whole fleet without jumping, the join shows ACK’s line: **There is only serve the Muse**. No Discord interstitial.

**Draw** plots the current Argonaut rect by rect. Press **Draw** again to pause, again to resume. **Reset** restarts the plot. **Play** leaves Draw and resumes the slideshow. **Sheet** (after speed) downloads a 24×24 graph-paper PDF. `D` enters Draw.

## Run locally

Do not rely on double-clicking `index.html`. Browsers treat `file://` as a special origin and often block the Ethereum RPC calls this player needs.

From this directory:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. Click **Play**. Space toggles play. Arrow keys step; in Strip they move the plate highlight (`E` strip, `Esc` reassemble).

## Privacy and GitHub

This is a static site. It sends `eth_call` to public Ethereum RPCs (token id + contract). It does not connect a wallet, set cookies, or load analytics. Browser cache (IndexedDB) stays on that machine. Do not commit `.env`, Alchemy/Infura keys, or screenshots you do not want public.

### Host on GitHub Pages (free)

Hobby project on the **ArgoWatch** GitHub account. Pages is enough: HTML/CSS/JS, no backend, no build step. Free Pages needs a public repo.

On the repo: **Settings → Pages** → Deploy from a branch → `main` / **(root)**. Site:

`https://argowatch.github.io/the-watch/`

`.nojekyll` is in the tree so Pages does not run Jekyll. Relative paths (`lib/`, `data/`) work on that URL.

Public RPCs can rate-limit a public origin. If playback stalls, add a free Alchemy/Infura HTTPS URL later **and** add that origin to the CSP in `index.html`. Do not commit keys.

## Contract

- Collection: [`0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C`](https://etherscan.io/address/0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C)
- `tokenURI(uint256)` → `data:application/json;base64,…` with an SVG `image`
- `traitsOf(uint256)` → `uint8[7]` (snapshot in `data/traits.bin`; Take apart reads it)
- Current renderer is read from `renderer()` on the collection. It is not hardcoded. ACK can call `setRenderer`.

Public RPCs are used first (Cloudflare, PublicNode, and a short fallback list). If playback rate-limits, add a free Alchemy/Infura HTTPS URL later **and** add that origin to the CSP in `index.html`. Do not commit keys.

## Trait snapshot (run once)

`traitsOf` is fixed per id. Fetch once and commit the file. Do not put RPC keys in the repo.

```bash
node scripts/fetch-traits.mjs
```

Optional: `RPC_URL=https://your-free-endpoint.example node scripts/fetch-traits.mjs`

Writes `data/traits.bin` (69,993 bytes: 9999 × 7), `data/labels.json` (slot names), and `data/meta.json` (contract, block). Uses at most 25 `eth_call`s via Multicall3.

`traitsOf` is designed to freeze. The **renderer** can still change (`setRenderer`) — Watch always reads live `tokenURI`, so art does not need a dump. If ACK writes the trait table again, or adds something like a burned/fate field, the snapshot goes stale.

Check for drift (samples live `traitsOf` against the file):

```bash
node scripts/check-traits.mjs
```

The player also compares the current id when Watch first loads and when Take apart opens. If they disagree it says to re-run the fetch. There is **no** nightly GitHub Action that re-pulls 9,999 `tokenURI`s — that burns minutes and hammers RPCs. Re-fetch by hand after ACK actually changes the table.

## What this is not

No wallet, no prices, no rarity badges, no backend. Hosting is GitHub Pages when you publish.
