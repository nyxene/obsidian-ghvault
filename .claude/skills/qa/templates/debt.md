# Technical Debt Issue Template

Used by the QA agent to file tech debt findings via `scripts/github.sh`.

## Command

```bash
scripts/github.sh issue-create "<type>(<scope>): <description>" -l debt -b "<body>"
```

## Qualifying criteria

A finding qualifies as **debt** if:

1. Code **works correctly** but is fragile, untested, slow, or hard to maintain
2. The risk is **development/scaling** pain, not user-facing breakage
3. Finding is **concrete** — specific files, specific gaps, not vague "should be better"

### Categories that map to debt

| QA Direction | → Debt when |
|--------------|-------------|
| Coverage Gaps | 0% coverage on critical module, untested safety filters |
| Test Quality | Mocks hide real bugs, missing negative cases |
| Performance | O(n²) in hot path, sequential I/O that should be parallel |
| User Scenarios | Important flow has no test at all |
| E2E / Integration | No integration-level wiring test |

## Body template

```markdown
## Debt: [short description]

### Affected code
`src/<path>` (+ related files if grouped)

### Current state
[What exists today — be specific about what's missing or weak]

### Risk
[Why this matters — what breaks if left unfixed]
- Regression risk: [high | medium | low]
- Blast radius: [what areas are affected]

### Suggested scope
- [Concrete item 1]
- [Concrete item 2]
- [Concrete item 3]

### Found by
QA audit — Direction N ([direction name]), findings #M, #K, #L
```

## Grouping rules

**Group related findings into one issue** — do NOT create one issue per finding.

| Grouping key | Example |
|-------------|---------|
| By module | All coverage gaps in `src/sync/` → one issue |
| By theme | All missing negative-case tests → one issue |
| By fix scope | Gaps that would be fixed in the same PR → one issue |

A single debt issue should contain 2-8 related findings. If a finding is standalone and significant, it can be its own issue.