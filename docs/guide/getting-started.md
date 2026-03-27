# Getting Started

Set up GHVault in under 5 minutes.

## Prerequisites

- An Obsidian vault (desktop or mobile)
- A GitHub account
- A GitHub repository (public or private) to sync with

## Step 1: Create a GitHub token

1. Go to [GitHub Settings → Developer settings → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token**
3. Set a descriptive name (e.g., `ghvault-sync`)
4. Under **Repository access**, select **Only select repositories** and pick your target repo
5. Under **Permissions → Repository permissions**, set:
   - **Contents** — Read and write
   - **Metadata** — Read-only (auto-selected)
6. (Optional) For [Share as Gist](settings.md#share-as-gist) feature, add **Account permissions → Gists — Read and write**
7. (Optional) For [GitHub Pages publishing](publishing.md), add **Repository permissions → Workflows — Read and write**
8. Click **Generate token** and copy it

> **Security note:** The token is stored unencrypted in your vault's plugin data (`data.json`). Use a fine-grained token with minimal scopes. See [Settings → GitHub token](settings.md#github-token) for details.

## Step 2: Install GHVault

### From Community Plugins (recommended)

1. Open **Settings → Community plugins → Browse**
2. Search for **GHVault**
3. Click **Install**, then **Enable**

### Manual install

1. Download the latest release from [GitHub Releases](https://github.com/nyxene/obsidian-ghvault/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/ghvault/`
3. Enable the plugin in **Settings → Community plugins**

## Step 3: Configure

1. Open **Settings → GHVault**
2. Enter your GitHub token
3. Enter the repository owner (your GitHub username or organization)
4. Enter the repository name
5. (Optional) Set a branch (default: `main`) and sync folder
6. Click **Test connection** — you should see "Connected"

## Step 4: First sync

1. Open the command palette (`Ctrl/Cmd + P`)
2. Run **GHVault: Sync**
3. If both the vault and repo have files, GHVault will detect differences and show you what will be pulled/pushed

That's it! Your vault is now syncing with GitHub.

## Next steps

- Enable [Auto-sync](settings.md#auto-sync) for hands-free syncing
- Set up [Conflict resolution](settings.md#conflict-strategy) strategy
- Configure [Workflow dispatch](workflow-dispatch.md) to publish your notes as a website
- Add [Exclude patterns](settings.md#exclude-patterns) to skip specific files
