import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import app


client = TestClient(app)


def test_visibility_check_endpoint_is_removed() -> None:
    response = client.post("/sight-corridor/check", json={})
    assert response.status_code == 404


def test_collision_endpoint_is_still_available() -> None:
    response = client.post("/sight-corridor/collision", json={})
    assert response.status_code != 404
