---
description: "Perform a non-destructive cross-artifact consistency and quality analysis across spec.md, plan.md, and tasks.md after task generation."
argument-hint: <optional arguments passed to the skill>
---
Read and execute the instructions in `.claude/skills/speckit-analyze/SKILL.md` exactly as written.

That file is the single owner of this workflow — this command only points at it, so an edit there needs no change here.

If the user provided arguments, substitute them wherever the skill expects input.

User arguments: $ARGUMENTS
