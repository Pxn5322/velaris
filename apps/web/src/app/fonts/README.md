# Local fonts

These files are self-hosted so `next build` never fetches a font CDN
(ARCHITECTURE D-25). Each file is the latin subset of a variable font, taken
from Google Fonts on 2026-11-03. The licence of each family is in the matching
`OFL-*.txt` file.

| File | Family | Weight range | Style |
| --- | --- | --- | --- |
| `inter.woff2` | Inter | 300..700 | normal |
| `jetbrains-mono.woff2` | JetBrains Mono | 400..700 | normal |
| `jetbrains-mono-italic.woff2` | JetBrains Mono | 400..700 | italic |
| `space-grotesk.woff2` | Space Grotesk | 500..700 | normal |

Source: `https://fonts.googleapis.com/css2?family=<family>&display=swap` with a
modern browser user agent, then the latin `@font-face` block.

To change a family, download the new woff2 file, update `src/app/layout.tsx`
and this table, and keep the licence file with the font.
