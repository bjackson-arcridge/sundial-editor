---
name: decision-aware-review
description: Use during review of non-trivial changes
---

# decision-aware-review

Before using Sundial, locate and read `sundial/SUNDIAL-INSTRUCTIONS.md` from the project root and follow its shared workflow guidance.

Use Sundial through the CLI from the project root. Keep updates short and cite governing DR ids only if substantial findings.

- Review should audit implementation completeness, testing performed or missing, security/privacy risks, and adherence to applicable DRs.
- Do not implement fixes during review unless the user explicitly asks. Running commands, inspecting code, and small local probes to validate review claims are appropriate.

Optional spec-driven review:
- Use when our active worktree corresponds to a spec or when the user asks for review of a `SPEC-*`, when an existing `SPEC-*` is the working context.
- Keep the spec current by appending concise review outcomes, test evidence, skipped tests, or unresolved questions to Test Log or Open Questions.
