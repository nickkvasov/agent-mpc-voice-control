---
description: "Execute the implementation planning workflow using the plan template to generate design artifacts."
argument-hint: <optional arguments passed to the skill>
---
Read and execute the instructions in `.claude/skills/speckit-plan/SKILL.md` exactly as written.

That file is the single owner of this workflow — this command only points at it, so an edit there needs no change here.

If the user provided arguments, substitute them wherever the skill expects input.

User arguments: $ARGUMENTS
