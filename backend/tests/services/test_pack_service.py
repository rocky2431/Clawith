"""Tests for pack_service — catalog, agent packs, capability summary."""

from app.services.pack_service import KERNEL_TOOLS, get_pack_catalog


def test_pack_catalog_returns_all_packs():
    catalog = get_pack_catalog()
    assert len(catalog) >= 7
    names = {p["name"] for p in catalog}
    assert "web_pack" in names
    assert "feishu_pack" in names
    assert "email_pack" in names
    assert "mcp_admin_pack" in names


def test_pack_catalog_has_required_fields():
    catalog = get_pack_catalog()
    for pack in catalog:
        assert "name" in pack
        assert "summary" in pack
        assert "source" in pack
        assert "tools" in pack
        assert "capabilities" in pack
        assert isinstance(pack["tools"], list)
        assert isinstance(pack["capabilities"], list)


def test_pack_catalog_feishu_has_channel_dependency():
    catalog = get_pack_catalog()
    feishu = next(p for p in catalog if p["name"] == "feishu_pack")
    assert feishu["source"] == "channel"
    assert feishu["requires_channel"] == "feishu"
    assert len(feishu["capabilities"]) > 0


def test_pack_catalog_system_pack_no_channel_dependency():
    catalog = get_pack_catalog()
    web = next(p for p in catalog if p["name"] == "web_pack")
    assert web["source"] == "system"
    assert web["requires_channel"] is None


def test_kernel_tools_are_strings():
    assert all(isinstance(t, str) for t in KERNEL_TOOLS)
    assert "read_file" in KERNEL_TOOLS
    assert "write_file" in KERNEL_TOOLS
    assert "load_skill" in KERNEL_TOOLS
    assert "tool_search" in KERNEL_TOOLS
