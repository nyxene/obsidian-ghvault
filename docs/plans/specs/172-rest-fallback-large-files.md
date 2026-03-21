# 172 — REST fallback for files >1.5MB

**Issue:** #172
**Date:** 2026-03-21
**Status:** APPROVED
**Branch:** feat/172-rest-fallback-large-files

## Objective

Push files 1.5–50MB via REST Git Data API instead of skipping them.

## Approach

Split uploads into graphqlFiles (<=1.5MB) and restFiles (1.5–50MB).
GraphQL first (fast batch), then REST for large files using new HEAD.

REST flow per batch:
1. createBlob() for each file → blob SHAs
2. getTree() current tree → base tree SHA
3. createTree(baseTree, new entries) → new tree SHA
4. createCommitRest(tree, parent, message) → commit SHA
5. updateRef(branch, commitSha) → branch updated

## Tasks

- [ ] GitHubClient: createBlob(), createTree(), createCommitRest(), updateRef()
- [ ] PushEngine: REST fallback path
- [ ] Tests: client, push
- [ ] README: update limitations

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
