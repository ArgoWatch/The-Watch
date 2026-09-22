# The Watch

Unofficial fan player for the on-chain Argonauts. Not affiliated with ACK or Muse Facktory. Art and copyright stay with them.

**Site:** [argowatch.github.io/The-Watch](https://argowatch.github.io/The-Watch/)

Official collection: [Harbor](https://argonauts.musefacktory.com)

## Use

- **Play** walks the fleet. Hover the picture (or tap it on a phone) for controls; they fade after 3s. Hover Play / Strip / Draw for paths; on a phone, tap Play. Clicking a path starts it from the lowest id. The title returns to the start of the current path.
  - Fleet is ids 1–9999.
  - Unclothed has no Cloak, Relic, Sight, Artifact, or Crown.
  - Cloak is exactly a cloak among the worn slots.
  - Relic is exactly a relic among the worn slots.
  - Sight is exactly a sight among the worn slots.
  - Artifact is exactly an artifact among the worn slots.
  - Crown is exactly a crown among the worn slots.
- **Crew** sits with Play / Strip / Draw. Click Crew to show only the address field (Ossen’s as the example). **+** adds another wallet; **×** on a row drops that wallet (the last one resets). Crew flashes with a building ellipsis while holdings load; the strip fills as each Argo is confirmed. **−** hides Crew chrome; **×** leaves Crew but remembers the show — Crew toggles the chrome or restores the last crew. **Suit Up** is simplest-to-most-worn; **Themes** ‹ › plays the next echo; **As Minted** is id order; **As Received** is first inbound per holding; drag (or two taps on a phone) the strip for As Arranged. × under a well leaves that Argo in the show. The same addresses are remembered in the browser for about 30 minutes, and only when the pull matches `balanceOf`. A copied Crew URL includes the token list (`hold=`), so the person opening it gets the same show even if their browser’s log scan is slower. The title returns to the start of the current show.
- **Strip** lists traits. Click a worn piece to isolate it. Print opens that Argonaut on Harbor.
- **Draw** paints the picture pixel by pixel. **Sheet** downloads 24×24 graph paper.

## Run locally

Do not open `index.html` as a file. The player has to talk to Ethereum.

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

## Contract

[`0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C`](https://etherscan.io/address/0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C). Pictures are read live from the chain. No wallet, no prices, no analytics.
