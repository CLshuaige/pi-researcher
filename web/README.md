# Research Web

Local web interface for Pi Researcher. Run commands from the repository root.

## Development

```sh
node scripts/setup.mjs
npm --prefix web run dev
```

Open <http://127.0.0.1:5173>. Vite serves the UI and proxies `/api` to port 3001. The development launcher starts and shuts down both processes.

## Build

```sh
npm --prefix web run build
npm --prefix web start
```

Open <http://127.0.0.1:3001>. One server now serves both the built UI and API.

## Layout

- `src/components/`: UI and shared viewers/dialogs/file trees.
- `src/assets/`: brand, illustrations and licensed file icons.
- `shared/`: browser/server types and display errors.
- `server/`: Pi bridge, sessions, configuration and files.
- `tests/`: backend and browser regression tests.
- `scripts/dev.mjs`: development process launcher.

Session records live in `.pi/web/`. Research files live in `workspace/<timestamp>_<name>_<id>/`.

[Quickstart](../README.md) | [Integration](docs/integration.md)
