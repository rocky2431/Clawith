import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const enterpriseSettingsPath = path.resolve(process.cwd(), 'src/pages/EnterpriseSettings.tsx');
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('EnterpriseSettings removes legacy tools tab in favor of packs and capabilities', () => {
    const source = read(enterpriseSettingsPath);

    assert.doesNotMatch(source, /activeTab === 'tools'/);
    assert.doesNotMatch(source, /useState<'llm' \| 'org' \| 'info' \| 'approvals' \| 'audit' \| 'tools'/);
    assert.doesNotMatch(source, /\['info', 'llm', 'tools', 'packs'/);
    assert.match(source, /\['info', 'llm', 'packs', 'skills'/);
    assert.match(source, /activeTab === 'packs'/);
    assert.match(source, /activeTab === 'capabilities'/);
});

test('EnterpriseSettings removes legacy tool management state and loaders', () => {
    const source = read(enterpriseSettingsPath);

    assert.doesNotMatch(source, /const \[allTools, setAllTools\]/);
    assert.doesNotMatch(source, /const \[showAddMCP, setShowAddMCP\]/);
    assert.doesNotMatch(source, /const \[toolsView, setToolsView\]/);
    assert.doesNotMatch(source, /loadAllTools/);
    assert.doesNotMatch(source, /loadAgentInstalledTools/);
    assert.doesNotMatch(source, /jina_api_key/);
});

test('enterprise i18n removes the tools tab label', () => {
    const zh = JSON.parse(read(zhI18nPath));
    const en = JSON.parse(read(enI18nPath));

    assert.equal(zh.enterprise.tabs.tools, undefined);
    assert.equal(en.enterprise.tabs.tools, undefined);
    assert.equal(zh.enterprise.tabs.packs, '能力包');
    assert.equal(en.enterprise.tabs.packs, 'Packs');
    assert.equal(zh.agent.tools?.platformTools, undefined);
    assert.equal(en.agent.tools?.platformTools, undefined);
});
