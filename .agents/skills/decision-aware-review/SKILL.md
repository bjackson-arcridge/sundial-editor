---
name: decision-aware-review
description: Use in Codex during review of non-trivial changes or Sundial SPEC review phases to audit DR alignment, completeness, testing, and security without taking over implementation.
---

# decision-aware-review

Use Sundial through the CLI from the project root. Keep updates short and cite governing DR ids.

1. Run `sundial domains`.
2. Select all relevant domains for the task, then retrieve accepted DRs with one call:
   `sundial dr retrieve [--domain <domain>]...`
   * Repeat `--domain` for each relevant domain. Domain retrieval matches ancestors, the exact domain, and descendants. Excluding all domain flags matches all domains.
3. State which DRs apply, or state that none matched.

Optional spec-driven review:
- Use a spec when the user asks for review of a `SPEC-*`, when an existing `SPEC-*` is the working context, or when the change is large enough that completeness needs to be checked against a plan.
- Read the spec's Discovery, Applicable Decision Records, Planned Approach, Rejected Alternatives, Test Plan, Open Questions, Implementation Log, and Test Log before judging completeness.
- Review should audit implementation completeness, testing performed or missing, security/privacy risks, and adherence to applicable DRs.
- Lead with findings ordered by severity and include concrete file/line references when available; keep summaries brief and secondary.
- Do not implement fixes during review unless the user explicitly asks. Running commands, inspecting code, and small local probes to validate review claims are appropriate.
- Keep the spec current by appending concise review outcomes, test evidence, skipped tests, or unresolved questions to Test Log or Open Questions.
---
<Do the Review>
---
4. Only propose a DR candidate when the review establishes guidance that would change how a future agent acts on a similar task. Skip candidates for one-off findings, backward-facing rationale, obvious codebase facts, or details that would not constrain future design or implementation.
