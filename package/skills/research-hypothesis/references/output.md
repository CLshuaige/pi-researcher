# Output Contract

These are this skill's file conventions, not a builtin Pi tool protocol. Other skills need no changes, and the legacy Python classes are not required.

## Formatter Output

The Formatter saves complete JSON to `formatter.json` in the run directory. The top-level `ideas` array contains candidates with the following fields. This example shows the shape of one entry; actual candidates follow the discussion.

```json
{
  "ideas": [
    {
      "content": "Complete hypothesis or research proposal, including expected observations and validation ideas",
      "score": 0.8,
      "basis": "Scientific basis and locations in literature or existing results; identify inferences",
      "components": ["Main implementation component or step"],
      "strengths": ["Strength in scientific value, novelty, or validation"],
      "weaknesses": ["Resource risk, evidence limitation, or unresolved issue"],
      "round": 1
    }
  ]
}
```

`content` and `basis` are strings. `components`, `strengths`, and `weaknesses` are arrays of strings. `score` is a number from 0 to 1. `round` identifies when the candidate appeared in discussion, starting at 1. Preserve stable source identifiers or local material locations; temporary search cache IDs are not evidence references.

## Parent Results

The parent reads the Formatter JSON and sorts candidates by descending `score`, preserving the Formatter's order for ties. Save the ranked result as `idea.json`:

```json
{
  "candidates": [],
  "selected_index": 0,
  "debate_rounds": 3
}
```

Populate `candidates` with the actual ranked candidate objects. The empty array only illustrates the field; it is not a successful deliverable. Set `debate_rounds` to the actual number of completed Critic rounds rather than copying the example. Select the highest score by default with `selected_index = 0`. Do not add approval states, candidate versions, or score thresholds.

Also generate `idea.md` with at least:

- The research objective, input locations, and actual round count.
- All candidates ranked by descending score, with `[SELECTED]` in the first heading.
- Each candidate's content, score, basis, components, strengths, weaknesses, and round of appearance.
- Selection rationale, remaining limitations, and whether READY or the round limit ended the discussion.

If Formatter output cannot be parsed or contains no actual candidates, report incomplete generation. Preserve discussion and raw output rather than inventing a selected hypothesis.

## Downstream Use

Method design uses the complete `candidates[selected_index]` content together with the task and constraints in `context.md`. The highest score represents selection within this discussion; it does not establish verified novelty, measured resources, or experimental validation. Retain rejected alternatives and criticism in the run directory for later reference.

Do not additionally create fixed-number `Hxxx.md` files unless the project already uses that convention. In that case, the parent may place the selected result in the corresponding file and link to this run's `idea.md`.
