# Agent Instructions

## Version Management

`packages/editor/package.json` owns the Sundial Editor extension version. Increment the patch version for bug fixes and existing-behavior adjustments; increment the minor version when adding or removing user-facing functionality. Major versions require explicit user direction.

## VS Code Integration Tests

`npm test` launches the editor integration suites against one pinned, project-managed runtime in the root `.vscode-test/` cache. The pretest helper downloads that runtime from the official VS Code update service when absent, so tests must not depend on a machine-wide VS Code installation. The test config uses the supported `useInstallation.fromPath` field only to launch this prepared project-cache executable; never replace it with `useInstallation.fromMachine` or a system application path. On macOS the helper verifies the disposable app bundle and, after a checksum-validated fresh download, applies a local ad-hoc signature when Gatekeeper rejects the archive signature. Do not manually clear Gatekeeper attributes or reuse an unverifiable cache.

In a sandboxed Codex session, run `npm test` with `sandbox_permissions: "require_escalated"` on the first attempt because a fresh cache needs network access. Do not first retry it inside the network-restricted sandbox.

<!-- sundial:agent-instructions -->
## Sundial
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

If you make a mistake and are corrected by the user, either in design, patterns, implementation choices, or structure, check for a Decision Record that would have covered that mistake. If no DR exists, propose a new DR candidate to cover it.

## Broad Testing After Major Features

After implementing any major feature, run the broad local regression set before finalizing: `npm run check-types`, `npm run lint`, `npm run test:unit`, and `npm test`. If a suite cannot run in the current environment, report the skipped command and the concrete blocker.
<!-- /sundial:agent-instructions -->
