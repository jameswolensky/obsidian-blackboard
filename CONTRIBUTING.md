# Contributing to Blackboard

Thanks for your interest in improving Blackboard. This guide covers local setup, conventions and the release process.

## Getting started

The project builds and publishes on Node.js 24 (pinned in `.nvmrc`, and `engines` requires 24 or later). CI reads `.nvmrc`, so develop on the same version:

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
npm run typecheck    # tsc --noEmit --skipLibCheck
npm run lint         # eslint src (eslint-plugin-obsidianmd)
npm test             # unit tests (Vitest, jsdom)
npm run test:watch   # unit tests in watch mode
npm run check        # typecheck + lint + tests + build (the pre-release gate)
```

`main.js` is a build artifact (git-ignored). It is produced by `npm run build` and attached to GitHub Releases by CI. Never commit it.

### iPad

Obsidian on iPad runs in Apple WebKit, which the desktop test runner can't reproduce (Pencil and Scribble behavior, safe areas, Canvas pan and zoom). Check anything iPad-specific on a real iPad before opening a PR.

## Code style

- Clear naming and small, single-purpose units over cleverness.
- TypeScript strict mode. Avoid `any` except at the Obsidian/browser API boundary.
- Comments are JSDoc on exported APIs and short notes on why for anything non-obvious (WebKit and iPad quirks, Obsidian internals). Don't add comments that restate the code.
- Tests use Vitest. New behavior should come with a test; prefer focused tests that each verify one thing.

## Project structure

Hexagonal (ports and adapters) layout:

```
src/
  main.ts                          # Plugin entry point, commands, lifecycle
  domain/                          # Pure logic, no Obsidian/DOM dependencies
    entities.ts                    # Data model, settings, validation
    geometry.ts                    # Geometry helpers (fit transform, distances)
    ports.ts                       # Interfaces (IDrawingRepository)
    stroke-manager.ts              # Stroke storage and undo/redo
    tool-manager.ts                # Tool / color / size state
  application/                     # Use cases and services
    use-cases/create-drawing.ts
    use-cases/export-svg.ts
    document-store.ts              # One shared document per drawing, used by every open view
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
    canvas-integration.ts          # Canvas node mounting + the insert commands
    surface-manager.ts             # Tracks the active drawing surface
    drawing-surface.ts             # Surface interface the toolbar drives
    global-toolbar.ts              # Shared floating toolbar
    toolbar-icons.ts               # Inline SVG icons
    settings.ts                    # Settings tab
  dev/                             # Dev-build-only helpers
    dev-bridge.ts                  # Pushes dev builds to a device and reads back toolbar audits
    input-debug.ts                 # On-screen input event log for stylus debugging
  types/
    obsidian-internals.ts          # Types for undocumented Obsidian APIs (Canvas)
test/
  *.test.ts                        # Unit tests (Vitest, jsdom)
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
4. Keep the PR focused: one feature or fix.
5. Fill in the PR template and link any related issue.

PRs are squash-merged, so the PR title becomes the commit on `main`. Make it a good Conventional Commit.

## Releasing

Releases are automated from `main`:

```bash
npm run release:patch   # 1.3.2 -> 1.3.3
npm run release:minor   # 1.3.2 -> 1.4.0
npm run release:major   # 1.3.2 -> 2.0.0
```

Each command runs `npm run check`, bumps `package.json` then `manifest.json` and `versions.json` in lockstep, commits as `release: <version>`, tags the version (no `v` prefix), and pushes, which triggers the Release workflow. The workflow checks that the tag matches the manifest version and has a `versions.json` entry, runs `npm run check` (which builds `main.js`), and publishes a GitHub Release with `main.js`, `manifest.json` and `styles.css` attached.

Always release from an up-to-date `main`. Never hand-edit `versions.json` or `manifest.json`, and never tag a detached commit.
