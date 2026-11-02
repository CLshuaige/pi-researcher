# Web and Pi integration

The HTTP host owns browser sessions, file access and SSE snapshots. Pi owns research execution, commands, steering and cancellation. Ordinary user questions are stored without command prefixes; the bridge activates `/research` internally. Explicit controls use the commands endpoint without creating chat bubbles.

Each session has one timestamped Workspace. The UI reads native Checklist modules and existing artifacts, and previews share one component across file cards, the tree and workflow branches. Rename pauses require an idle session and no active managed jobs; runtime paths are rebased with the directory.

Research settings are validated and materialized into Workspace `.pi/research-modules.json`. User preferences and model credentials have separate endpoints. Both settings views use the same dialog shell.

See [quickstart](../../README.md).
