# Bug Issue Template

Used by the QA agent to file confirmed bugs via `scripts/github.sh`.

## Command

```bash
scripts/github.sh issue-create "<type>(<scope>): <description>" -l bug -b "<body>"
```

## Qualifying criteria

A finding qualifies as a **bug** ONLY if ALL of these are true:

1. Code produces **wrong result** — incorrect state, wrong return value, data corruption, skipped validation
2. Bug is **confirmed by reading code** — not a hypothesis, a concrete file:line with flawed logic
3. There is a **reproducible scenario** — describable in steps

### Does NOT qualify as a bug

- Missing test coverage → that's `debt`
- Weak assertions in tests → that's `debt`
- Performance inefficiency → that's `debt`
- Missing feature → that's a feature request, not QA scope

## Body template

```markdown
## Bug: [short description of incorrect behavior]

### Affected code
`src/<path>:<lines>` (`ClassName.methodName()`)

### Current behavior
[What the code actually does — be specific, reference lines]

### Expected behavior
[What the code should do instead]

### Steps to reproduce
1. [Concrete setup step]
2. [Action that triggers the bug]
3. [Observable incorrect result]

### Impact
- **Severity:** critical | high | medium | low
- **Risk:** [What breaks for the user or system]
- **Scope:** [How often / under what conditions this triggers]

### Found by
QA audit — Direction N ([direction name]), finding #M
```

## Severity guide

| Level | Meaning | Example |
|-------|---------|---------|
| critical | Data loss or corruption in normal flow | Cache writes wrong SHA, file overwritten silently |
| high | Wrong behavior, workaround exists | Filtered files get stale cache entries |
| medium | Edge case with incorrect result | Empty input causes crash instead of no-op |
| low | Minor incorrectness, cosmetic | Wrong error message text |