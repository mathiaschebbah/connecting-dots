# Connecting Dots

Tu bookmarkes des dizaines de tweets par jour. Le probleme, c'est que tu ne les retrouves jamais.

Connecting Dots prend tes signets X et les range automatiquement par sujet. Claude Code dans un dossier, RAG dans un autre, Cursor dans un troisieme. Clique sur un sujet, retrouve tes signets. Clique sur un signet, lis-le directement dans X sans quitter l'app.

C'est une poupee russe : tes signets, organises en sujets, navigables, cherchables.

## Installation

```bash
# Prerequisites: Rust, Node.js, clix (Twitter CLI)
git clone https://github.com/mathiaschebbah/connecting-dots.git
cd connecting-dots
npm install
npm run tauri dev
```

Au premier lancement, l'app te demande ta cle API Anthropic. Tes signets sont ensuite synchronises et classes automatiquement.

## Licence

MIT
