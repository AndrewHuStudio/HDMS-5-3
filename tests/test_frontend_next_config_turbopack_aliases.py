from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_next_config_turbopack_aliases_canvas():
    """
    Next.js builds use Turbopack (see `npm -C frontend run build`).
    Ensure we alias optional Node-only deps (like `canvas`) so the build
    doesn't fail during module resolution.
    """

    text = (ROOT / "frontend/next.config.ts").read_text(encoding="utf-8")

    turbopack_index = text.find("turbopack")
    # Find the start of the webpack config block (avoid matching "webpack" in comments).
    webpack_index = text.find("webpack:", turbopack_index)
    assert turbopack_index != -1, "next.config.ts should configure turbopack"
    assert webpack_index != -1, "next.config.ts should configure webpack too"

    resolve_alias_index = text.find("resolveAlias", turbopack_index, webpack_index)
    assert (
        resolve_alias_index != -1
    ), "turbopack config should include resolveAlias for 'canvas'"

    turbopack_block = text[turbopack_index:webpack_index]
    assert "canvas" in turbopack_block, "turbopack resolveAlias should mention 'canvas'"
