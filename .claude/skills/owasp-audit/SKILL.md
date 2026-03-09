---
description: Perform full OWASP Top 10 security audit of the codebase
disable-model-invocation: true
---

Launch a dedicated security agent to perform a full OWASP Top 10 audit of the codebase.

The agent MUST:

1. **Read ALL source files** in `src/` directory — every `.ts` file without exception
2. **Read `package.json`** for dependency analysis
3. **Analyze each file** against all OWASP Top 10 categories:

## OWASP Top 10 Checklist

### A01:2021 — Broken Access Control
- Path traversal in file operations (read/write/delete)
- Missing authorization checks
- Privilege escalation vectors
- CORS misconfigurations

### A02:2021 — Cryptographic Failures
- Plaintext storage of secrets (tokens, keys, passwords)
- Weak or missing encryption
- Hardcoded credentials
- Insecure random number generation

### A03:2021 — Injection
- Command injection via user inputs
- XSS through unsanitized content
- Template injection
- SQL/NoSQL injection (if applicable)
- Log injection

### A04:2021 — Insecure Design
- Missing rate limiting
- Missing input validation
- No size limits on uploads/downloads
- Race conditions in async operations
- Missing mutex/locks on shared state

### A05:2021 — Security Misconfiguration
- Debug features left enabled
- Default credentials
- Unnecessary features enabled
- Missing security headers
- Overly permissive error messages

### A06:2021 — Vulnerable and Outdated Components
- Known vulnerable dependencies (check package.json)
- Outdated packages with security patches
- Unnecessary dependencies increasing attack surface

### A07:2021 — Identification and Authentication Failures
- Token handling and storage
- Token leakage in logs, errors, URLs
- Session management issues
- Brute-force protection

### A08:2021 — Software and Data Integrity Failures
- Insecure deserialization (JSON.parse without validation)
- State corruption from tampered data
- Missing integrity checks on loaded data
- Code injection through deserialized objects

### A09:2021 — Security Logging and Monitoring Failures
- Insufficient logging of security events
- Sensitive data in logs
- No log rotation/size limits
- Missing audit trail for critical operations

### A10:2021 — Server-Side Request Forgery (SSRF)
- User-controlled URLs in API calls
- URL construction from unsanitized inputs
- DNS rebinding vulnerabilities

## Output Format

For each finding produce:

```
### Finding N — [Short Title]

**Severity:** CRITICAL | HIGH | MEDIUM | LOW | INFO
**OWASP Category:** A0X:2021 — [Name]
**File:** `path/to/file.ts`, line NN
**Description:** [What the vulnerability is and why it matters]
**Exploit scenario:** [How an attacker could exploit this]
**Recommended fix:** [Specific code change or approach]
```

## Final Summary

End with a table:

| # | Severity | OWASP | Finding | File |
|---|----------|-------|---------|------|

And a prioritized action list: what to fix first (blockers for release) vs. what can wait.

## Important Notes

- This is an Obsidian plugin (desktop + mobile). Consider the threat model: the user owns the vault, but the GitHub repo could be shared/compromised.
- Be thorough but practical — flag REAL risks, not theoretical ones impossible in this context.
- Check for issues ALREADY FIXED — if a previous audit finding has been addressed, note it as RESOLVED.
- DO NOT write or edit any files. This is a READ-ONLY audit.
