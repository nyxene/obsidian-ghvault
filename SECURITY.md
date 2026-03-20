# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in GHVault, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email the maintainer at the address listed in the GitHub profile, or use [GitHub Security Advisories](https://github.com/nyxene/obsidian-ghvault/security/advisories/new)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 7 days
- **Fix or mitigation:** within 30 days for critical/high severity

## Security Model

GHVault is an Obsidian plugin that syncs vault files with GitHub. Key security considerations:

### Token Storage

GitHub PAT is stored as plaintext in `data.json` via Obsidian's `plugin.saveData()`. This is an Obsidian platform limitation — no secure keychain API is available. Mitigations:

- UI warning advising fine-grained PATs with minimal scopes
- Password-type input field (masked)
- "Forget token" button for quick revocation
- Token never logged or displayed in UI
- Token redacted from error messages and log files

### Data Integrity

- SHA integrity verification on every pulled file (git blob SHA comparison)
- Path traversal protection on all file operations (`isSafePath()`)
- ZIP bomb protection (500MB decompressed size limit)
- API response schema validation

### Logging

- Secrets automatically redacted from logs via `SECRET_PATTERN` regex
- Error strings truncated to 500 characters to prevent information leakage
- Log file (`ghvault.log`) excluded from sync to GitHub

## Previous Audits

- **OWASP Top 10 audit** completed (2 MEDIUM, 5 LOW findings — all resolved)
- **2 security hardening passes** (OWASP v1 + v2) during development

## Dependencies

GHVault has **one runtime dependency**: `fflate` (MIT license, zero transitive dependencies) for ZIP decompression. All other dependencies are build-time only.
