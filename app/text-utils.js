/** Text formatting and normalization used by the Atlas UI. Pure except debounce(). */
((root, factory) => {
  'use strict';
  const api = factory();
  if (root) root.AtlasText = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : null, () => {
  'use strict';
  const entities = Object.freeze({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  });
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => entities[ch]);
  }
  function normalize(value) {
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[–—−‐‑]/g, '-')
      .toLowerCase();
  }
  // A small, deliberately curated set of ordinary prose words. Unlike a
  // spellchecker, the join repair accepts a split only if EVERY segment is
  // recognized and at least one segment is a grammatical connector. No
  // publication-specific text, dictionary file, or model-generated guess is
  // included. Ambiguous tokens remain unchanged.
  const connectiveWords = new Set(
    `a an and are as at be been being between both but by can could did do does each for from had has have how if in into is it its may might more must no not of on only or our out over per than that the their them then there these they this those through to under upon was were what when where which while who why will with within without would you your`.split(
      ' '
    )
  );
  const proseWords = new Set(
    `
    about above across after against all almost also among another any around away back based before below best better bottom certain close compared complete considerable continue control correct different down during else enough entire even every example first following former further given greater here hereinafter hereinbefore herewith however independent instead itself just later least left less like likely local lower main many measured most much near nearly neither next number often other overall own part plus possible present previous right same second several short similar since some still such system third together toward two typical until upper using very well whole wider within without worth
    absorbance absorbed acid acids active activity addition adsorption adsorbed affects algorithm amplifier amplifiers analysis analytical analytically angle angles applied applies applying approximate arrangement average background baseline behavior behaviors binding book boundary calibration capacitance capture chemical chemicals chemistry coefficient coefficients column columns combination combined comparable comparison complex component components concentration concentrations condition conditions constant constants content continue current currents curve curves data detector difference differences diffusion directly discussion display distance electrode electrodes electrochemical electrochemistry electron electrons energy equilibrium equation equations experiment experiments explanation expression expressions field figure figures first flow flux force formula formulas function functions graph graphs group groups heat height hypothesis image images important indicator index input inputs inserted insertion instrument instruments interface interfaces interference interfacial intermediate intermingled interpretation intervals kinetic kinetics layer layers length lengths limit limits liquid liquids material materials matter measure measured measurement measurements mechanism mechanisms method methods model models molecule molecules molecular negative neutral noise noninverting nonnegative numerical observation observations observed operating operation optical order ordinary original other output outputs overlap oxide oxidation parameter parameters phase phases physical platinum plot plots position positive potential potentials prediction precision pressure process processes product products profile program property properties proposed proportional proportionality quantity range rate rates ratio ratios reaction reactions reduction reductions reference references relation relationship response result results resolution resistance review rotation sample samples scan scans scientific section sections selected sensitivity separation shape signal signals similar simulation simulations slope solution solutions source space spacing special species spectrometry standard state states statement statements step steps strong structure structures substance substances suggested surface surfaces symbol symbols system systems table tables temperature terminal test tests text theory theoretical time title transport treatment uncertainty unit units used user users value values variable variables variance view visible viscosity voltage voltages volume volumes weak wave waves window windows word words working work
    applicable charge charges electrolyte electrolytes excess permission oxidation oxidations reduction reductions labeled labelled values
    input output what which figure table problem section chapter
  `
      .trim()
      .split(/\s+/)
  );
  for (const word of connectiveWords) proseWords.add(word);

  /** Split only high-confidence runs of fully recognized prose words. */
  function splitJoinedProseWord(raw) {
    if (!/^[A-Z]?[a-z]{6,47}$/.test(raw)) return raw;
    const lower = raw.toLowerCase();
    if (proseWords.has(lower)) return raw;
    // Avoid splitting capitalized names (e.g., a person's name ending in
    // "and"). Sentence-opening command/question words are the only
    // capitalized tokens we attempt to repair.
    if (
      raw[0] !== raw[0].toLowerCase() &&
      !/^(?:What|The|This|That|How|When|Where|Which|Why|Show|Explain|Find|Calculate|Determine|Derive|Given|Assume)/.test(
        raw
      )
    )
      return raw;
    const memo = new Map();
    function solve(start) {
      if (start === lower.length) return { parts: [], score: 0 };
      if (memo.has(start)) return memo.get(start);
      let best = null;
      for (let end = start + 1; end <= Math.min(lower.length, start + 18); end++) {
        const part = lower.slice(start, end);
        if (!proseWords.has(part)) continue;
        // Avoid accepting one-letter artifacts except a/an.
        if (part.length === 1 && part !== 'a') continue;
        const tail = solve(end);
        if (!tail) continue;
        const score = tail.score + part.length * part.length - (tail.parts.length ? 4 : 0);
        if (!best || score > best.score) best = { parts: [part, ...tail.parts], score };
      }
      memo.set(start, best);
      return best;
    }
    const result = solve(0);
    if (!result || result.parts.length < 2 || result.parts.length > 8) return raw;
    const parts = result.parts;
    // At least one grammatical connector next to a substantial word is good
    // evidence of an omitted space. Plain scientific compounds are not.
    const strongConnectors = new Set(['the', 'of', 'and', 'with']);
    const strong = parts.some(
      (w, i) =>
        strongConnectors.has(w) &&
        (((parts[i - 1] || '').length >= 4 && !connectiveWords.has(parts[i - 1])) ||
          ((parts[i + 1] || '').length >= 4 && !connectiveWords.has(parts[i + 1])))
    );
    // Weaker words (in, to, at, is, etc.) split legitimate English words
    // such as "incomplete" and "partisan". Require substantial recognized
    // content on BOTH sides, never just a prefix/suffix of one ordinary word.
    const contextual =
      parts.length >= 3 &&
      parts.some(
        (w, i) =>
          connectiveWords.has(w) &&
          (parts[i - 1] || '').length >= 4 &&
          !connectiveWords.has(parts[i - 1]) &&
          (parts[i + 1] || '').length >= 4 &&
          !connectiveWords.has(parts[i + 1])
      );
    if (!strong && !contextual) return raw;
    const restored = parts.join(' ');
    return raw[0] === raw[0].toUpperCase()
      ? restored[0].toUpperCase() + restored.slice(1)
      : restored;
  }

  /**
   * Repair unambiguous word-boundary omissions in source-derived prose.
   *
   * The selected PDF sometimes stores spaces as font kerning or omits them
   * between text-show operations. This is intentionally not a spellchecker:
   * scientific identifiers, formula subscripts, proper names and ambiguous
   * uninterrupted words are left intact. It is also used by the display layer
   * so previously imported catalogs benefit without being reimported.
   */
  function repairProseSpacing(value, options = {}) {
    const reference = options.mode === 'reference';
    let text = String(value ?? '');
    // A line break may be an ordinary word space; keep other source spacing.
    text = text
      .replace(/([,;:])(?=[\p{L}])/gu, '$1 ')
      // The following word may itself be glued to more words, so a trailing
      // word-boundary assertion would miss cases like ".Whatisthe...".
      .replace(/([.!?])(?=[\p{Lu}][\p{Ll}]{2,})/gu, '$1 ')
      .replace(/\b(Equation|Figure|Table|Problem|Section|Chapter)(?=\d{1,2}\.\d)/giu, '$1 ')
      .replace(/\b(of|in|at|to|by|for|with|from|per)(?=10\s*[−–‐‑-]\s*\d{1,3}\b)/giu, '$1 ')
      // Broken PDF font runs also commonly remove spaces around signed values
      // and multiplication symbols inside figure and table captions.
      .replace(/\b(of|and|or|to|through|between|for)(?=[−–‐‑-]\d{1,3}\b)/giu, '$1 ')
      .replace(/([−–‐‑-]\d{1,3})(?=(?:and|or|to|through)(?=[−–‐‑-]\d{1,3}\b))/giu, '$1 ')
      .replace(/([A-Za-zΑ-Ωα-ω])\s*[×⋅]\s*(?=[A-Za-zΑ-Ωα-ω])/gu, '$1 × ')
      .replace(/\b(of|for|between)([−–‐‑-]\d{1,3})/giu, '$1 $2')
      .replace(/([−–‐‑-]\d{1,3})(and|or|to|through)([−–‐‑-]\d{1,3})/giu, '$1 $2 $3')
      .replace(/\b(and|or|to|through)([−–‐‑-]\d{1,3})/giu, '$1 $2')
      // Never split element symbols (e.g., In or As) or formula indices.
      // Only lowercase grammatical words stuck directly to a number qualify.
      .replace(
        /\b(is|are|was|were|has|have|of|in|at|to|by|for|with|from|on|per)(?=\d{1,4}(?:\b|[.,−–-]))/g,
        '$1 '
      );
    if (reference) return text;
    // Subset-font transitions may glue ordinary prose onto a capitalized
    // two-letter device label (e.g. "inputofCF2"). Keep formulas themselves
    // intact; only restore the visible word boundary before the label.
    text = text
      .replace(/([a-z])(?=[A-Z]{2,}\d)/g, '$1 ')
      .replace(/(of|the|and|with)(?=[A-Z]{2,}(?:\b|\d))/g, '$1 ')
      .replace(
        /\b(of|the|and|for|with|from|into|input|output)(?=[A-Z][a-z]?\d+(?:[+−-]|\b))/g,
        '$1 '
      )
      .replace(/([A-Za-zΑ-Ωα-ω)])(?=[A-Za-zΑ-Ωα-ω]\s*[×⋅])/gu, '$1 ');
    // A fused phrase can terminate immediately before a number, preventing
    // the usual word-boundary matcher from seeing it ("voltageof10−3").
    // Only separate the number when the complete preceding run can be split
    // into recognized words ending in an ordinary grammatical connector.
    text = text.replace(/\b[A-Z]?[a-z]{6,47}(?=\d{1,4}(?:\b|[.,−–-]))/g, raw => {
      const repaired = splitJoinedProseWord(raw);
      return repaired !== raw &&
        /\b(?:of|in|at|to|by|for|with|from|on|is|are|and|the)$/i.test(repaired)
        ? repaired + ' '
        : raw;
    });
    text = text.replace(/\b[A-Z]?[a-z]{6,47}\b/g, splitJoinedProseWord);
    // Whole-phrase boundaries avoid corrupting technical terms and symbols.
    // Repeated passes are safe and only normalize existing prose words.
    const phrases = [
      ['in', 'terms', 'of'],
      ['is', 'in', 'the'],
      ['are', 'in', 'the'],
      ['as', 'a', 'function', 'of'],
      ['in', 'the', 'presence', 'of'],
      ['in', 'the', 'absence', 'of'],
      ['terms', 'of'],
      ['in', 'terms'],
      ['in', 'the'],
      ['on', 'the'],
      ['at', 'the'],
      ['by', 'the'],
      ['of', 'the'],
      ['to', 'the'],
      ['for', 'the'],
      ['from', 'the'],
      ['with', 'the'],
      ['and', 'the'],
      ['is', 'the'],
      ['as', 'the'],
      ['of', 'this'],
      ['in', 'this'],
      ['for', 'this'],
      ['with', 'this'],
      ['of', 'these'],
      ['in', 'these'],
      ['and', 'these'],
      ['for', 'which'],
      ['of', 'which'],
      ['in', 'which'],
      ['of', 'each'],
      ['for', 'each'],
      ['and', 'each']
    ];
    for (const words of phrases) {
      const expression = new RegExp('\\b(' + words.join(')\\s*(') + ')\\b', 'giu');
      text = text.replace(expression, (...matches) => matches.slice(1, 1 + words.length).join(' '));
    }
    return text;
  }
  function formatNumber(value, digits = 3) {
    if (!Number.isFinite(value)) return '—';
    const magnitude = Math.abs(value);
    if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-3))
      return value.toExponential(digits);
    return value.toLocaleString(undefined, { maximumSignificantDigits: digits + 2 });
  }
  function debounce(fn, ms = 180) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
  function regexEscape(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function shorten(value, max = 220) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
  }
  return Object.freeze({
    escapeHtml,
    normalize,
    repairProseSpacing,
    formatNumber,
    debounce,
    regexEscape,
    shorten
  });
});
