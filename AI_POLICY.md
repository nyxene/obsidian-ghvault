# AI Policy

## About this project

GHVault was developed with the assistance of [Claude Code](https://claude.ai/claude-code) (Anthropic). All architecture decisions, code review, testing verification, and quality control were performed by the project maintainer. AI was used as a development tool for implementation, testing, documentation, and security auditing.

Commits authored with AI assistance are marked with the trailer:

```
Co-Authored-By: Nemo <nemo@20000leagues.noreply>
```

## For contributors

We welcome contributions that use AI coding assistants (Claude, Copilot, ChatGPT, Cursor, etc.). The following rules apply.

### You are responsible

If you submit a Pull Request that includes AI-generated or AI-assisted code, documentation, or comments:

- You must **fully understand every line** of code in the submission
- You must be able to **explain the "why"** behind the implementation during code review
- "The AI generated it and it works" is **never an acceptable answer** to a reviewer's question

You bear the same responsibility as if you had written every line by hand.

### Disclosure is required

If AI was used to generate a **significant portion** of a contribution (beyond simple autocomplete or typo correction), you must disclose this in the Pull Request description.

**Good disclosure examples:**

- "Claude Code assisted with the sync engine implementation and test suite"
- "Used Copilot for boilerplate, manually wrote the core logic and edge case handling"
- "ChatGPT helped debug the race condition. I verified the fix and added regression tests"

**Insufficient disclosure:**

- "Used AI"
- No disclosure at all for substantial AI-generated code

**No disclosure needed for:**

- IDE autocomplete suggestions (single line completions)
- Spell checking or grammar fixes
- Looking up API syntax

### Commit attribution

For commits with substantial AI assistance, add a trailer indicating the tool:

```
Assisted-by: Claude Code
```

or

```
Co-Authored-By: <tool-name> <noreply@example.com>
```

### What is NOT allowed

1. **Autonomous AI agents** may not submit Pull Requests without human oversight
2. **Mass AI scanning** of the codebase to find "improvements" without prior context or alignment with the project direction is not welcome
3. **Copy-pasting between AI chatbot and code review** discussions is not acceptable (unless for translation purposes)
4. **AI-generated issues** that lack genuine understanding of the problem or reproduce existing reports

### Code quality expectations

AI-assisted code must meet the same standards as human-written code:

- All CI gates must pass (lint, type-check, test, build)
- Tests must be written for new functionality
- Security-sensitive code (auth, tokens, file operations) receives extra scrutiny
- Code must follow project conventions (see [CONTRIBUTING.md](CONTRIBUTING.md))

### Why this policy exists

AI tools are powerful accelerators for software development. This policy exists to:

- **Maintain code quality** — AI can produce plausible but incorrect code
- **Preserve trust** — contributors and users deserve transparency about how code is written
- **Protect the project** — AI-generated code may inadvertently introduce license or security issues
- **Support reviewers** — knowing AI was involved helps reviewers focus their attention appropriately

## References

- [Mastodon AI Policy](https://github.com/mastodon/.github/blob/main/AI_POLICY.md)
- [Open Source AI Contribution Policies](https://github.com/melissawm/open-source-ai-contribution-policies)
- [DigitalOcean: Contributing AI-Generated Code with Care](https://www.digitalocean.com/community/tutorials/ai-coding-tools-open-source)
