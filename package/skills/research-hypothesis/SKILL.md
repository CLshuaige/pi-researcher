---
name: research-hypothesis
description: Construct research hypotheses from a task, literature, and existing knowledge through proposal, critique, and evaluation. Use to explore research directions, compare candidates, or revise hypotheses.
---

# Hypothesis Construction

Turn a research task, literature review, and optional knowledge into research candidates. Revise them through a serial Proposer → Critic discussion, then ask a Formatter to evaluate them. The parent ranks, selects, and saves the results. Follow the original three-role workflow without adding reviewers, candidate approval gates, or automatic experiments.

Use Pi's `pi-subagents` extension for the full workflow when the user requests it or project instructions authorize delegation. Handle questions about an individual hypothesis or small revisions directly; loading the skill alone does not start a team. When delegated one role, complete only that role and return without starting this workflow again.

## Prepare Inputs

Read `research/BRIEF.md`, `research/STATE.md`, and user-specified tasks, reviews, knowledge, and existing negative results. Use actual project paths rather than requiring the legacy names `task`, `literature`, and `knowledge`.

- The research task must be clear. Use existing materials when they establish the objective; otherwise establish it first.
- If no literature review is provided, note that and continue. Omit missing optional knowledge. When knowledge contains a `Source Metadata Appendix`, pass only the preceding body to the roles and preserve the original file.
- Record time, data, compute, and technical constraints. The Critic's references to 2–4 weeks and 100 GPU hours are discussion benchmarks, not replacements for the user's constraints.
- Default to `max_debate_iterations = 5` unless the user specifies otherwise. One round consists of one proposal and one critique; the Formatter runs separately after the loop.

The parent creates `research/hypotheses/<run-name>/` for this run, choosing a new name if the directory exists. Write `context.md` with the task, review, optional knowledge, constraints, input paths, and round limit. Children read inputs, return results, and write their assigned outputs without changing the shared objective or state.

Before execution, read [Pi calls and context handoff](references/pi-subagents.md). Use the [role prompts](references/roles.md), and read the [output contract](references/output.md) before finalizing results. Resolve these references relative to this skill directory; write research artifacts in the research project.

## Serial Workflow

The parent controls order, counting, and finalization, starting with `debate_count = 0`. All three logical roles use the same model configuration and differ through their tasks. The builtin `delegate` can serve every role; custom agents with matching role names are unnecessary.

1. **Proposer proposes or revises.** In the first round, generate 2–3 candidates with different directions or risk profiles, explaining their literature basis, scientific value, and implementation components. In later rounds, read all previous discussion, respond to criticism, and revise the candidates. Use the [Proposer prompt](references/roles.md#proposer).
2. **Critic reviews.** Read the complete current proposal and prior discussion. Assess scientific value, time, compute, data, technical difficulties, failure risks, and the lowest-cost validation approach. Return criticism and a routing marker. Use the [Critic prompt](references/roles.md#critic).
3. **Parent routes.** After the Critic completes, increment `debate_count` by 1. End the debate if its response contains `READY` and does not contain `NEEDS_REVISION`, or if the round limit is reached. Otherwise return the feedback to the Proposer for another round. Do not review candidates in parallel or treat READY as approval of an individual candidate.
4. **Formatter evaluates and structures.** Give the third role the initial materials, actual round count, and all proposals and critiques. It retains valuable candidates, evaluates scientific value, novelty, feasibility, and validation clarity, assigns scores from 0 to 1, and returns JSON. Use the [Formatter prompt](references/roles.md#formatter). Run this step after either an early exit or exhaustion of the round limit.
5. **Parent ranks and saves.** Parse the Formatter's `ideas`, sort by descending `score`, select index 0 by default, and save `idea.json` and `idea.md` using the [output contract](references/output.md). Preserve alternatives and discussion. Selection follows the Formatter's scores without an additional filter based on the Critic's marker.

Save complete round outputs as `round-01-proposer.md`, `round-01-critic.md`, and so on, maintaining an ordered file list. Pi children do not automatically receive group chat history. Each task must explicitly include the actual paths to initial materials and all preceding discussion. The Formatter also needs the full discussion, not only the final critique.

Roles discuss supplied materials and do not search or run experiments by default. If the user needs additional literature checks, use the existing `research-literature` skill to collect materials first. Do not present model inference as verified novelty, confirmed data availability, or measured resource use.

## Completion and Handoff

Deliver the selected candidate, score and selection rationale, alternatives, actual round count, and artifact paths. Reaching the round limit still leads to the Formatter. Preserve unresolved criticisms and do not equate the highest score with validation.

When method design is needed, pass the selected content, basis, components, strengths, weaknesses, and task constraints to `research-method`. Continue only when requested by the user or required by the existing workflow. The parent may update the selection and next steps in `research/STATE.md`; children return recommendations only.
