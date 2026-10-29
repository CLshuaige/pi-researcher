---
name: research-method
description: Design experimental methods, execution steps, and role assignments from a research task, hypotheses, and existing knowledge through planning, critique, and synthesis. Use for method design and experimental feasibility assessment.
---

# Method Design

Turn a research task, hypotheses, and optional knowledge into experimental methods. Revise through a serial Planner → Critic discussion, then ask a Formatter to synthesize steps, order, resources, and role assignments. Follow the original three-role workflow without adding version locks, independent final review, or execution scheduling.

Use Pi's `pi-subagents` extension for the full workflow when the user requests it or project instructions authorize delegation. Handle individual controls, metrics, or small revisions directly. When delegated one role, complete only that role and return without starting this workflow again.

## Prepare Inputs

Read `research/BRIEF.md`, `research/STATE.md`, and user-specified research tasks, hypothesis files, and optional knowledge. Check the data, code, environment, and compute described in existing materials. Use actual paths rather than requiring the legacy names `task`, `idea`, and `knowledge`.

- The research task must be clear. Use existing materials when they establish the objective; otherwise establish it first.
- The upstream hypothesis file is usually `research/hypotheses/<run-name>/idea.md`. Supply the entire Markdown, including `[SELECTED]` and alternatives, for the Planner to interpret. Do not additionally require hypothesis IDs or version locks.
- If no hypothesis file is available, note `No idea available` and continue from the task. A hypothesis supplied directly by the user is also valid input.
- Omit missing optional knowledge. If it contains a `Source Metadata Appendix`, pass only the preceding body to the roles and preserve the original file.
- This stage does not require a separate literature review. Its basis primarily comes through hypotheses and knowledge. Include other materials explicitly requested by the user.
- Record actual time, data, compute, tools, and technical constraints. Respect a specified `max_debate_iterations`; this skill defaults to 5 otherwise. One round consists of one plan and one critique; the Formatter runs separately after the loop.

The parent creates `research/methods/<run-name>/`, choosing a new name if the directory exists. Write `context.md` with the task, complete hypotheses, optional knowledge, resource constraints, input locations, and round limit. Children read materials, return designs, and write assigned outputs without changing shared state, implementing code, or running experiments.

Before execution, read [Pi calls and handoff](references/pi-subagents.md). Use the [role prompts](references/roles.md), and read [outputs and execution handoff](references/output.md) before calling the Formatter and finalizing. Resolve references relative to this skill directory; write artifacts in the research project.

## Serial Workflow

The parent controls order and counting, starting with `debate_count = 0`. The three logical roles use the same model configuration and differ through their tasks. The builtin `delegate` can serve all roles; custom agents with matching names are unnecessary.

1. **Planner plans or revises.** Read the task, complete hypotheses, and knowledge. Design experiments that can support or refute the hypothesis, explaining baselines, controls, measurement, steps, dependencies, and interpretation. Prioritize scientific validity, then adjust cost and scope in response to criticism. Use the [Planner prompt](references/roles.md#planner).
2. **Critic reviews.** Read the complete current plan and prior discussion. Examine step clarity, tool and resource availability, technical difficulties, failure risks, and scientific validity. Return revision suggestions and a routing marker. Use the [Critic prompt](references/roles.md#critic).
3. **Parent routes.** After the Critic completes, increment `debate_count` by 1. End the debate if its response contains `READY` and does not contain `NEEDS_REVISION`, or if the round limit is reached. Otherwise return the criticism to the Planner for another round. Do not plan experiments in parallel.
4. **Formatter synthesizes and structures.** Give the third role the initial materials, all plans and critiques, and actual round count. It combines the Planner's design and the Critic's simplification suggestions into complete method JSON. It may adjust the design during synthesis, without an extra final review or candidate scoring. Use the [Formatter prompt](references/roles.md#formatter). Run this step after either an early exit or exhaustion of the round limit.
5. **Parent saves the method.** Read the Formatter JSON and save `method.json` and `method.md` following the [output contract](references/output.md). Preserve raw output and all discussion. Completing method design does not mean experiments are complete.

Save complete round outputs as `round-01-planner.md`, `round-01-critic.md`, and so on. Every call explicitly supplies `context.md` and actual paths to all prior discussion. File handoffs provide the shared context of the original group chat. The Formatter also needs all plans and critiques, not only the final comment.

Design roles analyze supplied materials by default without searching, implementing, or testing the method. State assumptions and gaps when resource information is missing. Do not present tool availability, expected runtime, or resource estimates as verified. The parent can collect additional materials when the user needs further checks.

## Completion and Downstream Handoff

Deliver the method overview, steps and order, Engineer/RA assignments, resources, key criticisms, actual round count, termination reason, and artifact paths. The Formatter also runs after the round limit; preserve unresolved comments without adding approval states.

Engineer covers code, data processing, analysis, automation, and technical validation. RA covers annotation, interviews, subjective evaluation, or manual experiments requiring a person. These are execution assignments in the method, not children to launch here; they do not establish available personnel or completed tasks.

When the user requests experiments, pass `method.md` and relevant inputs to `research-experiment`. For engine use, follow [engine integration](../../docs/engine.md) and prepare `method.md` in the assigned experiment directory, describing file boundaries, environment, execution approach, acceptance evidence, and stopping conditions. Reuse a suitable existing environment. Do not automatically call `engine_start` during design or perform RA steps on behalf of a person. The parent may update the method and next steps in `research/STATE.md`.
