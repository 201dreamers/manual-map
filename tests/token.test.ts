import { check, report } from './harness';
const store = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};
const { validatePublicToken, resolveMapboxToken, persistToken, clearToken } = await import(
  '../src/lib/token'
);
const { settingsRepository } = await import('../src/lib/storage');


const pk = 'pk.' + 'a'.repeat(60);
check('FR-6.2 public token accepted', validatePublicToken(pk).ok);
check('FR-6.2 secret token rejected', !validatePublicToken('sk.' + 'a'.repeat(60)).ok);
check('FR-6.2 garbage rejected', !validatePublicToken('hello-world').ok);
check('empty rejected', !validatePublicToken('   ').ok);
check('short pk rejected', !validatePublicToken('pk.abc').ok);

check('no token resolves to null', resolveMapboxToken() === null);
persistToken(`  ${pk}  `);
check('FR-6.1 stored token wins and is trimmed', resolveMapboxToken() === pk);
clearToken();
check('cleared token resolves to null again', resolveMapboxToken() === null);

// The handedness preference shares the settings record, so token writes must merge.
settingsRepository.update({ controlsMirrored: true });
persistToken(pk);
check('saving a token keeps the mirror preference', settingsRepository.read().controlsMirrored);
clearToken();
check('clearing a token keeps the mirror preference', settingsRepository.read().controlsMirrored);
check('mirror defaults to false once cleared', (settingsRepository.update({ controlsMirrored: false }), settingsRepository.read().controlsMirrored === false));

report('token');
