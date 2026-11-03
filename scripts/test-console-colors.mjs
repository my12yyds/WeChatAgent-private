import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/console/color-theme.js', import.meta.url), 'utf8');
function fixture(stored, blocked = false, desktop) {
  const tokens = {}, root = { dataset: { theme: 'light' }, style: { setProperty: (key, value) => { tokens[key] = value; } } };
  const storage = new Map([['wechatagent-console-colors', stored]]);
  const context = { window: { desktop }, document: { documentElement: root }, localStorage: {
    getItem: key => { if (blocked) throw Error('blocked'); return storage.get(key); },
    setItem: (key, value) => { if (blocked) throw Error('blocked'); storage.set(key, value); },
  } };
  vm.runInNewContext(source, context);
  return { colors: context.window.consoleColors, tokens, root, storage };
}
const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

test('old, malformed and blocked storage load safe defaults', () => {
  for (const value of [null, 'broken', '{}', 'null', '123', '{"accent":"url(https://invalid)","background":"#123"}']) {
    const { colors } = fixture(value);
    assert.equal(colors.get().accent, '#7560d6');
    assert.equal(colors.get().background, '#e5e0f4');
  }
  const { colors } = fixture(null, true);
  assert.throws(() => colors.set({ accent: '#ffffff' }));
  assert.equal(colors.get().accent, '#7560d6');
});

test('desktop colors persist across changed origins and failed native saves preserve the palette', async () => {
  let saved;
  const f = fixture(null, true, { initialColors: { accent: '#123456', background: '#abcdef' }, setColors: async value => { saved = value; } });
  assert.equal(f.colors.get().accent, '#123456');
  await f.colors.set({ accent: '#654321', background: '#fedcba' });
  assert.equal(saved.accent, '#654321');
  const restarted = fixture(null, true, { initialColors: saved, setColors: async () => { throw Error('disk full'); } });
  assert.equal(restarted.colors.get().accent, '#654321');
  await assert.rejects(restarted.colors.set({ accent: '#ffffff', background: '#000000' }));
  assert.equal(restarted.colors.get().accent, '#654321');
});

test('custom colors survive reload and switching modes without losing preferences', () => {
  const f = fixture(null);
  f.colors.set({ accent: '#ABCDEF', background: '#f1a345' });
  const saved = f.storage.get('wechatagent-console-colors');
  assert.equal(f.colors.get().accent, '#abcdef');
  const light = f.tokens['--bg'];
  f.root.dataset.theme = 'dark'; f.colors.apply();
  assert.notEqual(f.tokens['--bg'], light);
  assert.equal(f.root.style.colorScheme, 'dark');
  assert.equal(f.storage.get('wechatagent-console-colors'), saved);
  assert.equal(fixture(saved).colors.get().background, '#f1a345');
  f.colors.set(f.colors.defaults);
  assert.equal(f.colors.get().accent, '#7560d6');
});

test('presets and extreme custom colors keep text readable in both modes', () => {
  const f = fixture(null);
  const palettes = [...f.colors.presets.map(([, accent, background]) => ({ accent, background })), ...['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00'].flatMap(accent => ['#000000', '#ffffff', '#ff00ff'].map(background => ({ accent, background })))];
  for (const mode of ['light', 'dark']) for (const palette of palettes) {
    f.root.dataset.theme = mode; f.colors.set(palette);
    const t = f.tokens;
    for (const [foreground, background] of [['--on-accent', '--accent'], ['--on-accent', '--accent-hover'], ['--accent-text', '--accent-soft'], ['--muted', '--bg'], ['--text', '--surface'], ['--text', '--input-bg']]) {
      assert(contrast(t[foreground], t[background]) >= 4.5, `${mode} ${JSON.stringify(palette)} ${foreground}/${background}`);
    }
  }
});
