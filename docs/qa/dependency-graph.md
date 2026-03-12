# Module Dependency Graph

Visual map of GHVault's internal module dependencies. Use this to understand blast radius of changes and plan testing scope.

## How to read

- **Arrows** show import direction: `A --> B` means A imports from B
- **Subgraphs** group modules by layer
- **Leaf nodes** (no outgoing arrows) are pure utilities — safe to refactor in isolation

## Graph

```mermaid
graph TD
    subgraph UI["UI Layer"]
        main[main.ts]
        settings[settings.ts]
    end

    subgraph Sync["Sync Layer"]
        engine[sync/engine.ts]
        pull[sync/pull.ts]
        push[sync/push.ts]
        comparator[sync/comparator.ts]
        state[sync/state.ts]
        vaultadapter[sync/vault-adapter.ts]
    end

    subgraph GitHub["GitHub API"]
        client[github/client.ts]
        graphql[github/graphql.ts]
        ratelimit[github/rate-limit.ts]
        reqtimeout[github/request-timeout.ts]
    end

    subgraph Utils["Utils"]
        base64[utils/base64.ts]
        concurrency[utils/concurrency.ts]
        hash[utils/hash.ts]
        pathutil[utils/path.ts]
        logger[utils/logger.ts]
    end

    types[types.ts]

    %% UI Layer
    main --> settings & engine
    main --> client & graphql & ratelimit
    main --> pull & push & state & vaultadapter
    main --> logger & types

    settings --> types & pathutil

    %% Sync Layer
    engine --> pull & push & state & comparator
    engine --> logger & types

    pull --> client & state & comparator
    pull --> concurrency & hash & logger & pathutil & types

    push --> graphql & state
    push --> base64 & hash & logger & pathutil & types

    comparator --> types & pathutil

    state --> types

    vaultadapter --> engine & comparator
    vaultadapter --> concurrency & hash & pathutil

    %% GitHub API
    client --> ratelimit & reqtimeout
    client --> base64 & logger & types

    graphql --> ratelimit & reqtimeout
    graphql --> logger & types

    ratelimit --> types
    reqtimeout --> types

    %% Utils (leaves)
    logger --> types
    pathutil --> types
```

## Change Impact Matrix

When you modify a module, re-test everything that depends on it:

| Module changed | Re-test |
|----------------|---------|
| `types.ts` | Everything |
| `utils/logger.ts` | engine, pull, push, client, graphql, main |
| `utils/path.ts` | settings, pull, push, comparator, vault-adapter |
| `utils/hash.ts` | pull, push, vault-adapter |
| `utils/base64.ts` | push, client |
| `utils/concurrency.ts` | pull, vault-adapter |
| `github/rate-limit.ts` | client, graphql |
| `github/request-timeout.ts` | client, graphql |
| `github/client.ts` | pull, main |
| `github/graphql.ts` | push, main |
| `sync/state.ts` | engine, pull, push, main |
| `sync/comparator.ts` | engine, pull, vault-adapter |
| `sync/pull.ts` | engine, main |
| `sync/push.ts` | engine, main |
| `sync/vault-adapter.ts` | main |
| `sync/engine.ts` | vault-adapter, main |
| `settings.ts` | main |
| `main.ts` | E2E tests only |
