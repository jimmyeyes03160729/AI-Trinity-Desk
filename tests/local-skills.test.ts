import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalSkills } from '../electron/local-skills';
import { defaultSettings } from '../electron/contracts';
import type { DiscussionRunner } from '../electron/discussion';

test('local skills find per-AI and project descriptions, flag duplicates and translate only on request', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trinity-local-skills-'));
  try {
    const home = path.join(root, 'home'), project = path.join(root, 'project'), data = path.join(root, 'data');
    const create = async (base: string, folder: string, text: string) => { await mkdir(path.join(base, folder), { recursive: true }); await writeFile(path.join(base, folder, 'SKILL.md'), text); };
    await create(path.join(home, '.agents', 'skills'), 'english', '---\nname: english\ndescription: >-\n  Test code\n  thoroughly.\n---\nPRIVATE BODY');
    await create(path.join(project, '.agents', 'skills'), 'local', '---\nname: local\ndescription: 產生繁體中文報告\n---\n');
    await create(path.join(home, '.codex', 'skills'), 'copy', '---\nname: local\ndescription: another skill\n---\n');
    await create(path.join(home, '.claude', 'skills'), 'hidden', '---\nname: hidden\ndescription: Hidden\nuser-invocable: false\n---\n');
    await create(path.join(home, '.claude', 'skills'), 'invalid', '---\nname: "bad;command"\ndescription: unsafe name\n---\n');
    await create(path.join(home, '.claude', 'skills'), 'chinese', '---\nname: chinese\ndescription: 分析项目和代码\n---\n');
    const settings = defaultSettings(); settings.projectPath = project;
    let calls = 0, prompt = '';
    const runner: DiscussionRunner = async (_id, _model, input) => { calls++; prompt = input; return '仔細測試程式碼'; };
    const service = new LocalSkills(home, data, () => settings, runner);
    const items = await service.list('codex');
    assert.equal(items.length, 3); assert.equal(calls, 0);
    assert.equal(items.find(s => s.name === 'english')?.description, 'Test code thoroughly.');
    assert.equal(items.find(s => s.scope === 'project')?.descriptionZh, '產生繁體中文報告');
    assert.equal(items.filter(s => s.name === 'local' && s.ambiguous).length, 2);
    assert.equal((await service.list('claude')).filter(s => !s.invocable).length, 2);
    assert.equal((await service.list('claude')).find(s => s.name === 'chinese')?.descriptionZh, '分析專案和程式碼');
    assert.equal((await service.list('antigravity')).find(s => s.name === 'local')?.scope, 'project');
    const result = await service.translate({ ai: 'codex', scope: 'user', folder: 'english' });
    assert.equal(result.descriptionZh, '仔細測試程式碼'); assert.equal(calls, 1); assert.ok(!prompt.includes('PRIVATE BODY'));
    const restored = new LocalSkills(home, data, () => settings, runner);
    assert.equal((await restored.list('codex')).find(s => s.name === 'english')?.descriptionZh, '仔細測試程式碼');
    await assert.rejects(() => restored.translate({ ai: 'codex', scope: 'user', folder: '../secret' }));
    await writeFile(path.join(home, '.agents', 'skills', 'english', 'SKILL.md'), '---\nname: english\ndescription: Changed description\n---\n');
    assert.equal((await restored.list('codex')).find(s => s.name === 'english')?.descriptionZh, undefined);
    await service.shutdown(); await restored.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});
