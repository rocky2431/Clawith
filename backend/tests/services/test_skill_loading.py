from __future__ import annotations

from uuid import uuid4


def test_load_skill_reads_folder_and_flat_file(tmp_path):
    from app.services.agent_tools import _load_skill

    workspace = tmp_path / "agent"
    folder_skill = workspace / "skills" / "web-research"
    folder_skill.mkdir(parents=True)
    (folder_skill / "SKILL.md").write_text("folder skill body", encoding="utf-8")

    flat_skill = workspace / "skills" / "data-analysis.md"
    flat_skill.write_text("flat skill body", encoding="utf-8")

    assert _load_skill(workspace, "web research") == "folder skill body"
    assert _load_skill(workspace, "data analysis") == "flat skill body"


def test_load_skills_index_instructs_load_skill(monkeypatch, tmp_path):
    from app.services.agent_context import _load_skills_index

    agent_id = uuid4()
    workspace = tmp_path / str(agent_id) / "skills" / "writing"
    workspace.mkdir(parents=True)
    (workspace / "SKILL.md").write_text(
        "---\nname: Writing\ndescription: Draft polished content\n---\n# Writing\n",
        encoding="utf-8",
    )

    monkeypatch.setattr("app.services.agent_context.TOOL_WORKSPACE", tmp_path)
    monkeypatch.setattr("app.services.agent_context.PERSISTENT_DATA", tmp_path)

    skills_index = _load_skills_index(agent_id)

    assert "`load_skill`" in skills_index
    assert "call `read_file`" not in skills_index
