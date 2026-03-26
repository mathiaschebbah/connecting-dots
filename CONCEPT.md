# Connecting Dots

Ta timeline Twitter c'est un **flux intersidéral** — des milliers de tweets par jour, du bruit, du spam, des threads géniaux noyés entre deux shitposts. Tu scrolles, tu tombes sur un truc qui te parle, tu bookmarkes. Sauf que :

**Les bookmarks Twitter c'est un cimetière.** Liste chronologique inverse, pas de recherche, pas de dossiers, pas de tags. Tu bookmarkes 20 trucs par jour et tu les revois jamais. C'est un trou noir.

Le vrai problème c'est pas de sauvegarder des tweets — c'est que tu **penses en connexions** et Twitter te donne une **liste plate**. Tu vois un thread sur le RAG, un autre sur les embeddings, un troisième sur les vector DB — dans ta tête ça forme un cluster, un projet, une idée qui émerge. Mais Twitter ne sait rien de ça. Aucun outil pour relier, regrouper, visualiser les patterns.

**Connecting Dots** c'est littéralement ça : un **deuxième cerveau** branché sur Twitter qui :

1. **Capture le signal dans le bruit** — sync tes bookmarks, mais aussi chercher activement sur Twitter
2. **Relie ce que Twitter ne relie pas** — les connexions sémantiques entre tweets, les groupes conceptuels, le graph de connaissances
3. **Te donne les outils pour penser** — kanban pour structurer un projet de veille, network pour voir les clusters d'idées émerger, projets pour organiser par intention
4. **Laisse un agent faire le sale boulot** — "fouille Twitter sur tel sujet, connecte ça avec ce que j'ai déjà" au lieu de scroller pendant 2h

## Pourquoi Rust

Connecting Dots c'est pas une app qui attend que tu cliques sur "Sync". C'est un cerveau automatique.

En arrière-plan, toutes les minutes, des workers parallèles poll ta timeline, tes bookmarks, tes listes, tes mentions — et écrivent tout en base. Chaque tweet est dédupliqué, stocké, embedé, indexé, relié aux autres. Sans intervention humaine. Tu ouvres l'app, tout est déjà là. Les tweets de la dernière heure, organisés, cherchables, connectés.

Le Rust c'est pas un choix cosmétique. C'est le multithreading natif, le zero-cost async avec tokio, la mémoire maîtrisée — pour que ce pipeline tourne en fond sans bouffer tes ressources et sans jamais bloquer l'interface. Ça vit, ça respire, ça tourne. Pas de bouton "Import". Pas de bouton "Sync". Ça marche.

**Twitter est un outil de consommation passive. Connecting Dots en fait un outil de réflexion active.**

## Cas d'usage : Veille technologique pour centres de R&D

Connecting Dots est conçu pour les chercheurs et les centres de R&D qui utilisent X/Twitter comme source de veille. Le pain point : **les tweets pullulent et c'est difficile d'y voir plus clair.** Les annonces se mélangent au bruit, les signaux faibles sont noyés dans la hype.

L'application répond à trois besoins critiques :

1. **Détecter les signaux faibles** — Ce qui va être révolutionnaire avant que tout le monde en parle. Les patterns émergents, les papiers cités par les bonnes personnes, les outils qui apparaissent dans plusieurs conversations indépendantes.

2. **Détecter les tendances industrielles** — Quels sujets montent en puissance, quels clusters de conversation se forment, quelles technologies convergent. Vue macro sur l'évolution du paysage tech et IA.

3. **Dissocier la hype du sérieux** — Un tweet viral n'est pas forcément un signal. L'enrichissement IA classifie chaque post (tutorial, annonce, opinion, meme, alpha...) pour séparer le contenu substantiel du bruit marketing.

### Agents omniprésents

Les agents ne sont pas un add-on — ils sont au cœur de l'architecture. Chaque worker en arrière-plan est un agent spécialisé :
- **Poller** : capture continue des bookmarks, feed, et topics surveillés
- **Enricher** : classification IA de chaque tweet (catégorie, cluster, type, résumé)
- **Link Resolver** : résolution automatique des liens et contenus référencés
- **Agent conversationnel** : fouille sur commande, tagging automatique, monitoring de topics

L'application est **data-intensive** : elle ingère, enrichit, indexe, embed et relie en continu. L'utilisateur ouvre l'app et tout est déjà organisé, cherchable, connecté.

### Vues macro et micro

- **Macro** : Clusters sémantiques, graph de connaissances, tendances par catégorie — pour voir les patterns émerger
- **Micro** : Détail de chaque tweet, thread complet, notes personnelles, tags — pour lire et annoter en profondeur
