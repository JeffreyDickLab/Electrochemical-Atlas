/* Display-only scientific typography for text extracted from the user's PDF.
 * The source strings, search corpus and PDF remain unchanged. No publication
 * content or precomputed symbols are included in this program. */
(root => {
  'use strict';
  const escape = s =>
    String(s ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const textTools =
    root?.AtlasText ||
    (typeof module === 'object' && module.exports ? require('../core/text.js') : null);
  const repairProseSpacing = textTools?.repairProseSpacing || (value => String(value ?? ''));
  const elements = new Set(
    'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(
      ' '
    )
  );
  // Mapping an explicitly encoded Unicode script character back to its
  // baseline glyph inside <sup>/<sub> avoids missing-script font fallbacks.
  // Unmarked ASCII digits are NOT inferred to be scripts by this mapping.
  const superscriptCharacters = Object.freeze({
    '⁰': '0',
    '¹': '1',
    '²': '2',
    '³': '3',
    '⁴': '4',
    '⁵': '5',
    '⁶': '6',
    '⁷': '7',
    '⁸': '8',
    '⁹': '9',
    '⁺': '+',
    '⁻': '−',
    '⁼': '=',
    '⁽': '(',
    '⁾': ')',
    ⁿ: 'n',
    ⁱ: 'i',
    ᵃ: 'a',
    ᵇ: 'b',
    ᶜ: 'c',
    ᵈ: 'd',
    ᵉ: 'e',
    ᶠ: 'f',
    ᵍ: 'g',
    ʰ: 'h',
    ʲ: 'j',
    ᵏ: 'k',
    ˡ: 'l',
    ᵐ: 'm',
    ᵒ: 'o',
    ᵖ: 'p',
    ʳ: 'r',
    ˢ: 's',
    ᵗ: 't',
    ᵘ: 'u',
    ᵛ: 'v',
    ʷ: 'w',
    ˣ: 'x',
    ʸ: 'y',
    ᶻ: 'z',
    ᵅ: 'α',
    ᵝ: 'β',
    ᵞ: 'γ',
    ᵟ: 'δ',
    ᵋ: 'ε',
    ᶿ: 'θ',
    ᵠ: 'φ'
  });
  const subscriptCharacters = Object.freeze({
    '₀': '0',
    '₁': '1',
    '₂': '2',
    '₃': '3',
    '₄': '4',
    '₅': '5',
    '₆': '6',
    '₇': '7',
    '₈': '8',
    '₉': '9',
    '₊': '+',
    '₋': '−',
    '₌': '=',
    '₍': '(',
    '₎': ')',
    ₐ: 'a',
    ₑ: 'e',
    ₕ: 'h',
    ᵢ: 'i',
    ⱼ: 'j',
    ₖ: 'k',
    ₗ: 'l',
    ₘ: 'm',
    ₙ: 'n',
    ₒ: 'o',
    ₚ: 'p',
    ᵣ: 'r',
    ₛ: 's',
    ₜ: 't',
    ₓ: 'x'
  });
  const supRX = new RegExp('[' + Object.keys(superscriptCharacters).join('') + ']+', 'gu');
  const subRX = new RegExp('[' + Object.keys(subscriptCharacters).join('') + ']+', 'gu');
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function html(value, options = {}) {
    const max = Number.isSafeInteger(options.max) && options.max > 0 ? options.max : 100000;
    const conservative = options.mode === 'reference';
    let text = repairProseSpacing(
      String(value ?? '')
        .slice(0, max)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' '),
      { mode: conservative ? 'reference' : 'prose' }
    );
    // Repair only systematic PDF text-extraction spacing artifacts.
    text = text
      .replace(/([.!?])(?=[A-Z][a-z]{2,}\b)/g, '$1 ')
      // Missing spaces after punctuation and next to molar concentration are
      // common when the source PDF switches text fonts mid-expression.
      .replace(/([,;:])(?=[\p{L}])/gu, '$1 ')
      .replace(/\b(of|at|in|is|are|to|by|for|with|from|per)(?=10\s*[−–‐‑-]\s*\d{1,3}\b)/giu, '$1 ')
      .replace(/\bM([A-Z][a-z]?)(\d{1,2})([+−-])(?=$|[\s,;.)])/gu, (raw, atom, oxidation, sign) =>
        elements.has(atom) ? 'M ' + atom + oxidation + sign : raw
      )
      .replace(/([0-9])\s*[∘°]\s*C\b/g, '$1 °C')
      .replace(/(\d)\s*[×⋅]\s*(?=10\s*[−–‐‑-]\s*\d)/g, '$1 × ')
      .replace(/(\d(?:\.\d+)?)\s*[xX]\s*(?=10\s*[−–‐‑-]\s*\d{1,3}\b)/g, '$1 × ')
      // A spaced '10 − 6' can be subtraction. Only collapse a broken
      // exponent when it follows an explicit multiplication sign.
      .replace(/([×⋅]\s*)10\s*[−–‐‑-]\s*(\d{1,3})\b/g, (_, prefix, exp) => prefix + '10−' + exp)
      .replace(/\b10−(\d{1,3})\b/g, '10−$1')
      .replace(/\b(H\d)\s+(SO\d)\b/g, '$1$2')
      .replace(/(\d)(μ(?:F|A|m|L|M)|m(?:A|V|F|m)|n(?:A|M|F|m)|cm|mm|kg|mol)\b/g, '$1 $2')
      .replace(/(\d)\s*([×])\s*10/g, '$1 $2 10');
    if (!conservative) {
      // Some PDF fonts encode a raised exponent sign as an en dash or as a
      // baseline minus. Treat it as a power only in a physical-unit context;
      // ordinary numeric ranges and subtraction are left untouched.
      text = text.replace(
        /(?<![\p{L}\p{N}])10\s*[–‐‑−-]\s*(\d{1,3})(?=\s+(?:cm|mm|nm|μm|µm|m|s|kg|g|mol|M|L|A|mA|μA|µA|nA|V|Pa)(?:\b|[\/²³]))/gu,
        (_, exponent) => '10−' + exponent
      );
    }
    // In some font subsets the minus is on the baseline but the exponent
    // digits retain their own Unicode superscript encoding (10−⁶). Here the
    // raised digit makes the exponent unambiguous; normalize before marking.
    text = text.replace(
      /(?<![\p{L}\p{N}])10\s*[−-]\s*([⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3})(?![\p{L}\p{N}])/gu,
      (_, digits) => '10−' + [...digits].map(ch => superscriptCharacters[ch]).join('')
    );
    const parts = [];
    // A private marker prevents later formatting passes from modifying HTML tags.
    const save = rendered => {
      const n = parts.push(rendered) - 1;
      return '\uE000' + n + '\uE001';
    };
    const put = (re, render) => {
      text = text.replace(re, (...args) => {
        const original = args[0];
        const formatted = render(original, ...args.slice(1));
        return formatted == null ? original : save(formatted);
      });
    };
    // Source-encoded raised/lowered glyphs are explicit mathematical typography.
    // Preserve their intent across platforms, including Greek mathematical text.
    put(
      supRX,
      raw => `<sup>${escape([...raw].map(ch => superscriptCharacters[ch]).join(''))}</sup>`
    );
    put(subRX, raw => `<sub>${escape([...raw].map(ch => subscriptCharacters[ch]).join(''))}</sub>`);
    // Citation page ranges and journal volume ranges such as 10-12 must NOT be
    // converted to powers of ten; a plain ASCII hyphen is ambiguous.
    // Scientific notation, both compact 10−6 and spaced × 10−6.
    put(/(?<![\p{L}\p{N}])10−\d{1,3}(?!\d)/gu, (raw, offset, full) => {
      // In references, preserve negative ranges unless multiplication makes
      // the scientific-notation interpretation explicit.
      if (conservative && !/[×⋅]\s*$/.test(full.slice(Math.max(0, offset - 8), offset)))
        return null;
      const m = raw.match(/10−(\d+)/);
      return m ? `10<sup>−${escape(m[1])}</sup>` : null;
    });
    // Electron charge in electrode-reaction notation, not mathematical e.
    put(/(?<![\p{L}])e\s*[−-](?=$|[\s+→⇌\)\],;])/gu, () => 'e<sup>−</sup>');
    // SI-unit powers. Only unit symbols in a units context qualify; never infer
    // exponents from an arbitrary letter+number such as a chapter identifier.
    const si =
      '(?:mol|mmol|kmol|cm|mm|nm|μm|m|km|kg|mg|μg|g|ns|μs|ms|s|mA|μA|nA|pA|A|mV|μV|V|mF|μF|nF|pF|F|Ω|Pa|J|Hz|L)';
    const unitPower = new RegExp(
      '(?<![\\p{L}\\p{N}])(' +
        si +
        ')\\s*([−–-]\\s*\\d+(?:\\s*[∕/]\\s*\\d+)?|[23](?:\\s*[∕/]\\s*\\d+)?)\\b',
      'gu'
    );
    put(unitPower, (raw, unit, power) => {
      if (/\b(?:F|J|V|A|Pa|Hz|L)\d/.test(raw) && !/[−-]/.test(power)) return null;
      return `<span class="sci-unit">${escape(unit)}<sup>${escape(power.replace(/\s+/g, '').replace(/[–-]/g, '−'))}</sup></span>`;
    });
    // A number appearing after a bracketed group's subscript can be an
    // ionic charge in PDF extraction, e.g. Fe(CN)6 3−. Reassemble only when
    // BOTH the group and charge are explicit and all element tokens exist.
    put(
      /(?<![\p{L}\p{N}])([A-Z][a-z]?)\s*\(((?:[A-Z][a-z]?\d*)+)\)\s*(\d{1,2})\s+(\d{1,2})([+−-])(?![\p{L}\p{N}])/gu,
      (raw, metal, body, count, charge, sign) => {
        if (
          !elements.has(metal) ||
          +count < 1 ||
          +charge < 1 ||
          +charge > 9 ||
          ![...body.matchAll(/[A-Z][a-z]?/g)].every(m => elements.has(m[0]))
        )
          return null;
        const inner = body.replace(
          /([A-Z][a-z]?)(\d*)/g,
          (_, sym, n) => escape(sym) + (n ? `<sub>${escape(n)}</sub>` : '')
        );
        return `${escape(metal)}(${inner})<sub>${escape(count)}</sub><sup>${escape(charge + sign.replace('-', '−'))}</sup>`;
      }
    );
    // A few PDF fonts place ionic charge ABOVE a formula's final subscript,
    // which the source parser reads out of order (e.g. group 3+6). The following
    // strictly local, element-validated reassembly uses both printed numbers.
    put(
      /(?<![\p{L}\p{N}])([A-Z][a-z]?)\s*\(((?:[A-Z][a-z]?\d*)+)\)\s*(\d{1,2})([+−-])\s*(\d{1,2})(?![\p{L}\p{N}])/gu,
      (raw, metal, body, charge, sign, count) => {
        if (
          !elements.has(metal) ||
          ![...body.matchAll(/[A-Z][a-z]?/g)].every(m => elements.has(m[0]))
        )
          return null;
        const inner = body.replace(
          /([A-Z][a-z]?)(\d*)/g,
          (_, sym, n) => escape(sym) + (n ? `<sub>${escape(n)}</sub>` : '')
        );
        return `${escape(metal)}(${inner})<sub>${escape(count)}</sub><sup>${escape(charge + sign.replace('-', '−'))}</sup>`;
      }
    );
    put(
      /(?<![\p{L}\p{N}])((?:[A-Z][a-z]?){1,3})\s+(\d{1,2})([+−-])\s*(\d{1,2})(?![\p{L}\p{N}])/gu,
      (raw, atoms, charge, sign, count) => {
        const elems = [...atoms.matchAll(/[A-Z][a-z]?/g)].map(x => x[0]);
        if (!elems.length || !elems.every(x => elements.has(x))) return null;
        return (
          elems.map(escape).join('') +
          `<sub>${escape(count)}</sub><sup>${escape(charge + sign.replace('-', '−'))}</sup>`
        );
      }
    );
    // Brackets explicitly delimit coordination complexes. Unlike an unspaced
    // SO42− token, an outside bracket charge is unambiguous in the source.
    put(
      /(?<![\p{L}\p{N}])\[([A-Z][a-z]?)\(((?:[A-Z][a-z]?\d*)+)\)(\d{1,2})\]\s*(\d{1,2})?([+−-])(?![\p{L}\p{N}])/gu,
      (raw, metal, body, count, charge, sign) => {
        const symbols = [...body.matchAll(/[A-Z][a-z]?/g)].map(match => match[0]);
        if (
          !elements.has(metal) ||
          !symbols.length ||
          !symbols.every(el => elements.has(el)) ||
          +count < 1 ||
          +count > 99 ||
          Number(charge || 1) > 9
        )
          return null;
        const atoms = body.replace(
          /([A-Z][a-z]?)(\d*)/g,
          (_, el, n) => escape(el) + (n ? `<sub>${escape(n)}</sub>` : '')
        );
        return `[${escape(metal)}(${atoms})<sub>${escape(count)}</sub>]<sup>${escape((charge || '') + sign.replace('-', '−'))}</sup>`;
      }
    );
    // Proper chemical stoichiometry and ionic charges. A periodic-table lexer
    // avoids treating ordinary words or arbitrary reference labels as formulas.
    const formula =
      /(?<![\p{L}])(?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+(?:\d*[+−-])?(?![a-zA-Z])/gu;
    put(formula, raw => {
      if (!/\d|[+−-]$/.test(raw)) return null;
      // e.g. SO42− might mean SO₄²⁻, but the flattened ASCII string cannot
      // establish whether the 2 is charge or stoichiometry. Do not invent it.
      if (/[A-Z][a-z]?\d{2,}[+−-]$/.test(raw)) return null;
      const pieces = [],
        segment = /(\((?:[A-Z][a-z]?\d*)+\)\d*|[A-Z][a-z]?\d*|\d*[+−-])/g;
      let scan = 0,
        meaningful = false,
        valid = true;
      for (const match of raw.matchAll(segment)) {
        if (match.index !== scan) {
          valid = false;
          break;
        }
        scan += match[0].length;
        const t = match[0];
        if (/^\d*[+−-]$/.test(t)) {
          const digits = t.slice(0, -1),
            sign = t.slice(-1).replace('-', '−');
          pieces.push(`<sup>${escape(digits + sign)}</sup>`);
          meaningful = true;
          continue;
        }
        if (t[0] === '(') {
          const mm = t.match(/^\((.+)\)(\d*)$/),
            body = mm[1],
            count = mm[2];
          const inner = body.replace(/([A-Z][a-z]?)(\d*)/g, (_, sym, num) => {
            if (!elements.has(sym)) valid = false;
            return escape(sym) + (num ? `<sub>${escape(num)}</sub>` : '');
          });
          pieces.push(`(${inner})${count ? `<sub>${escape(count)}</sub>` : ''}`);
          meaningful ||= !!count;
          continue;
        }
        const mm = t.match(/^([A-Z][a-z]?)(\d*)$/);
        if (!mm || !elements.has(mm[1])) {
          valid = false;
          break;
        }
        pieces.push(escape(mm[1]) + (mm[2] ? `<sub>${escape(mm[2])}</sub>` : ''));
        meaningful ||= !!mm[2];
      }
      if (scan !== raw.length || !valid || !meaningful) return null;
      // A trailing 2+ means oxidation state, not a chemical subscript.
      const charged = raw.match(/^([A-Z][a-z]?)(\d+)([+−-])$/);
      if (charged && elements.has(charged[1]))
        return (
          escape(charged[1]) + `<sup>${escape(charged[2] + charged[3].replace('-', '−'))}</sup>`
        );
      return pieces.join('');
    });
    // Common electrochemical variable indices. These are generic notation
    // patterns, not entries or facts from a copyrighted book.
    const indices = [
      ['ΔE', 'p'],
      ['E', 'eq'],
      ['E', 'appl'],
      ['E', 'pa'],
      ['E', 'pc'],
      ['E', 'pf'],
      ['E', 'pr'],
      ['E', 'fb'],
      ['E', 'dc'],
      ['E', '1/2'],
      ['E', '1'],
      ['E', '2'],
      ['E', '0'],
      ['r', '0'],
      ['R', 'ct'],
      ['R', 'mt'],
      ['R', 'u'],
      ['R', 's'],
      ['C', 'dl'],
      ['C', 'd'],
      ['D', 'O'],
      ['D', 'R'],
      ['C', 'O'],
      ['C', 'R'],
      ['i', 'pa'],
      ['i', 'pc'],
      ['i', 'pf'],
      ['i', 'pr'],
      ['i', 'l'],
      ['i', '0'],
      ['i', 'c'],
      ['i', 'a'],
      ['m', 'O'],
      ['m', 'R'],
      ['k', '0'],
      ['j', '0'],
      ['q', 'M'],
      ['q', 'S'],
      // Circuit diagrams may label electrical signals and amplifier stages
      // with numeric indices; these remain distinct from chemical formulas.
      ['e', '1'],
      ['e', '2'],
      ['Z', '1'],
      ['Z', '2']
    ].sort((a, b) => (b[0] + b[1]).length - (a[0] + a[1]).length);
    if (!conservative)
      for (const [base, index] of indices) {
        const re = new RegExp(
          '(?<![\\p{L}\\p{N}])(' +
            base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            ')\\s*(' +
            index.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            ')(?![\\p{L}\\p{N}\\uE000])',
          'gu'
        );
        put(
          re,
          () =>
            escape(base) +
            (index === '0' && (base === 'E' || base === 'k')
              ? '<sup>0</sup>'
              : `<sub>${escape(index)}</sub>`)
        );
      }
    return escape(text).replace(/\uE000(\d+)\uE001/g, (_, n) => parts[+n] || '');
  }
  /** Highlight rendered text nodes, never splitting a chemical or HTML tag. */
  function highlight(value, query, options = {}) {
    const formatted = html(value, options);
    const terms = String(query ?? '')
      .split(/\s+/)
      .filter(s => s.length > 1 && s.length < 80);
    if (!terms.length) return formatted;
    const expression = new RegExp(
      '(' +
        [...new Set(terms)]
          .sort((a, b) => b.length - a.length)
          .map(escapeRegExp)
          .join('|') +
        ')',
      'gi'
    );
    // Tags and entities form separate protected tokens; only human-readable
    // text may receive mark elements. The result remains sanitized HTML.
    return formatted.replace(
      /(<[^>]*>|&(?:#[0-9]+|#x[0-9a-f]+|[a-z]+);)|([^<&]+)/gi,
      (whole, protectedToken, text) => protectedToken || text.replace(expression, '<mark>$1</mark>')
    );
  }
  /** Render explicit PDF typography without inferring new mathematical meaning. */
  function runsHtml(value, runs, options = {}) {
    if (
      !Array.isArray(runs) ||
      !runs.length ||
      !runs.every(run => run && typeof run.text === 'string')
    )
      return html(value, options);
    const rendered = runs
      .map(run => {
        const classes = [];
        if (run.bold === true) classes.push('notation-bold');
        if (run.italic === true) classes.push('notation-italic');
        if (run.scriptFont === true) classes.push('notation-script');
        if (run.overbar === true) classes.push('notation-overbar');
        const text = escape(run.text);
        const styled = classes.length ? `<span class="${classes.join(' ')}">${text}</span>` : text;
        const scripts =
          Array.isArray(run.scripts) &&
          run.scripts.length <= 4 &&
          run.scripts.every(script => script === 'sub' || script === 'super')
            ? run.scripts
            : ['sub', 'super'].includes(run.script)
              ? [run.script]
              : [];
        return scripts.reduceRight((inner, script) => {
          const tag = script === 'super' ? 'sup' : 'sub';
          return `<${tag}>${inner}</${tag}>`;
        }, styled);
      })
      .join('');
    return `<span class="source-notation">${rendered}</span>`;
  }

  root.AtlasScience = { html, escape, highlight, runsHtml };
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { html, escape, highlight, runsHtml };
})(typeof window !== 'undefined' ? window : globalThis);
