import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentCreatePath = path.resolve(process.cwd(), 'src/pages/AgentCreate.tsx');
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');
const read = () => fs.readFileSync(agentCreatePath, 'utf8');
const readFile = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('AgentCreate no longer depends on legacy templates for native agents', () => {
    const source = read();

    assert.doesNotMatch(source, /enterpriseApi\.templates/);
    assert.doesNotMatch(source, /queryKey:\s*\['templates'\]/);
    assert.doesNotMatch(source, /template_id/);
    assert.doesNotMatch(source, /selectTemplate/);
});

test('AgentCreate uses packs and capability language for starter setup', () => {
    const source = read();

    assert.match(source, /packApi\.catalog/);
    assert.match(source, /capabilityApi\.definitions/);
    assert.match(source, /starterPacks|selectedPacks|packPreview/);
    assert.match(source, /wizard\.step2New\.kernelTitle/);
    assert.match(source, /wizard\.step2New\.starterPacksTitle/);
    assert.match(source, /wizard\.step2New\.requiredBadge/);
});

test('AgentCreate removes legacy openclaw branching from the main creation flow', () => {
    const source = read();

    assert.doesNotMatch(source, /const OPENCLAW_STEPS/);
    assert.doesNotMatch(source, /agentType/);
    assert.doesNotMatch(source, /typeSelector/);
    assert.doesNotMatch(source, /openclaw\./);
    assert.doesNotMatch(source, /agent_type:\s*agentType/);
    assert.doesNotMatch(source, /agent_type:\s*'native'/);
});

test('AgentCreate uses dedicated channel and review keys instead of duplicated step5 keys', () => {
    const source = read();

    assert.match(source, /wizard\.stepChannel\.title/);
    assert.match(source, /wizard\.stepChannel\.description/);
    assert.match(source, /wizard\.stepChannel\.skipHint/);
    assert.match(source, /wizard\.stepReview\.title/);
    assert.match(source, /wizard\.stepReview\.summary/);
    assert.doesNotMatch(source, /wizard\.step5\.title/);
    assert.doesNotMatch(source, /wizard\.step5\.description/);
    assert.doesNotMatch(source, /wizard\.step5\.skipHint/);
});

test('agent create i18n keeps distinct channel/review sections without duplicated step5 blocks', () => {
    const zhSource = readFile(zhI18nPath);
    const enSource = readFile(enI18nPath);
    const zh = JSON.parse(zhSource);
    const en = JSON.parse(enSource);

    assert.equal((zhSource.match(/"step5":\s*\{/g) || []).length, 0);
    assert.equal((enSource.match(/"step5":\s*\{/g) || []).length, 0);
    assert.equal(zh.wizard.stepChannel.title, '通道绑定');
    assert.equal(en.wizard.stepChannel.title, 'Channel Configuration');
    assert.equal(zh.wizard.stepReview.title, '确认创建');
    assert.equal(en.wizard.stepReview.title, 'Review & Create');
});
