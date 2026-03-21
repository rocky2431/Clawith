from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest


class _FakeScalarListResult:
    def __init__(self, values):
        self._values = list(values)

    def scalars(self):
        return self

    def all(self):
        return list(self._values)


class _FakeSession:
    def __init__(self, execute_values):
        self._execute_values = list(execute_values)
        self.deleted = []
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, _query):
        if not self._execute_values:
            raise AssertionError("No fake execute result prepared")
        return _FakeScalarListResult(self._execute_values.pop(0))

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.commits += 1


def test_builtin_skills_exclude_retired_generic_skills():
    from app.services.skill_seeder import BUILTIN_SKILLS, RETIRED_BUILTIN_SKILL_FOLDERS

    active_folders = {skill["folder_name"] for skill in BUILTIN_SKILLS}

    assert RETIRED_BUILTIN_SKILL_FOLDERS == {
        "web-research",
        "data-analysis",
        "content-writing",
        "competitive-analysis",
        "meeting-notes",
        "content-research-writer",
    }
    assert active_folders.isdisjoint(RETIRED_BUILTIN_SKILL_FOLDERS)


def test_remove_retired_builtin_skill_dirs_prunes_only_retired_folders(tmp_path):
    from app.services.skill_seeder import RETIRED_BUILTIN_SKILL_FOLDERS, remove_retired_builtin_skill_dirs

    agent_dir = tmp_path / "agent"
    retired_dir = agent_dir / "skills" / "web-research"
    kept_builtin_dir = agent_dir / "skills" / "complex-task-executor"
    kept_custom_dir = agent_dir / "skills" / "my-custom-skill"
    retired_dir.mkdir(parents=True)
    kept_builtin_dir.mkdir(parents=True)
    kept_custom_dir.mkdir(parents=True)

    (retired_dir / "SKILL.md").write_text("# retired", encoding="utf-8")
    (kept_builtin_dir / "SKILL.md").write_text("# keep", encoding="utf-8")
    (kept_custom_dir / "SKILL.md").write_text("# keep", encoding="utf-8")

    removed = remove_retired_builtin_skill_dirs(agent_dir, RETIRED_BUILTIN_SKILL_FOLDERS)

    assert removed == ["web-research"]
    assert not retired_dir.exists()
    assert kept_builtin_dir.exists()
    assert kept_custom_dir.exists()


@pytest.mark.asyncio
async def test_cleanup_retired_builtin_skills_deletes_db_rows_and_workspace_dirs(monkeypatch, tmp_path):
    from app.services.skill_seeder import cleanup_retired_builtin_skills

    retired_skill = SimpleNamespace(folder_name="web-research", is_builtin=True)
    kept_skill = SimpleNamespace(folder_name="complex-task-executor", is_builtin=True)
    agent_a = SimpleNamespace(id=uuid4())
    agent_b = SimpleNamespace(id=uuid4())

    fake_session = _FakeSession([[retired_skill, kept_skill], [agent_a, agent_b]])

    for agent in (agent_a, agent_b):
        retired_dir = tmp_path / str(agent.id) / "skills" / "web-research"
        kept_dir = tmp_path / str(agent.id) / "skills" / "complex-task-executor"
        retired_dir.mkdir(parents=True)
        kept_dir.mkdir(parents=True)
        (retired_dir / "SKILL.md").write_text("# retired", encoding="utf-8")
        (kept_dir / "SKILL.md").write_text("# keep", encoding="utf-8")

    monkeypatch.setattr("app.services.skill_seeder.async_session", lambda: fake_session)
    monkeypatch.setattr(
        "app.services.agent_manager.agent_manager",
        SimpleNamespace(_agent_dir=lambda agent_id: tmp_path / str(agent_id)),
    )

    removed = await cleanup_retired_builtin_skills()

    assert removed == {
        "deleted_skills": ["web-research"],
        "cleaned_agent_dirs": {
            str(agent_a.id): ["web-research"],
            str(agent_b.id): ["web-research"],
        },
    }
    assert fake_session.deleted == [retired_skill]
    assert fake_session.commits == 1
    assert not (tmp_path / str(agent_a.id) / "skills" / "web-research").exists()
    assert not (tmp_path / str(agent_b.id) / "skills" / "web-research").exists()
    assert (tmp_path / str(agent_a.id) / "skills" / "complex-task-executor").exists()
    assert (tmp_path / str(agent_b.id) / "skills" / "complex-task-executor").exists()
