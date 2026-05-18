// extension/lib/i18n.js — Lightweight locale resolver for the Chrome extension
// Usage: t('popup.title') -> "Assessment Code"
// Usage: t('player.tts.readAloud') -> "Read Aloud"
// Usage: t('common.showing', { from: 1, to: 10, total: 42 }) -> "Showing 1–10 of 42"
//
// Modified copy of app/js/i18n.js for the extension context:
// - localStorage replaced with chrome.storage.local for persistence
// - fetch('/locales/...') replaced with chrome.runtime.getURL('_locales/...')
// - No auth/server persistence (extension has no authenticated session)
//
// The module loads locale JSON files from _locales/{locale}.json via
// chrome.runtime.getURL() and caches them in module state. Dotted keys
// are resolved by traversing the object tree. Missing keys log a warning
// and return the key name (visible in dev). Placeholders use {key} syntax
// inside the locale string.

let currentLocale = 'en';
let strings = {};

/**
 * Fetch and cache a locale file.
 * Falls back to English if the requested locale cannot be loaded.
 * @param {string} locale - Locale code, e.g. 'en' or 'fr-CA'
 * @returns {Promise<boolean>} true if locale was loaded successfully
 */
async function loadLocale(locale) {
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}.json`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    strings = await resp.json();
    currentLocale = locale;
    chrome.storage.local.set({ ap_lang: locale });
    document.documentElement.lang = locale;
    return true;
  } catch (err) {
    console.warn(`[i18n] Could not load locale "${locale}", falling back to English`, err);
    if (locale !== 'en') return loadLocale('en');
    strings = {};
    return false;
  }
}

/**
 * Resolve a dotted key like 'popup.title' against a locale object.
 * @param {string} key
 * @param {object} localeStrings
 * @returns {string|undefined}
 */
function resolve(key, localeStrings) {
  const parts = key.split('.');
  let obj = localeStrings;
  for (const part of parts) {
    if (obj == null || typeof obj !== 'object') return undefined;
    obj = obj[part];
  }
  return typeof obj === 'string' ? obj : undefined;
}

/**
 * Translate a dotted key to the localized string.
 * @param {string} key - Dotted key path, e.g. 'popup.title'
 * @param {object} [replacements] - Optional {placeholder} substitutions
 * @returns {string} Localized string, or the key itself if untranslated
 */
function t(key, replacements) {
  let value = resolve(key, strings);
  if (value === undefined) {
    console.warn(`[i18n] Missing translation key: "${key}" (${currentLocale})`);
    return key;
  }
  // Apply {placeholder} replacements
  if (replacements) {
    Object.keys(replacements).forEach(k => {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), replacements[k]);
    });
  }
  return value;
}

/**
 * Get the current locale code.
 * @returns {string} e.g. 'en' or 'fr-CA'
 */
function getLocale() {
  return currentLocale;
}

/**
 * Switch to a different locale and dispatch a 'localechanged' event.
 * @param {string} locale
 * @returns {Promise<boolean>} true on success
 */
async function setLocale(locale) {
  const ok = await loadLocale(locale);
  if (ok) {
    window.dispatchEvent(new CustomEvent('localechanged', { detail: { locale } }));
  }
  return ok;
}

// Initialize: read stored locale from chrome.storage.local, then load the file
const initPromise = (async () => {
  try {
    const result = await chrome.storage.local.get('ap_lang');
    if (result.ap_lang) {
      currentLocale = result.ap_lang;
    }
  } catch (e) {
    // chrome.storage not available, use default 'en'
  }
  return loadLocale(currentLocale);
})();

// Expose on window so popup.js, player.js, etc. can access via regular <script> tags
window.t = t;
window.getLocale = getLocale;
window.setLocale = setLocale;
window.i18nReady = initPromise;
