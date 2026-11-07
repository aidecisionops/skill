# Decision Register Format

Use this structure for entries in `docs/decision-register.md` or the repository's chosen register path.
It applies to both product and technical decisions.

## Entry Template

```markdown
## DR-YYYYMMDD-HHMM-short-slug: Decision title
- Date: YYYY-MM-DD
- Status: Accepted
- Related: <optional file paths, ticket IDs, URLs>

### Context
Problem statement, constraints, and why a decision is needed now.

### Options Considered
- Option A
- Option B

### Decision
Chosen option and enough implementation detail for future contributors.

### Consequences
- Positive impact
- Tradeoff or operational cost
```

## Authoring Rules

- Use one canonical register file per repository.
- Record product and technical decisions in the same register to preserve sequencing and rationale.
- Keep titles concise and specific.
- Explain tradeoffs, not just outcomes.
- Add `Related` links when code paths, incidents, tickets, or benchmarks exist.
- Update status to `Superseded` when later decisions replace older entries.
