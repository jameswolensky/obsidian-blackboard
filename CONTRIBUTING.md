# Contributing to Blackboard

Thanks for your interest in improving Blackboard. This guide covers the local setup, conventions, and release process.

## Getting started

The project builds and publishes on **Node.js 24** (pinned in `.nvmrc` and `engines`). CI uses Node 24, so develop on it:

```bash
git clone https://github.com/jameswolensky/obsidian-blackboard.git
cd obsidian-blackboard
nvm use        # or: nvm install (reads .nvmrc -> Node 24)
npm install
```

## Build and test

```bash
npm run dev          # watch build
npm run build        # production build (writes main.js)
npm run typecheck    # tsc --noEmit
npm test             # unit tests (Vitest, jsdom)
npm run test:watch   # unit tests in watch mode
npm run check        # typecheck + tests + build (the pre-release gate)
```

`main.js` is a build artifact (git-ignored). It is produced by `npm run build` and attached to GitHub Releases by CI — never commit it.

### iPad / WebKit rendering

Obsidian on iPad runs in Apple WebKit, which the desktop/Electron test runner cannot reproduce (form-control rendering, Pencil/Scribble behavior, safe-area, Canvas pan/zoom). The static harnesses in `test/webkit/` render the UI in a browser or the iOS Simulator's WebKit for manual verification of anything iPad-specific. It requires Xcode and is a manual step, not part of `npm run check`.

## Code style

- Clear naming and small, single-purpose units over cleverness.
- TypeScript strict mode. Avoid `any` except at the Obsidian/browser API boundary.
- Comments are limited to **JSDoc on exported APIs** and concise **"why" notes for non-obvious platform workarounds** (the WebKit/iPad quirks). Don't add comments that restate the code.
- Tests use Vitest. New behavior should come with a test; prefer focused tests that each verify one thing.

## Project structure

Hexagonal (ports-and-adapters) layout:

```
src/
  main.ts                          # Plugin entry point, commands, lifecycle
  domain/                          # Pure logic, no Obsidian/DOM dependencies
    entities.ts                    # Data model, settings, validation
    geometry.ts                    # Geometry helpers (fit transform, distances)
    ports.ts                       # Interfaces (e.g. IDrawingRepository)
    stroke-manager.ts              # Stroke storage and undo/redo
    tool-manager.ts                # Tool / color / size state
  application/                     # Use cases and services
    use-cases/create-drawing.ts
    use-cases/export-svg.ts
    file-format.ts                 # Serialize/deserialize .blackboard JSON
    eraser-service.ts
    export-service.ts              # Content bounds + SVG export
  infrastructure/                  # Adapters to Obsidian/browser APIs
    canvas-renderer.ts             # DrawingEngine (two-layer canvas rendering)
    obsidian-drawing-repository.ts # Vault file I/O
  presentation/                    # UI + Obsidian view integration
    blackboard-view.ts             # View for .blackboard files
    embed.ts                       # Live-editable embeds (Canvas + Markdown)
    embed-size.ts                  # Markdown |WxH size parsing
    canvas-integration.ts          # Canvas card embedding + insert/fit commands
    surface-manager.ts             # Tracks the active drawing surface
    drawing-surface.ts             # Surface interface the toolbar drives
    global-toolbar.ts              # Shared floating toolbar
    toolbar-icons.ts               # Inline SVG icons
    settings.ts                    # Settings tab
    input-debug.ts                 # Optional on-screen input diagnostics
test/
  *.test.ts                        # Unit tests (Vitest, jsdom)
  webkit/                          # Manual iPad-WebKit rendering harness
```

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, written in the imperative mood.

Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`. Example:

```
fix(embed): clip strokes to the node boundary
```

Keep the summary under ~72 characters; put detail in the body.

## Pull requests

1. Branch from `main`.
2. Add or update tests for your change.
3. Ensure `npm run check` passes.
4. Keep the PR focused — one feature or fix.
5. Fill in the PR template and link any related issue.

PRs are squash-merged, so the PR title becomes the commit on `main` — make it a good Conventional Commit.

## Releasing

Releases are automated from `main`:

```bash
npm run release:patch   # 0.10.3 -> 0.10.4
npm run release:minor   # 0.10.3 -> 0.11.0
npm run release:major   # 0.10.3 -> 1.0.0
```

Each command runs `npm run check`, bumps `package.json` then `manifest.json` and `versions.json` in lockstep, commits as `release: <version>`, tags the version (no `v` prefix), and pushes — which triggers the **Release** workflow. The workflow re-validates that the tag matches the manifest version, runs the check, builds `main.js`, and publishes a GitHub Release with `main.js`, `manifest.json`, and `styles.css` attached.

Always release from an up-to-date `main`. Never hand-edit `versions.json`/`manifest.json` or tag a detached commit.
