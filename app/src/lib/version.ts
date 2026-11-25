/** This build's version (app/version.json, put in at build time). */
declare const __APP_VERSION__: { release: string; build: number; commit: string; builtAt: string } | undefined;

const v = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : { release: 'dev', build: 0, commit: '', builtAt: '' };

export const APP_VERSION = v;
/** Short form sent to the server and shown on Devices: "R4-2026112601". */
export const APP_VERSION_TAG = `${v.release}-${v.build}`;
/** Shown under More: "R4 · build 2026112601 · 77fd992". */
export const APP_VERSION_LABEL = [v.release, v.build ? `build ${v.build}` : '', v.commit].filter(Boolean).join(' · ');
