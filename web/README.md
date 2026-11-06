# Research Web

Local web interface for Pi Researcher. Run commands from the repository root.

## Development

```sh
node scripts/setup.mjs
npm --prefix web run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite serves the UI and proxies `/api` to port 3001. The development launcher starts and shuts down both processes.

Copy `.env.example` to `.env` and set your own ports so you never attach to a teammate's instance:

```sh
cp .env.example .env
# edit .env: API_PORT (backend), VITE_DEV_PORT (frontend), VITE_DEV_API (proxy target)
```

`npm run dev` reads the repository-root `.env`; shell-exported variables still take precedence.

For an isolated test environment:

```sh
npm --prefix web run dev:test
```

Open [http://127.0.0.1:3003](http://127.0.0.1:3003). The test UI proxies `/api` to its own API on port 3004, preserving the browser-facing Host for same-origin checks. Frontend changes use Vite hot updates; backend and research extension changes automatically reload the test API without a manual restart. Reloading the API interrupts any running test research. Test sessions and workspaces live in `.pi/web-test/`, separate from the normal server. Model/auth settings are copied once to `.pi/web-test/agent/`; later test configuration changes stay there. Use `GEWU_TEST_CLIENT_PORT`, `GEWU_TEST_API_PORT`, `GEWU_TEST_DATA_DIR`, `GEWU_TEST_WORKSPACE_DIR`, and `GEWU_TEST_AGENT_DIR` to override these defaults. Both environments still share repository source and the normal build output; this is runtime-data isolation, not a separate code deployment.

## Build

```sh
npm --prefix web run build
npm --prefix web start
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). One server now serves both the built UI and API.

## Research boards (Web only)

New Web research enables an independent Presentation session. The host sends changed stage identity, user research questions and a project file inventory to this session; Research and CLI sessions do not load its Extension or Skill. The designer browses and reads actual workspace files, including paginated text/PDF and existing research figures. Each role uses its own theme color and icon; the generated sheet grows naturally with its content. Checklist content is only a short fallback before a board is published. The right inspector initially shows the nodes and research activity, with artifacts collapsed. Drag or scroll in either direction to pan the canvas; use +/- or pinch to zoom. Use the stage arrows to navigate; the resource trees remain below each board.

Historical research is read-only until you click **生成展板**. Generated HTML replaces the current `.pi/presentation/stages/<stage>/index.html` inside that research workspace; there are no version directories. Snapshots, the manifest and independent Pi session records also live under `.pi/presentation/`. A separate model call uses the project's selected model when meaningful stage content changes, with a debounce and a minimum update interval; token-by-token chat updates do not trigger design calls. The previous board stays visible while updating or after a failure. Fullscreen preserves the node width from the inspector. Style-only updates can publish a CSS delta, preserving existing figures and content. Failed display runs can continue from their own presentation transcript; only relevant stage files and actually used materials trigger redraws. **更新展板** retries the display only.

The display uses only its explicitly loaded `presentation-design` Skill and `presentation_list` / `presentation_read` / `presentation_publish` tools. Workspace materials are untrusted data. HTML is sanitized and rendered in a sandbox without same-origin privileges; only the host's bridge updates factual bindings and opens validated source previews. Closing/hiding the inspector or browser view cancels pending work. Research pause, stop, branch retry, project deletion and host shutdown cancel display work; invalidated jobs cannot publish into the new branch. Display errors never change Checklist or research messages.

## Layout

- `src/components/`: UI and shared viewers/dialogs/file trees.
- `src/assets/`: brand, illustrations and licensed file icons.
- `shared/`: browser/server types and display errors.
- `server/`: Pi bridge, sessions, configuration and files.
- `tests/`: backend and browser regression tests.
- `scripts/dev.mjs`: development process launcher.

Session records live in `.pi/web/`. Research files live in `workspace/<timestamp>_<name>_<id>/`.

[Quickstart](../README.md) | [Integration](docs/integration.md)
