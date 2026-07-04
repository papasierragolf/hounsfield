# Marketing assets

Screenshots used for the App Store listing and social posts (LinkedIn/Substack).

```
marketing/
  screenshots/
    app/     raw app screenshots — drop straight into a post or article
    store/   composed device-framed tiles with headline copy, for App Store listing use
  generate.mjs   regenerates everything above
README.md        this file
```

The live, editable template behind the `store/` tiles is
[`public/marketing/store-tile.html`](../public/marketing/store-tile.html) — it's served by
the Vite dev server (so its embedded iframe can script the real app into a specific
screen/theme before the shot), and is driven entirely by URL query params:

```
/marketing/store-tile.html?headline=Radiology+AI.&accent=Fully+on+your+device.
  &sub=MedGemma+1.5+4B+runs+locally+via+Apple+MLX.&bg=light&tab=studies&ready=1
```

| Param      | Values                                   | Meaning                              |
|------------|-------------------------------------------|---------------------------------------|
| `headline` | text                                       | Plain first line                      |
| `accent`   | text                                       | Colored (terracotta) second line      |
| `sub`      | text                                       | Subhead paragraph                     |
| `bg`       | `light` \| `dark`                          | Marketing canvas background           |
| `tab`      | `studies` \| `settings` \| `study` \| `capture` | Which app screen the phone shows |
| `ready`    | `1`                                        | Cosmetically show "MedGemma · mlx" as loaded |

## Regenerating

```bash
npm run dev              # terminal 1 — dev server must be running
node marketing/generate.mjs   # terminal 2
```

`generate.mjs` seeds two synthetic demo studies (procedurally-drawn placeholder
X-ray/CT graphics, sample report text) into IndexedDB, captures the raw app
screenshots and the three store tiles as real PNGs, then clears the demo data back
out — your own studies are never touched (a separate Chrome profile is used).

To add a new tile, add an entry to the `TILES` array at the bottom of `generate.mjs`
with new `headline`/`accent`/`sub`/`bg`/`tab` params — no HTML changes needed.

Uses `playwright-core` (devDependency) driving your system's installed Google Chrome
via the `channel: 'chrome'` option — no extra browser binary download.
