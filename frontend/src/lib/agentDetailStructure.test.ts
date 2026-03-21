import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentDetailPath = path.resolve(process.cwd(), 'src/pages/AgentDetail.tsx');
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('AgentDetail uses capabilities tab instead of legacy tools tab', () => {
    const source = read(agentDetailPath);

    assert.match(source, /const TABS = \['status', 'aware', 'mind', 'capabilities'/);
    assert.doesNotMatch(source, /activeTab === 'tools'/);
    assert.doesNotMatch(source, /function ToolsManager\(/);
    assert.match(source, /skill_declared_packs/);
});

test('AgentDetail removes legacy autonomy policy panel', () => {
    const source = read(agentDetailPath);

    assert.doesNotMatch(source, /Legacy Autonomy Policy/);
    assert.doesNotMatch(source, /agent\.settings\.autonomy\.legacyTitle/);
    assert.doesNotMatch(source, /autonomy_policy/);
});

test('i18n exposes capabilities tab label', () => {
    const zh = JSON.parse(read(zhI18nPath));
    const en = JSON.parse(read(enI18nPath));

    assert.equal(zh.agent.tabs.capabilities, '能力');
    assert.equal(en.agent.tabs.capabilities, 'Capabilities');
    assert.equal(zh.agent.tools?.platformTools, undefined);
    assert.equal(en.agent.tools?.platformTools, undefined);
});

test('AgentDetail uses localized capability copy and normalized versioned API paths', () => {
    const source = read(agentDetailPath);

    assert.doesNotMatch(source, /Skill-declared Packs/);
    assert.doesNotMatch(source, /No skill-declared packs yet\./);
    assert.doesNotMatch(source, /Activated Packs/);
    assert.doesNotMatch(source, /Used Tools/);
    assert.doesNotMatch(source, /Blocked Capabilities/);
    assert.doesNotMatch(source, /Compactions/);
    assert.doesNotMatch(source, /\/api\/agents\/\$\{id\}\/sessions/);
    assert.match(source, /\/api\/v1\/agents\/\$\{id\}\/sessions/);
});

test('AgentDetail reads bootstrap channel failure state and renders a post-create warning banner', () => {
    const source = read(agentDetailPath);

    assert.match(source, /location\.state/);
    assert.match(source, /bootstrapChannelFailures/);
    assert.match(source, /wizard\.stepChannel\.partialFailure/);
});
