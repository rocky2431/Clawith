from pathlib import Path


def test_agent_and_template_api_surface_no_longer_exposes_legacy_autonomy_fields():
    project_root = Path(__file__).resolve().parents[3]
    schemas_source = (project_root / "backend/app/schemas/schemas.py").read_text()
    agents_api_source = (project_root / "backend/app/api/agents.py").read_text()
    advanced_api_source = (project_root / "backend/app/api/advanced.py").read_text()
    model_source = (project_root / "backend/app/models/agent.py").read_text()
    template_seeder_source = (project_root / "backend/app/services/template_seeder.py").read_text()
    approval_service_path = project_root / "backend/app/services/approval_service.py"
    autonomy_service_path = project_root / "backend/app/services/autonomy_service.py"

    assert "autonomy_policy:" not in schemas_source
    assert "default_autonomy_policy" not in advanced_api_source
    assert '"default_autonomy_policy"' not in agents_api_source
    assert "if data.autonomy_policy" not in agents_api_source
    assert "autonomy_policy" not in model_source
    assert "default_autonomy_policy" not in model_source
    assert "default_autonomy_policy" not in template_seeder_source
    assert approval_service_path.exists()
    assert not autonomy_service_path.exists()
