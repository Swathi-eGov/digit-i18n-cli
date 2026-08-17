import translate from "google-translate-api-x";

// Maps a DIGIT-style locale (e.g. "hi_IN", "pt_MZ", "en_IN") to the 2-letter
// language code the translation API expects (e.g. "hi", "pt", "en").
// Best-effort: takes the part before the underscore.
export function localeToLangCode(locale) {
  const [lang] = locale.split("_");
  return lang.toLowerCase();
}

// Uses a free, unofficial Google Translate endpoint (no API key) — confirmed
// working with a real network call during development, but this is
// explicitly NOT an officially supported API: no SLA, no guarantee it keeps
// working, can be rate-limited or blocked without notice. Every caller must
// treat a failure here as an expected, handled case — never let a single
// failed translation crash a batch of many.
export async function translateText(text, targetLocale, sourceLocale = "en_IN") {
  const from = localeToLangCode(sourceLocale);
  const to = localeToLangCode(targetLocale);
  try {
    const result = await translate(text, { from, to });
    return { text: result.text, error: null };
  } catch (err) {
    return { text: null, error: err.message };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Translates a list of {message, ...} entries into one target locale,
// sequentially with a small delay — the unofficial endpoint is more likely
// to get rate-limited by a burst of concurrent requests than by a slower,
// sequential one. Returns { translated: [...], failed: [...] } so callers
// can report both outcomes explicitly rather than silently dropping failures.
export async function translateEntries(entries, targetLocale, sourceLocale, delayMs = 150) {
  const translated = [];
  const failed = [];

  for (const entry of entries) {
    const { text, error } = await translateText(entry.message, targetLocale, sourceLocale);
    if (error) {
      failed.push({ ...entry, error });
    } else {
      translated.push({ ...entry, message: text });
    }
    await sleep(delayMs);
  }

  return { translated, failed };
}
