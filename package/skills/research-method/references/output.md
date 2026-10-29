# Outputs and Execution Handoff

These file conventions retain the original method object's main fields. They are not a Pi tool protocol or the engine's plan.json format. The legacy Python classes and Markdown regex parser are unnecessary.

## Formatter Output

The Formatter saves complete JSON as `formatter.json` in the run directory. The method object is at the top level, without an ideas wrapper or candidate list. This example shows one step to illustrate the fields; actual step counts follow the method.

```json
{
  "overview": "Explain the research objective, main hypothesis, experimental design, controls, and interpretation.",
  "steps": [
    {
      "step_id": "S1",
      "description": "Inspect existing data and prepare inputs using predefined rules. Record provenance, splitting, and leakage checks. Completion requires a readable data inventory and inspection record.",
      "assignee": "Engineer",
      "dependencies": [],
      "expected_output": "A data inventory and inspection record identifying scope, sample counts, splitting rules, and discovered issues."
    }
  ],
  "execution_order": ["S1"],
  "assignments": {
    "Engineer": ["S1: Prepare experimental inputs and record inspection results"],
    "RA": []
  },
  "resources": {
    "data": "Existing data locations, access conditions, and information needing confirmation",
    "compute": "Computing environment, expected requirements, and budget",
    "time": "Overall timeline and estimated workload by task type",
    "tools": "Existing tools, environments, and prerequisites"
  },
  "criticisms": ["Important criticism, adopted compromises, and unresolved issues from discussion"],
  "debate_rounds": 1
}
```

`overview` is a string and `steps` is a list of steps. Each step's `step_id`, `description`, `assignee`, and `expected_output` are strings; `dependencies` is an array of step IDs. `execution_order` lists step IDs in execution order. `assignments` maps Engineer and RA to arrays of task strings. `resources` is an object describing resources, `criticisms` is an array of strings, and `debate_rounds` is the actual number of completed Critic rounds.

Put completion requirements in `description` or `expected_output` without adding a separate `success_criteria` field. Include concrete environments and commands when known; identify unknowns rather than inventing commands or resources to fill the plan. Distinguish correct experimental execution from support for the hypothesis.

## Parent Results

The parent reads Formatter output, saves the method object as `method.json`, and generates `method.md` for executors. Do not score or rank methods, or add approval states, method versions, or a final review.

Include in `method.md`:

- The task, hypothesis source, method overview, and input paths.
- Experiment–hypothesis relationships, baselines and controls, measurement, and interpretation rules; add data splits, reproducibility, and error explanations as appropriate to the field.
- Every step's ID, description, execution role, dependencies, expected outputs, and completion requirements.
- Execution order, Engineer/RA task summaries, data, tools, compute, and time.
- Execution scope, existing environment, known execution approach, acceptance evidence, budget, and stopping conditions.
- Actual debate rounds, whether READY or the round limit ended discussion, and important criticism and limitations.

Link detailed criticism to `method.json` and round reviews, keeping the structured design and readable method consistent. When the project uses `PLAN.md` or the user requests that filename, also generate an entry pointing to this complete method rather than maintaining conflicting plans.

If Formatter output cannot be parsed or no actual method was produced, preserve raw output and discussion, report incomplete generation, and do not fabricate steps or execution results.

## Handoff to Experiment Execution

When the user requests execution, pass `method.md` and required inputs to the existing `research-experiment` skill. Do not execute steps during design or describe `execution_order` and `dependencies` as completed scheduling.

For engine use, read [engine integration and recovery](../../../docs/engine.md) and prepare `method.md` inside the assigned experiment output directory. Material locations must resolve correctly from that directory: prefer actual absolute paths or state the base for relative paths. Do not generate or overwrite the engine's `experiments/plan.json` or `progress.json` during method design.

The current engine reads method.md and creates its own `{id,title,description,instructions}` execution plan. Do not write the method JSON above directly as its plan.json or claim that assignee automatically dispatches Engineer agents or human RAs. For manual steps, identify required people, actions, and expected artifacts in the handoff for the downstream workflow and user to arrange.
