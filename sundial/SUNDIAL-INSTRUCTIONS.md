# Sundial Agent Instructions

Sundial is the tool used to manage all persistent memory and decisions for this project.

1. Run `sundial domains` to get the list of known domains.
2. Select all relevant domains for the task.
3. Retrieve accepted DRs with one call: `sundial dr retrieve [--domain <domain>]...`.
 * Repeat `--domain` for each relevant domain. Domain retrieval matches ancestors, the exact domain, and descendants. Excluding all domain flags matches all domains.
4. Indicate to the user which DRs are being applied.

## Domains

`domain` defaults to `all`.

Domains filter DRs. When querying DRs, use one `sundial dr retrieve` call with all relevant domains; all ancestor domains and children for each queried domain are included in the result. `all` is the root of the domain taxonomy.

## Sundial Spec Phase Sessions

When a prompt asks you to use Sundial planning skill/instructions for a `SPEC-*`, treat it as the planning phase. Use the decision-aware-design skill if available, avoid implementing feature code, and only write or run small probes when needed to validate assumptions. Keep the spec's Planned Approach, Rejected Alternatives, Test Plan, and Open Questions current.

When a prompt asks you to use Sundial implementation skill/instructions for a `SPEC-*`, treat it as the implementation phase. Use the decision-aware-implement skill if available, implement the referenced spec end to end where feasible, keep Implementation Log and Test Log current, and report skipped tests with concrete blockers.

When a prompt asks you to use Sundial review skill/instructions for a `SPEC-*`, treat it as the review phase. Use the decision-aware-review skill if available, lead with findings ordered by severity, audit completeness against the spec and applicable DRs, verify testing/security posture, and do not implement fixes unless explicitly asked.

## Sundial Candidate Decision Record Submission

Decison Record discipline: Decision Records record rules that will guide future implementation and design. Any user suggested DR is valid.
DRs should be proposed if a pattern should be remembered and stored for future refernce. Check rejected DRs before proposing new DRs:

`sundial dr list --status rejected`.

Create candidate records through the CLI; do not write candidate markdown files by hand.

```bash
sundial candidate create \
  --title "<candidate title>" \
  --domain "<domain>" \
  --decision "<terse governing guidance>" \
  --pitfalls "<terse governing guidance>" \
  --appendix "<human facing details>" \
  --ref "<path-or-symbol>"
```

The goal of the DR domain system is to do useful filtering while also ensuring all relevant DRs are retrieved in the appropriate context.

Required CLI fields: `title` plus at least one of `decision` or `pitfalls`. A candidate may have either or both.

Decision discipline: Record directives that inform the LLM of the project constraints and decisions. Only record details that the LLM would not immediately infor from its training. Omit generic best practices, framework basics, boilerplate, and speculative detail.

Pitfalls discipline: Similar to decision, but some information is better conveyed as what not to do instead of what to do.  CRITICAL: Pitfalls and Decisions do not repeat each other.  All information should be net-new.

Appendix discipline: For human-facing explanatory context. It is non-governing and short/medium retrieval usually omits it, so do not put agent instructions, applicability, constraints, or hidden requirements there.

Use either `--domain <known-domain>` or `--proposed-domain <domain> "<description>"` when proposing a new domain.

## Sundial Correction Feedback Loop

If you make a mistake and are corrected by the user, either in design, patterns, implementation choices, or structure, consider if this is a one-off correction or if there is a general forward-looking pattern that can be encoded as a decision record. 
