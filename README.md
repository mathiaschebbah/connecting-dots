## Connecting Dots

Plateforme de veille technologique et sociale active pour centres de R&D, branchée sur X/Twitter.

Transforme le flux chaotique de tweets en un **moteur de pensée structuré** où chaque post s'inscrit dans un nuage conceptuel, permettant de naviguer efficacement dans les courants de la recherche, de la pensée et de la créativité communautaire.

### Le problème

Les tweets pullulent et c'est difficile d'y voir plus clair. Les signaux faibles sont noyés dans la hype, les tendances émergentes sont invisibles sans outils adaptés.

### La solution

- **Capture automatique** — Workers en arrière-plan qui poll bookmarks, feed et topics en continu
- **Enrichissement IA** — Chaque tweet est classifié (catégorie, cluster, type, résumé) par des agents IA
- **Connexions sémantiques** — Embeddings locaux + graph de similarité pour relier ce que Twitter ne relie pas
- **Détection de signaux** — Dissociation hype/sérieux, détection de tendances, clustering émergent

### Architecture

- **Backend** : Rust (Tauri) — workers async tokio, SQLite + sqlite-vec, fastembed (all-MiniLM-L6-v2)
- **Frontend** : React 19 + TypeScript — Zustand, TanStack Query, Tailwind CSS, react-force-graph
- **IA** : Claude API pour l'enrichissement et l'agent conversationnel

### Vues (Lenses)

| Lens | Usage |
|------|-------|
| **River** | Flux chronologique avec recherche fulltext/sémantique |
| **Clusters** | Groupement par thème IA — vue macro des tendances |
| **Graph** | Réseau de similarité — visualiser les connexions |
| **Boards** | Kanban pour structurer des projets de veille |

### Agents

Les agents sont omniprésents : poller, enricher, link resolver, et agent conversationnel. L'application est data-intensive — ingestion, enrichissement, indexation et connexion en continu.

## Licence

MIT
