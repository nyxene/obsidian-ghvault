# 096 — Add missing utils unit tests and coverage gaps

**Issue:** #96
**Branch:** `test/96-utils-coverage-gaps`
**Scope:** utils

---

## Goal

Close direct test coverage gaps in `utils/binary.ts`, `utils/base64.ts`, and `utils/hash.ts` identified by QA audit. Currently these modules have 0% direct coverage (binary.ts), 71% function coverage (base64.ts), and 50% branch coverage on `computeHashFromBuffer` (hash.ts).

---

## Current State

- `binary.ts` — no dedicated test file; `hasBinaryContent()` and `toSafeArrayBuffer()` only tested indirectly via pull/push tests
- `base64.ts` — `arrayBufferToBase64()` and `base64ToArrayBuffer()` added in #93 but never tested directly
- `hash.ts` — `computeHashFromBuffer` branch (Uint8Array vs ArrayBuffer input) at 50% branch coverage

---

## Plan

### 1. New file: `src/utils/binary.test.ts`

**`hasBinaryContent()` tests:**
- null byte at position 0 → true
- null byte at position 4095 (mid-range) → true
- null byte at position 8191 (last checked byte) → true
- null byte at position 8192 (beyond scan limit) → false
- empty Uint8Array → false
- all non-zero bytes (text-like content) → false
- single-byte buffer [0x00] → true
- single-byte buffer [0x41] → false

**`toSafeArrayBuffer()` tests:**
- standard Uint8Array → returns matching ArrayBuffer
- Uint8Array with non-zero byteOffset (subarray of larger buffer) → returns correct slice
- empty Uint8Array → returns empty ArrayBuffer

### 2. Extend: `src/utils/base64.test.ts`

- `arrayBufferToBase64` round-trip with `base64ToArrayBuffer` → bytes match
- empty ArrayBuffer → empty string → empty ArrayBuffer
- binary data with null bytes → correct encoding/decoding
- known value: ArrayBuffer of "hello" → known base64 string

### 3. Extend: `src/utils/hash.test.ts`

- `computeHashFromBuffer(Uint8Array)` produces same hash as `computeHash(string)` for same content
- `computeHashFromBuffer(ArrayBuffer)` produces same hash as above
- empty input → consistent hash
- binary data with null bytes → produces valid hex hash

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/utils/binary.test.ts` |
| Modify | `src/utils/base64.test.ts` |
| Modify | `src/utils/hash.test.ts` |

---

## Acceptance Criteria

- [ ] All new tests pass
- [ ] `binary.ts` has 100% statement + branch coverage
- [ ] `base64.ts` function coverage ≥ 95%
- [ ] `hash.ts` branch coverage on `computeHashFromBuffer` = 100%
- [ ] No source code modifications
- [ ] All gates pass (lint, type-check, test, build)
