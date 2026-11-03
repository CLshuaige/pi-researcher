# Research Web

Local web interface for Pi Researcher. Run commands from the repository root.

## Development

```sh
node scripts/setup.mjs
npm --prefix web run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite serves the UI and proxies `/api` to port 3001. The development launcher starts and shuts down both processes.

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

## Layout

- `src/components/`: UI and shared viewers/dialogs/file trees.
- `src/assets/`: brand, illustrations and licensed file icons.
- `shared/`: browser/server types and display errors.
- `server/`: Pi bridge, sessions, configuration and files.
- `tests/`: backend and browser regression tests.
- `scripts/dev.mjs`: development process launcher.

Session records live in `.pi/web/`. Research files live in `workspace/<timestamp>_<name>_<id>/`.

[Quickstart](../README.md) | [Integration](docs/integration.md)
