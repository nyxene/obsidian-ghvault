# Workflow Dispatch Guide

Automatically trigger a GitHub Actions workflow every time GHVault pushes changes to your repository.

## What is this?

When you edit notes in Obsidian, GHVault pushes them to GitHub. With workflow dispatch enabled, GHVault also sends a signal to GitHub saying "new content is ready." Any GitHub Actions workflow listening for that signal will run automatically.

This is the foundation for **publishing your vault as a website** — or any other automation you want to run when your notes change.

## Use cases

| Use case | Workflow tool | Result |
|----------|--------------|--------|
| Publish as website | [Quartz](https://quartz.jzhao.xyz/), [MkDocs](https://www.mkdocs.org/), [Hugo](https://gohugo.io/) | Notes become a live website on GitHub Pages |
| Backup | `tar` + upload to S3/R2 | Off-site backup on every push |
| Notifications | Slack/Discord webhook | Get notified when vault changes |
| Custom CI | Any script | Lint, validate, or process your notes |

## Step 1: Create a workflow file

In your GitHub repository, create `.github/workflows/deploy.yml` (or any name):

### Example: Quartz (static site from Markdown)

```yaml
name: Deploy vault to GitHub Pages

on:
  repository_dispatch:
    types: [vault-synced]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Build Quartz
        run: |
          npx quartz build --directory .

      - uses: actions/upload-pages-artifact@v3
        with:
          path: public

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### Example: Simple notification

```yaml
name: Notify on vault sync

on:
  repository_dispatch:
    types: [vault-synced]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send to Discord
        env:
          WEBHOOK: ${{ secrets.DISCORD_WEBHOOK }}
        run: |
          PUSHED='${{ toJSON(github.event.client_payload.pushed) }}'
          curl -X POST "$WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "{\"content\": \"Vault synced: ${PUSHED}\"}"
```

## Step 2: Enable in GHVault settings

1. Open **Settings → GHVault**
2. Scroll to **Integrations**
3. Turn on **Trigger workflow on push**
4. Set **Event type** to match the `types` value in your workflow file (default: `vault-synced`)

## Step 3: Verify

1. Make a change to any note in your vault
2. Run **GHVault: Sync** (or wait for auto-sync)
3. Go to your repository on GitHub → **Actions** tab
4. You should see a new workflow run triggered by `repository_dispatch`

## Payload

GHVault sends the following data with each dispatch event, available as `github.event.client_payload` in your workflow:

| Field | Type | Description |
|-------|------|-------------|
| `branch` | string | Branch that was pushed to |
| `pushed` | string[] | List of files that were created or modified |
| `deleted` | string[] | List of files that were deleted |
| `commitOid` | string | Git commit SHA of the push |

### Using payload in a workflow

```yaml
steps:
  - name: Show changed files
    run: |
      echo "Branch: ${{ github.event.client_payload.branch }}"
      echo "Pushed: ${{ toJSON(github.event.client_payload.pushed) }}"
      echo "Deleted: ${{ toJSON(github.event.client_payload.deleted) }}"
      echo "Commit: ${{ github.event.client_payload.commitOid }}"
```

## Token permissions

Repository dispatch requires the **Contents: Read and write** permission on your token, which is the same permission needed for syncing. No additional token scopes are required.

## Troubleshooting

**Workflow doesn't run:**
- Check that the event type in settings matches `types: [...]` in your workflow file exactly
- Verify the workflow file is committed to the default branch
- Go to repo → Actions → check if workflows are enabled

**Workflow runs but fails:**
- This is a workflow issue, not a GHVault issue — check the Actions logs on GitHub
- Ensure your workflow has the correct `permissions` block

**"Repository dispatch failed" notice in Obsidian:**
- Check your token has Contents: Read and write permission
- The dispatch is non-blocking — your sync still completed successfully
