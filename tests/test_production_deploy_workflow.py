"""Contract tests for the production deployment workflow."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = PROJECT_ROOT / ".github/workflows/deploy-production.yml"


def test_production_workflow_preserves_server_state_and_verifies_health():
    assert WORKFLOW.exists(), "production deployment workflow is missing"

    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert "branches: [main]" in workflow
    assert "git status --porcelain --untracked-files=no" in workflow
    assert "git clean" not in workflow
    assert "actions/checkout@v4" in workflow
    assert "PRODUCTION_BASE_SHA" in workflow
    assert "git merge-base --is-ancestor" in workflow
    assert "git bundle create" in workflow
    assert '"^$PRODUCTION_BASE_SHA"' in workflow
    assert "scp" in workflow
    assert 'git fetch "$bundle_path"' in workflow
    assert "git fetch origin main" not in workflow
    assert "git merge --ff-only" in workflow
    assert "origin/main" in workflow
    assert "GITHUB_SHA" in workflow
    assert (
        "docker compose --env-file .env.production "
        "-f docker-compose.production.yml"
    ) in workflow
    assert "up -d --build --remove-orphans" in workflow
    assert "compose restart nginx" in workflow
    assert "docker inspect" in workflow
    assert "healthy" in workflow
