# DeepSeek V4.1 Flash Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate QA and approval suggestions to `deepseek-v4.1-flash` and deploy the verified change to production through GitHub Actions.

**Architecture:** Preserve environment-variable configuration and change only the two service defaults plus example/local/production values. Add the missing push-to-main production workflow with tracked-change protection, exact-revision deployment, Compose rebuild, and health verification.

**Tech Stack:** Python 3.11, pytest, FastAPI, Docker Compose, GitHub Actions, PowerShell/SSH.

---

### Task 1: Lock the selected model defaults with failing tests

**Files:**
- Create: `tests/test_model_defaults.py`
- Test: `tests/test_model_defaults.py`

**Step 1: Write the failing tests**

Load `backend/qa_assistant/core/config.py` with dotenv loading disabled and
`HDMS_QA_MODEL` absent; assert the default is
`deepseek-v4.1-flash`. Load
`backend/approval_checklist/routes/ai_suggestion.py` with both model
environment variables absent; assert `CHECK_LIST_MODEL` has the same value.

**Step 2: Run the tests to verify RED**

Run: `python -m pytest tests/test_model_defaults.py -q`

Expected: two assertion failures showing the actual default is
`deepseek-r1`.

**Step 3: Commit the test only after the observed RED state is recorded**

Do not alter production code before the expected failures have been observed.

### Task 2: Apply the minimal model migration

**Files:**
- Modify: `backend/qa_assistant/core/config.py:122`
- Modify: `backend/approval_checklist/routes/ai_suggestion.py:19`
- Modify: `.env.production.example:25-27`
- Modify: `docs/使用手册/用户使用说明.md:627`

**Step 1: Change both defaults**

Replace only the legacy default literals with
`deepseek-v4.1-flash`.

**Step 2: Update non-secret configuration documentation**

Set both model entries in `.env.production.example` and the user manual to the
selected model.

**Step 3: Verify GREEN**

Run: `python -m pytest tests/test_model_defaults.py -q`

Expected: 2 passed.

**Step 4: Run focused regression tests**

Run: `python -m pytest tests backend/qa_assistant/tests -q`

Expected: all tests pass.

### Task 3: Add a contract-tested production deployment workflow

**Files:**
- Create: `tests/test_production_deploy_workflow.py`
- Create: `.github/workflows/deploy-production.yml`

**Step 1: Write the failing workflow contract test**

Assert the workflow does not yet exist, then encode the required deployment
contract: push to `main`, tracked-file guard, pushed-SHA verification, no
`git clean`, required Compose command, and health checks.

**Step 2: Run the test to verify RED**

Run: `python -m pytest tests/test_production_deploy_workflow.py -q`

Expected: failure because the workflow file is missing.

**Step 3: Implement the workflow**

Use GitHub Actions Secrets `PRODUCTION_HOST`, `PRODUCTION_PORT`,
`PRODUCTION_USER`, `PRODUCTION_SSH_KEY`, and
`PRODUCTION_KNOWN_HOSTS`. Pass the pushed SHA to a strict remote Bash script,
refuse tracked modifications, fast-forward, run Compose, and wait for core
service health.

**Step 4: Verify GREEN**

Run: `python -m pytest tests/test_production_deploy_workflow.py -q`

Expected: pass.

### Task 4: Validate and commit the branch

**Files:**
- Verify all task-owned files.

**Step 1: Run full focused verification**

Run:

```powershell
python -m pytest tests backend/qa_assistant/tests -q
.\scripts\check-module-lines.ps1
git diff --check
```

Expected: all tests pass, all touched source modules are at most 600 lines, and
the diff check exits zero.

**Step 2: Review the diff**

Confirm no secret or unrelated file is staged.

**Step 3: Commit**

Create focused commits for design/plan and implementation.

### Task 5: Update authorized runtime settings and deploy

**Files:**
- Local ignored: `.env`, `.env.external`
- Production secret: `/opt/hdms/.env.production`

**Step 1: Update local ignored model variables**

Use narrow line replacements; never display API keys.

**Step 2: Configure/verify GitHub Actions Secrets**

Use local credentials and encrypted GitHub API secret upload without printing
the SSH key or access token.

**Step 3: Update production model variables**

After a sanitized preflight, atomically replace only
`HDMS_QA_MODEL` and `HDMS_CHECK_LIST_MODEL`, preserving permissions and a
recoverable backup.

**Step 4: Fast-forward local main and push**

Push the reviewed commit to `origin/main`; do not manually run the production
Compose update.

**Step 5: Monitor GitHub Actions**

Poll the official Actions API until the run completes. If it fails, preserve
running containers and report the logs.

### Task 6: Verify production

**Files:**
- No further file changes expected.

**Step 1: Verify revision and health**

Confirm `/opt/hdms` is at the pushed SHA and core Compose services are
running/healthy.

**Step 2: Verify model routing**

Confirm both containers have the selected model values, the authenticated model
catalog contains the selected ID, and a minimal completion succeeds.

**Step 3: Verify HDMS behavior**

Run a real QA request and confirm the stream completes without an error event or
the prior 503.

**Step 4: Record evidence**

Update planning records with revision, workflow result, health, and request
verification without recording secrets or user document contents.
