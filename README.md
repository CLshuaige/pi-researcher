# Pi Researcher

## Requirements

- Node.js 22.19+ and Pi 1.4.0
- Python 3 with `venv` for Python experiments
- XeLaTeX and BibTeX for PDF reports

## Quickstart

Run from the repository root.

```sh
node scripts/setup.mjs
```

### CLI

Configure a model and credentials in `~/.pi/agent/`, then run:

```sh
pi install ./package
pi
```

```text
/research Compare uncertainty estimates from Gaussian processes and random forests.
/research pause
/research resume
```

`/researcher` is an alias for `/research`.

### Web

Set model credentials in `.env` or the Web settings. Edit `.pi/agent/models.json` to change providers and models.

```sh
npm --prefix web run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and send a research question.

For a built version:

```sh
npm --prefix web run build
npm --prefix web start
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001).

## Workflow

Task scoping, literature review, hypotheses, method design, experiments, reports, and peer review, selected as needed. Progress and acceptance are tracked in `checklist.json`.

Each session gets a timestamped directory under `workspace/`. Experiment code lives in `experiment/<project>/src/`, with a separate `.venv` per project. Missing `ensurepip` is handled automatically; pip setup needs network access and may require curl behind a proxy. GPU experiments require compatible drivers.

[CLI details](package/README.md) | [Web details](web/README.md)
