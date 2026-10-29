# Pi Calls and Context Handoff

Use ordinary model tool calls to `pi-subagents`. No new extension or globally installed role profiles are needed. These examples target the installed 0.84.0 interface; for other versions, follow the actual tool schema and its `guide`.

## Check Capabilities

Once the user or project instructions authorize this workflow, call `subagents_enable({})` if only that loader is visible. Use `subagent` on the next model request. Activation does not launch a child.

To inspect available roles, call:

```json
{"action":"list","options":{"capabilities":true}}
```

For interface help, call `subagent({ action: "guide", options: { topic: "tool-reference/execution-parameters" } })`. For setup issues, use `subagent({ action: "doctor" })`. Installation alone does not establish that children can search.

Prefer the builtin `delegate` for all three roles. It inherits the parent model by default but does not automatically load the parent's complete history or skills. Supply role instructions through task; Pi agents named IdeaProposerAgent or similar are unnecessary. If the project overrides delegate, check its capabilities and choose an existing agent able to read inputs and return role results.

## Example Call

The following parameters are passed to `subagent`. Replace paths with actual absolute project, skill, and run paths. Include the role prompt body or an exact reference file and section in task.

```json
{
  "agent": "delegate",
  "cwd": "/absolute/project",
  "task": "You are the Proposer for this hypothesis-construction run. Complete only round 1 without spawning children. Read and follow Shared Inputs and Proposer in /absolute/skill/research-hypothesis/references/roles.md. Initial materials are in /absolute/project/research/hypotheses/run-name/context.md. This is round one, with no prior discussion. Return 2–3 complete candidates with their basis, components, and potential value. Write the complete role result only to the assigned output file; do not change shared state or other files.",
  "output": "/absolute/project/research/hypotheses/run-name/round-01-proposer.md",
  "options": {"context":"fresh"}
}
```

The parent creates the run directory before launching. `output` is the runtime file binding; mentioning a filename only in task does not bind it. The child may write its assigned output, or the runtime can save its complete returned text. Use the actual output location returned by the tool and update the handoff list if paths are mapped.

`subagent` is asynchronous by default. A launch receipt is not the final role result. Wait for native completion, read the complete output, and only then execute dependent steps. You can prepare the next task meanwhile, but do not launch a critique that depends on an unfinished proposal. Do not poll or call `bg_wait` for ordinary children. Set `async: false` only when blocking is necessary.

## Materials for Each Role

Fresh `delegate` sessions can serve all roles. Explicit file inputs recreate shared discussion context without relying on automatic broadcasts or retained conversations.

| Call | Required materials | Assigned output |
| --- | --- | --- |
| Round 1 Proposer | context, Proposer prompt | round-01-proposer.md |
| Round 1 Critic | context, current proposal, Critic prompt | round-01-critic.md |
| Round N Proposer | context, all proposals and critiques from rounds 1 through N−1, Proposer prompt | round-NN-proposer.md |
| Round N Critic | context, all prior discussion, current proposal, Critic prompt | round-NN-critic.md |
| Formatter | context, all proposals and critiques, actual round count, Formatter prompt, output contract | formatter.json |

List actual paths in every task rather than asking the child to infer inputs from a directory. The parent reads the Critic's response and routes using the string conditions in SKILL.md, then calls the Formatter separately after the loop. Legacy top-level `chain`, `parallel`, and `tasks` parameters are unnecessary, as is a workflow script.

All three logical roles use the parent model. Do not specify `model` or automatically choose different models. They analyze supplied materials by default; delegate's strict tool allowlist does not include arbitrary retrieval extensions from the environment. When additional checks are needed, the parent uses existing retrieval tools or explicitly delegates them, saves materials, and adds them to shared inputs.

## Research Workspace Integration

Use `research_workspace` to inspect state or capabilities when useful; it is not a prerequisite for hypothesis construction. `research_delegate` is a separate bounded-task interface with different fields, output directories, and `research_finish` handoffs. Do not pass these subagent parameters to it unchanged. Prefer the user's configured `pi-subagents`; no research.json changes are needed.

If subagent tools are unavailable, explain that the three-child workflow cannot run. When the user permits direct work, use the same role sequence and scoring approach while identifying it as a single-session exercise. Preserve completed files and report actual launch failures or missing results; receipts, partial text, and empty files do not establish completion.

Interface references: [pi-subagents tool reference](https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md), [Pi Skills](https://pi.dev/docs/latest/skills).
