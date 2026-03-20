import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const read = () => fs.readFileSync(apiPath, 'utf8');

test('frontend api surface no longer exports legacy toolApi', () => {
    const source = read();

    assert.doesNotMatch(source, /export const toolApi = \{/);
    assert.doesNotMatch(source, /\/tools\/agents\/\$\{agentId\}/);
});
