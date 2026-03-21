from pathlib import Path


def test_agent_and_template_api_surface_no_longer_exposes_legacy_autonomy_fields():
    project_root = Path(__file__).resolve().parents[3]
    schemas_source = (project_root / "backend/app/schemas/schemas.py").read_text()
    agent_create_source = schemas_source.split("class AgentCreate(BaseModel):", 1)[1].split("class AgentOut(BaseModel):", 1)[0]
    agents_api_source = (project_root / "backend/app/api/agents.py").read_text()
    advanced_api_source = (project_root / "backend/app/api/advanced.py").read_text()
    model_source = (project_root / "backend/app/models/agent.py").read_text()
    main_source = (project_root / "backend/app/main.py").read_text()
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
    assert 'agent_type: str = "native"' not in agent_create_source
    assert "template_id: uuid.UUID | None = None" not in agent_create_source
    assert "template_id=data.template_id" not in agents_api_source
    assert 'if agent.agent_type == "openclaw":' not in agents_api_source
    assert 'agent_type=data.agent_type or "native"' not in agents_api_source
    assert '@router.get("/templates"' not in advanced_api_source
    assert "seed_agent_templates" not in main_source
