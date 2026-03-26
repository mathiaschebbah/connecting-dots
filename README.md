<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Connecting Dots">
</p>

<h1 align="center">Connecting Dots</h1>

<p align="center">
  A second brain plugged into Twitter/X.
  <br>
  Automatically organizes your bookmarks into thematic clusters using AI.
</p>

<p align="center">
  <a href="https://github.com/mathiaschebbah/connecting-dots/releases">
    <img src="https://img.shields.io/github/v/release/mathiaschebbah/connecting-dots?style=flat-square" alt="Latest release">
  </a>
  <a href="https://github.com/mathiaschebbah/connecting-dots/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/mathiaschebbah/connecting-dots?style=flat-square" alt="License">
  </a>
</p>

---

Connecting Dots syncs your X/Twitter bookmarks and uses Claude AI to sort them into **dots** — focused topic clusters like `llm-agents`, `rag`, or `claude-code`. It learns from your corrections over time, so classification keeps getting better.

<p align="center">
  <img src="docs/screenshot.png" width="800" alt="Connecting Dots screenshot">
</p>

## Features

- **In-app X login** — log in to X directly in the app, no browser dependency or token to paste
- **AI-powered classification** — Claude groups bookmarks into fine-grained thematic dots with summaries and tags
- **Built-in browser** — browse X directly in the app, bookmarks are classified on the fly
- **Adaptive learning** — when you move a bookmark to a different dot, the app records the correction and adjusts future classification
- **Full-text search** — find any bookmark by content, author, or topic
- **100% local** — everything runs on your machine, nothing leaves your computer except API calls to Anthropic

## Requirements

- An X/Twitter account
- An [Anthropic API key](https://console.anthropic.com/)

## Download

Grab the latest installer for your platform from the [Releases](https://github.com/mathiaschebbah/connecting-dots/releases) page:

| Platform | Format |
|----------|--------|
| macOS    | `.dmg` |
| Windows  | `.exe` (NSIS installer) |
| Linux    | `.deb`, `.AppImage` |

> **Note:** The app is not code-signed. On macOS, run `xattr -cr "/Applications/Connecting Dots.app"` after installing. On Windows, click "More info" then "Run anyway" on the SmartScreen prompt.

## Development

```bash
# Prerequisites: Rust (1.77+), Node.js (18+)
git clone https://github.com/mathiaschebbah/connecting-dots.git
cd connecting-dots
npm install
npm run tauri dev
```

### Tech stack

| Layer    | Stack |
|----------|-------|
| Frontend | React, TypeScript, Tailwind CSS, Zustand |
| Backend  | Rust, Tokio, SQLite |
| AI       | Anthropic Claude API |
| Framework| Tauri 2 |

## License

[MIT](LICENSE)
