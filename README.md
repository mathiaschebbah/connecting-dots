## Connecting Dots

Connecting Dots est un moteur de signets pour X/Twitter — une poupee russe qui organise automatiquement vos bookmarks en sujets navigables, transformant des centaines de posts sauvegardes a la volee en une bibliotheque thematique vivante ou chaque idee retrouve sa place et ses connexions.

### Le concept

Vous bookmarkez sur X. Connecting Dots s'en occupe : chaque signet est analyse par IA, classe dans un "dot" (un sujet comme Claude Code, RAG, DSPy), et relie semantiquement aux autres. Cliquez sur un dot, retrouvez vos signets. Cliquez sur un signet, lisez-le directement dans X, integre a l'application.

### Comment ca marche

- **Ingestion continue** — L'app poll vos signets X en arriere-plan et les indexe automatiquement
- **Categorisation IA** — Claude Sonnet analyse chaque signet et l'assigne au bon dot avec un resume en francais
- **Resolution de liens** — Les tweets qui ne sont que des liens vers des articles X ou des threads sont resolus : le contenu complet est extrait et indexe
- **Recherche semantique** — Embeddings locaux (all-MiniLM-L6-v2) pour retrouver des signets par le sens, pas juste les mots
- **Navigation integree** — Split-view : vos dots a gauche, le tweet sur X a droite, dans la meme fenetre

### Stack

- **App** : Tauri 2 (Rust + React/TypeScript)
- **DB** : SQLite + sqlite-vec (recherche vectorielle locale)
- **IA** : Claude Sonnet 4.6 (categorisation), fastembed (embeddings locaux)
- **UI** : shadcn/ui, dark theme natif X/Twitter
- **Twitter** : clix (API non-officielle via cookies)

### Navigation

```
Dots (grille de sujets) → Dot (liste de signets) → Tweet (vue X integree)
```

Cmd+K pour rechercher. L'agent IA est accessible depuis la recherche pour poser des questions sur vos signets.

## Licence

MIT
