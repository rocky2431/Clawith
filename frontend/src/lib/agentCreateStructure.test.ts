import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentCreatePath = path.resolve(process.cwd(), 'src/pages/AgentCreate.tsx');
const read = () => fs.readFileSync(agentCreatePath, 'utf8');

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
    assert.match(source, /kernel tools|Kernel Tools|内核工具/);
});
