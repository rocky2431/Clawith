import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const typesPath = path.resolve(process.cwd(), 'src/types/index.ts');

test('frontend Agent type no longer exposes autonomy_policy', () => {
    const source = fs.readFileSync(typesPath, 'utf8');

    assert.doesNotMatch(source, /autonomy_policy:/);
});
