# DeepSeek V4.1 Flash Migration Design

## Objective

Replace the unavailable legacy DeepSeek model selections with the exact,
currently routable model ID `deepseek-v4.1-flash` for both the QA assistant
and approval-checklist suggestions, then deploy through the repository's
approved GitHub Actions production path.

## Configuration design

The two services continue to use environment variables as their highest
priority:

- `HDMS_QA_MODEL` controls the QA assistant.
- `HDMS_CHECK_LIST_MODEL` controls approval suggestions and falls back to the
  QA model when it is absent.

The Python defaults and `.env.production.example` will use
`deepseek-v4.1-flash`. Local ignored environment files and the server-local
`.env.production` will be updated operationally without committing secrets.
No model-routing abstraction is added because a two-line default migration is
the smallest sufficient application change.

## Deployment design

The repository currently has no GitHub Actions workflow, although repository
policy requires production deployments to originate from a push to `main`.
A production workflow will therefore be added. It will:

1. Connect with GitHub Actions Secrets.
2. Refuse deployment when tracked files under `/opt/hdms` are modified.
3. Fetch `origin/main` and verify it equals the pushed commit SHA.
4. Fast-forward the production checkout without `git clean`.
5. Run the mandated production Compose update command.
6. Wait for running/healthy core services and print Compose status.

The workflow will never copy or overwrite `.env.production`. Before the push,
the authorized operational step updates only the two model variables in that
server-local file using an atomic replacement with a recoverable permission-
preserving backup.

## Verification and error handling

Tests will first demonstrate that both Python defaults are still legacy values,
then pass after the migration. A workflow contract test will ensure the deploy
file contains the dirty-tree guard, target-SHA verification, required Compose
command, health checks, and no `git clean`.

Production verification requires:

- the deployed revision equals the pushed `main` revision;
- QA and approval containers are running and healthy;
- their sanitized environments report `deepseek-v4.1-flash`;
- the production token's model catalog contains that ID;
- a minimal real completion succeeds;
- a real HDMS QA stream completes without the previous 503.
