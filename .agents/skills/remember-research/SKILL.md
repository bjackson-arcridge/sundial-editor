---
name: remember-research
description: Use in Codex after research for a bug fix or feature to store detailed API signatures, parameters, protocol details, and other facts future agents are likely to hallucinate or misremember.
---

# remember-research

Use this skill after doing concrete research that should remain available to future Codex runs but is too long or specific for a Decision Record.

Research is stored as Markdown under `sundial/research/`. Research shares the same `domain` vocabulary as Decision Records, but it is reference material rather than governing guidance.

## When To Store Research

Store research when it captures specific facts a future model could get wrong, including API signatures, supported parameters, return shapes, protocol details, CLI flags, framework constraints, migration notes, error text, or version-specific behavior.

Do not store generic best practices, broad summaries that would fit better as a DR, speculation, or facts that were not actually verified.

Research notes record only findings and unknowns. Do not include recommendations, next steps, implementation plans, design implications, or governing rules.

## File Format

Create or update a Markdown file in `sundial/research/` with frontmatter:

```markdown
---
id: RES-0001
title: Short descriptive title
domain: cli
summary: One or two sentences describing the research and when to load it.
created: 2026-07-07
updated: 2026-07-07
---

## Research

Long-form findings, unknowns, exact signatures, examples, constraints, and citations or file references.
```

Use the next available `RES-####` id. Keep `summary` to one or two sentences; it is shown in list views beside decisions. Put the detailed material in the body so agents must actively open the research file before relying on it.

## Workflow

1. Run `sundial domains` and choose the narrowest relevant domain.
2. Check existing files in `sundial/research/` for related material before creating a new record.
3. Write specific, sourced findings and unknowns in the body. Include local file references, official docs URLs, command output context, or dates when they matter.
4. Tell the user which research file you created or updated.
