# Connecting Dots

Tu bookmarkes des dizaines de tweets par jour. Le problème, c'est que tu ne les retrouves jamais.

Connecting Dots prend tes signets X et les range automatiquement par sujet. Claude Code dans un dossier, RAG dans un autre, Cursor dans un troisième. Clique sur un sujet, retrouve tes signets. Clique sur un signet, lis-le directement dans X sans quitter l'app.

C'est une poupée russe : tes signets, organisés en sujets, navigables, cherchables.

## Installation

```bash
# Prérequis : Rust, Node.js, clix (Twitter CLI)
git clone https://github.com/mathiaschebbah/connecting-dots.git
cd connecting-dots
npm install
npm run tauri dev
```

Au premier lancement, l'app te demande ta clé API Anthropic. Tes signets sont ensuite synchronisés et classés automatiquement.

## Licence

MIT
