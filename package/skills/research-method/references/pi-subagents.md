# Pi Calls and Context Handoff

Reuse the user's configured `pi-subagents` through ordinary model tool calls. These examples target the installed 0.84.0 interface; for other versions, follow the actual schema and `guide`. No extension or global agent configuration changes are needed.

## Check Capabilities

Once the user or project instructions authorize this workflow, call `subagents_enable({})` if only that loader is visible. Use `subagent` on the next model request. Activation itself does not launch a role.

Inspect available agents when needed:

```json
{"action":"list","options":{"capabilities":true}}
```

For interface help, use `subagent({ action: "guide", options: { topic: "tool-reference/execution-parameters" } })`. For setup issues, use `subagent({ action: "doctor" })`.

The builtin `delegate` can serve all three logical roles. It inherits the parent model by default and receives role prompts through task. Pi agents named MethodPlannerAgent, MethodCriticAgent, and MethodFormatterAgent are unnecessary. If the project overrides delegate, check actual capabilities and select an existing agent able to read materials and return role results.

## Example Call

The following parameters are passed to `subagent`. Replace project, skill, and run paths with actual absolute paths. The parent creates the run directory before launching.

```json
{
  "agent": "delegate",
  "cwd": "/absolute/project",
  "task": "You are the Planner for this method-design run. Complete only round 1 without spawning children. Read and follow Shared Inputs and Planner in /absolute/skill/research-method/references/roles.md. Initial materials are in /absolute/project/research/methods/run-name/context.md. This is round one, with no prior discussion. Return a complete experimental design with baselines, controls, measurement, steps, dependencies, Engineer/RA assignments, expected outputs, and resources. Only design; do not implement or run experiments. Write the complete role result only to the assigned output file; do not change shared state or other files.",
  "output": "/absolute/project/research/methods/run-name/round-01-planner.md",
  "options": {"context":"fresh"}
}
```

`output` is the file binding; mentioning a filename only in task does not bind it. The child writes its assigned output or returns complete text for runtime persistence. Read the actual output location returned by the tool and update the handoff list if paths are mapped.

Default asynchronous calls return a launch receipt. Wait for native completion before reading results and starting the next role. You can prepare later tasks meanwhile, but do not critique an unfinished plan. Do not poll or call `bg_wait` for ordinary children. Set `async: false` only when blocking is necessary.

## Materials and Call Order

Pi child sessions do not automatically broadcast group chat messages. Use fresh delegate sessions with explicit initial materials and discussion files to provide the original workflow's shared context.

| Call | Required materials | Assigned output |
| --- | --- | --- |
| Round 1 Planner | context, Planner prompt | round-01-planner.md |
| Round 1 Critic | context, current plan, Critic prompt | round-01-critic.md |
| Round N Planner | context, all plans and critiques from rounds 1 through N−1, Planner prompt | round-NN-planner.md |
| Round N Critic | context, all prior discussion, current plan, Critic prompt | round-NN-critic.md |
| Formatter | context, all plans and critiques, actual round count, Formatter prompt, output contract | formatter.json |

List actual file paths in every task, not just a directory. The parent reads the Critic's response and applies the text routing in SKILL.md, then calls the Formatter separately after the loop. Legacy top-level `chain`, `parallel`, and `tasks` parameters are unnecessary, as is a workflow script.

All roles use the parent model, so no `model` override is needed. The builtin delegate does not automatically inherit every extension tool. This workflow only requires reading supplied materials and returning designs, without search tools, engine, or execution agents. Roles do not automatically resume previous runs. Reruns use new artifact directories; history participates only when explicitly supplied as input.

## Research Workspace Integration

Use `research_workspace` to inspect state or capabilities when useful; it is not a mandatory design stage. `research_delegate` is a different bounded-task interface with different inputs, output directories, and `research_finish` handoffs. Do not mix its parameters with these calls. This workflow requires no research.json changes.

If subagent tools are unavailable, explain that the three-child workflow cannot run. When the user permits direct work, use the same role sequence while identifying it as a single-session design. Preserve existing plans and critiques when a launch fails or complete results are missing. Report the actual failure rather than treating a successful launch as a completed method.

Interface references: [pi-subagents tool reference](https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md), [Pi Skills](https://pi.dev/docs/latest/skills).
