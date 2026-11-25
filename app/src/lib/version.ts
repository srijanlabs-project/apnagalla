/** This build's version (app/version.json, put in at build time). */
declare const __APP_VERSION__: { release: string; name: string; code: number; commit: string; builtAt: string } | undefined;

const v = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : { release: 'dev', name: '', code: 0, commit: '', builtAt: '' };

export const APP_VERSION = v;
/** Short form sent to the server and shown on Devices: "R4-11.26.26.2". */
export const APP_VERSION_TAG = [v.release, v.name].filter(Boolean).join('-');
/** Shown under More: "R4 · 11.26.26.2 · 9fd8a81". */
export const APP_VERSION_LABEL = [v.release, v.name, v.commit].filter(Boolean).join(' · ');
