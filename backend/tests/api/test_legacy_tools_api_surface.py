from pathlib import Path


def test_legacy_tools_router_removed_from_app_surface():
    project_root = Path(__file__).resolve().parents[3]
    main_source = (project_root / "backend/app/main.py").read_text()
    tools_api_path = project_root / "backend/app/api/tools.py"

    assert "from app.api.tools import router as tools_router" not in main_source
    assert "tools_router" not in main_source
    assert not tools_api_path.exists()
