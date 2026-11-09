/* Build the Atlas catalog in memory from the reader's original PDF.
   NO book data or extraction results are included in the distribution. */
(root => {
  'use strict';
  const textTools =
    root?.AtlasText ||
    (typeof module === 'object' && module.exports ? require('../core/text.js') : null);
  const repairProseSpacing = textTools?.repairProseSpacing || (value => String(value ?? ''));
  const clean = s =>
    String(s || '')
      .replace(/[\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const stripped = s =>
    clean(s)
      .normalize('NFKD')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
  const printed = (engine, page) => engine.labels[page - 1] || String(page);
  const numberFromTitle = s =>
    (s.match(/^(?:Chapter\s+)?(\d+(?:\.\d+){0,4}|[A-C](?:\.\d+){0,3})\b/i) || [])[1] || '';
  function sectionsFromOutline(engine) {
    const list = [],
      stack = [],
      toc = [];
    for (const r of engine.outline) {
      const chapter = /^Chapter\s+\d+\b/i.test(r.title),
        appendix = r.level === 1 && /^(?:Appendix\s+)?[A-C]\s+\S/i.test(r.title);
      const id = chapter
        ? r.title.match(/Chapter\s+(\d+)/i)[1]
        : appendix
          ? r.title.match(/^(?:Appendix\s+)?([A-C])/i)[1]
          : numberFromTitle(r.title);
      toc.push({
        level: r.level,
        title: r.title,
        page: r.page - 1,
        page1: r.page,
        id,
        kind: 'toc',
        y: r.y || 0
      });
      if (!chapter && !appendix && !id) continue;
      const kind = chapter ? 'chapter' : appendix ? 'appendix' : 'section';
      const key = chapter
        ? 'chapter-' + id
        : appendix
          ? 'appendix-' + id.toLowerCase()
          : 'section-' + id;
      while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].key : null;
      const s = {
        key,
        kind,
        level: r.level,
        id,
        title: r.title,
        short_title: r.title.replace(
          /^(?:Chapter\s+\d+\s*|(?:Appendix\s+)?[A-C]\s*|[A-C]?\d+(?:\.\d+)*\s*)/i,
          ''
        ),
        parent,
        pdf_page: r.page,
        printed_page: printed(engine, r.page),
        pdf_page_end: r.page,
        y: r.y || 0,
        excerpt: '',
        children: []
      };
      list.push(s);
      if (stack.length) stack[stack.length - 1].children.push(key);
      stack.push(s);
    }
    for (let i = 0; i < list.length; i++) {
      let next = list.length ? engine.pageObjects.length + 1 : 0;
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].level <= list[i].level) {
          next = list[j].pdf_page;
          break;
        }
      }
      list[i].pdf_page_end = Math.max(list[i].pdf_page, next - 1);
    }
    return { toc, sections: list };
  }
  function sectionFor(sections, page) {
    let found = null;
    for (const s of sections) {
      if (s.pdf_page <= page && s.pdf_page_end >= page && (!found || s.level >= found.level))
        found = s;
    }
    return found;
  }
  function sourceExcerpt(text, s) {
    const lines = String(text || '').split(/\r?\n/);
    const norm = x =>
      clean(x)
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .toLowerCase();
    const target = norm(s.short_title);
    const id = String(s.id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const test = new RegExp('^' + id + '(?:\\s+|$)');
    let at = -1;
    for (let k = 0; k < lines.length; k++) {
      const part = clean(lines[k]);
      if (!test.test(part)) continue;
      const tail = part.slice(String(s.id).length).trim();
      if (tail && target && !norm(tail).includes(target.slice(0, Math.min(9, target.length))))
        continue;
      at = k + 1;
      if (!tail) {
        // Chapters have a standalone chapter number, then a separate chapter title.
        while (at < lines.length && /^\d{1,3}$/.test(clean(lines[at]))) at++;
        if (at < lines.length && norm(lines[at]).includes(target.slice(0, 12))) at++;
      }
      break;
    }
    if (at < 0) return '';
    // Do not reuse a neighboring figure caption or unrelated body paragraph when a
    // heading cannot be identified. Preserve the source's own words otherwise.
    const prose = [];
    for (let k = at; k < Math.min(lines.length, at + 17); k++) {
      const t = clean(lines[k]);
      if (!t) continue;
      if (/^(?:Figure|Table)\s+(?:[A-C]|\d)/.test(t)) break;
      prose.push(t);
      if (prose.join(' ').length > 490) break;
    }
    let r = clean(prose.join(' '));
    return r.slice(0, 420);
  }
  function addEntry(list, seen, label, pg, title, text, extra = {}) {
    if (!label || seen.has(label)) return;
    seen.add(label);
    const desc = clean(text).slice(0, 410);
    list.push({
      label,
      title,
      caption: desc,
      description: desc,
      context: desc,
      text: desc,
      pdf_page: pg,
      printed_page: extra.printed_page || '',
      y: 0,
      ...extra
    });
  }

  // Reflow styled text fragments from the selected PDF. Font changes, subscripts,
  // and superscripts can split a single printed word across many PDF text spans.
  function reflowFragment(fragment) {
    let s = String(fragment || '')
      .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
      .replace(
        /[\uFB00-\uFB06]/g,
        ch => ({ ﬀ: 'ff', ﬁ: 'fi', ﬂ: 'fl', ﬃ: 'ffi', ﬄ: 'ffl', ﬅ: 'st', ﬆ: 'st' })[ch] || ch
      );
    s = s.replace(/([A-Za-z])[-‐]\n(?=[a-z])/g, '$1');
    s = s.replace(/\(\s*\n\s*([a-d])\s*\n\s*\)/gi, '($1)');
    s = s.replace(/\b([A-Za-z]{1,5})\n([0-9]{1,2})(?=\n|\b)/g, '$1$2');
    s = s.replace(/([0-9])\n([+−–-])(?=\n|\s|\W|$)/g, '$1$2');
    s = s.replace(/([0-9])\n([A-Z][a-z]?)(?=\n|\s|$)/g, '$1$2');
    s = s.replace(/([A-Za-z0-9])\n([+−∕×=])(?=\n|$)/g, '$1$2');
    s = s.replace(/\n/g, ' ');
    s = s.replace(/\s+([,.;:!?)}\]])/g, '$1').replace(/([([{])\s+/g, '$1');
    s = s.replace(/([A-Za-z])-(?=\s+[a-z])/g, '$1');
    return s.replace(/\s+/g, ' ').trim();
  }
  function reflowRuns(runs) {
    let result = '';
    for (const run of runs) {
      const t = reflowFragment(run.text);
      if (!t) continue;
      if (!result) {
        result = t;
        continue;
      }
      const a = result[result.length - 1],
        b = t[0];
      const letter = x => /^[a-zA-Z𝛼𝛽𝛾𝛿𝜀𝜂𝜃𝜎𝜏𝜙𝜒𝜓𝜔ΓΔΩ]$/.test(x);
      let join = '';
      if (letter(a) && letter(b)) join = ' ';
      else if ((letter(a) || /[0-9)]/.test(a)) && b === '(') join = ' ';
      else if (/[.?!;:]$/.test(a) && letter(b)) join = ' ';
      else if (/[0-9)]/.test(a) && letter(b)) join = ' ';
      else if (letter(a) && /[0-9]/.test(b)) {
        // A font change can split a charge (Fe + 3+) or unit power (cm + 2).
        // Ordinary words followed by a number still require a separating space
        // (e.g. "of" + "10" must not become "of10").
        const token = result.match(/([A-Za-zμµΩ]+)$/u)?.[1] || '';
        const inline =
          /^[A-Z][a-z]?$/.test(token) ||
          /^(?:cm|mm|nm|μm|µm|m|mol|s|kg|g|L|A|V|F|Ω|mA|μA|µA|nA)$/.test(token);
        join = inline ? '' : ' ';
      } else if (a === ',' && letter(b)) join = ' ';
      else if (/[+′−]/.test(a) && letter(b)) join = ' ';
      if (
        /[0-9]/.test(a) &&
        /^[a-d]$/.test(t) &&
        run.font === 'F5' &&
        /Figure\s+[A-C0-9][.A-Za-z0-9]*$/.test(result)
      )
        join = '';
      result += join + t;
    }
    return repairProseSpacing(
      clean(result)
        .replace(/\s+([,.;:!?)}\]])/g, '$1')
        .replace(/([([{])\s+/g, '$1')
    );
  }
  function actualCaption(engine, pg, blocks, kind, ctx) {
    const store = kind === 'Figure' ? ctx.figures : ctx.tables,
      seen = kind === 'Figure' ? ctx.seen.fig : ctx.seen.tab;
    for (const b of blocks || []) {
      for (let i = 0; i < b.runs.length; i++) {
        const run = b.runs[i];
        if (
          run.font !== 'F2' &&
          !(
            kind === 'Figure' &&
            run.font === 'F3' &&
            b.text.trimStart().startsWith('Figure ') &&
            run.text.trimStart().startsWith('Figure ')
          )
        )
          continue;
        const match = run.text.match(
          new RegExp(
            '(?:^|\\n)' + kind + '\\s+([A-C](?:\\.\\d+){1,3}|\\d+(?:\\.\\d+){0,3})(?![\\d.])',
            'i'
          )
        );
        if (!match) continue;
        const label = match[1];
        if (/^\d+\./.test(label)) {
          const ch = ctx.sections.find(s => s.kind === 'chapter' && s.id === label.split('.')[0]);
          if (!ch || pg < ch.pdf_page || pg > ch.pdf_page_end) continue;
        } else if (/^[A-C]\./.test(label)) {
          const app = ctx.sections.find(s => s.kind === 'appendix' && s.id === label[0]);
          if (!app || pg < app.pdf_page || pg > app.pdf_page_end) continue;
        } else if (pg < 26 || pg > 54) continue;
        let fragments = [];
        let mainFont = '';
        const trailing = run.text.slice(run.text.indexOf(match[0]) + match[0].length).trim();
        if (trailing) fragments.push({ font: run.font, text: trailing });
        const captionFont = f => /^F(?:8|9|10|11|12|13|14)$/.test(f);
        const addRuns = more => {
          for (const r of more) {
            const content = r.text.trim();
            if (!content) continue;
            // A mathematical symbol in F2 is not another heading. An actual
            // section/caption heading in F2 ends the current caption.
            if (
              r.font === 'F2' &&
              (/^(?:Figure|Table)\s+[\dA-C]|^\d{1,2}\.\d+\s+\w/.test(content) ||
                content.length > 18)
            )
              break;
            if (!mainFont) mainFont = r.font;
            // The body uses F3/F4, while figure captions are in the distinct
            // Myriad F8..F12 face. Stop before adjoining body paragraphs.
            if (
              kind === 'Figure' &&
              captionFont(mainFont) &&
              ((r.font === 'F3' &&
                (content.length > 18 || /[.?!\]]$/.test(reflowRuns(fragments)))) ||
                (r.font === 'F4' &&
                  (content.length > 18 || /[.?!\]]$/.test(reflowRuns(fragments)))) ||
                (/^F(?:13|19|20|23|24)$/.test(r.font) &&
                  r.font !== mainFont &&
                  content.length > 14))
            )
              break;
            if (kind === 'Figure' && r.font === 'F3' && mainFont !== 'F3' && content.length > 90)
              break;
            if (kind === 'Table' && fragments.length > 1 && r.font === 'F3' && mainFont !== 'F3')
              break;
            fragments.push(r);
            if (kind === 'Table' && fragments.length > 8) break;
          }
        };
        addRuns(b.runs.slice(i + 1));
        // A mathematical superscript can force a continuation of a caption into
        // a separate PDF BT/ET block; include the next block only if it uses
        // the same caption typeface and the prior block ended mid-sentence.
        if (kind === 'Figure' && captionFont(mainFont)) {
          for (
            let j = blocks.indexOf(b) + 1, steps = 0;
            j < blocks.length && steps < 8;
            j++, steps++
          ) {
            if (/[.?!\]）]$/.test(reflowRuns(fragments))) break;
            const adjacent = blocks[j];
            if (
              !adjacent.runs.some(r => captionFont(r.font) && r.text.trim().length > 15) ||
              adjacent.runs.some(r => r.font === 'F2' && /^(Figure|Table)\s+/.test(r.text.trim()))
            )
              break;
            addRuns(adjacent.runs);
          }
        }
        let desc = reflowRuns(fragments);
        if (kind === 'Table') {
          // Table titles are short; never sweep the table itself into a description.
          const first = desc.match(/^(.{7,180}?[.?!])(?:\s|$)/);
          if (first) desc = first[1];
          if (desc.length > 170)
            desc = desc
              .slice(0, 170)
              .replace(/\s+\S*$/, '')
              .trim();
        }
        desc = desc.replace(/\s*\u0002/g, '').trim();
        // A publisher credit closes the caption. Avoid absorbing the first
        // sentence of the following section when text fragments share a PDF block.
        if (kind === 'Figure')
          desc = desc.replace(
            /(\[[^\]]*(?:permission|reprinted|adapted|copyright|©)[^\]]*\])\s*(?=[A-Z][a-z]+(?:\s|$))[\s\S]*$/i,
            '$1'
          );
        // Some problem diagrams have only a bold figure number. That printed
        // label is still a valid catalog entry even without a prose caption.
        const labelOnlyFigure = kind === 'Figure' && run.font === 'F2' && !desc;
        if (
          !labelOnlyFigure &&
          (desc.length < 7 || /^(?:is|are|shows|see|has|given|can|was)\b/i.test(desc))
        )
          continue;
        // Some printed figures have a caption followed by prose in the same PDF BT;
        // the font boundary above keeps those distinct.
        const item = {
          label,
          title: kind + ' ' + label,
          caption: desc,
          description: desc,
          text: desc,
          pdf_page: pg,
          printed_page: printed(engine, pg),
          y: 0,
          source_kind: 'Original ' + kind.toLowerCase() + ' caption from selected PDF'
        };
        const prev = store.findIndex(x => x.label === label);
        if (prev < 0) {
          store.push(item);
          seen.add(label);
        } else if (store[prev].pdf_page === pg && desc.length > store[prev].description.length)
          store[prev] = item;
      }
    }
  }

  function extractPerPage(engine, page, rows, ctx, blocks) {
    const raw = rows.text;
    if (!raw) return;
    const lines = raw
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean);
    actualCaption(engine, page, blocks, 'Figure', ctx);
    actualCaption(engine, page, blocks, 'Table', ctx);
  }
  function extractEquations(engine, pages, ctx, directAnchors) {
    const located = new Set();
    const make = (label, page, explicit, y = 0) => {
      if (located.has(label)) return;
      const chapter = label.match(/^(\d+|[A-C])\./)?.[1];
      const within = ctx.sections.find(
        s => (s.kind === 'chapter' || s.kind === 'appendix') && s.id === chapter
      );
      if (!within || page < within.pdf_page || page > within.pdf_page_end) return;
      const part = sectionFor(ctx.sections, page);
      const title = part?.title || (chapter.match(/^\d+$/) ? 'Chapter ' : 'Appendix ') + chapter;
      const context = 'In ' + title + '.';
      addEntry(ctx.equations, located, label, page, 'Equation ' + label, context, {
        description: context,
        context,
        printed_page: printed(engine, page),
        y,
        source_kind: explicit
          ? 'Printed equation number in selected PDF'
          : 'Equation label located in selected PDF',
        section_key: part?.key,
        section_title: title
      });
    };
    // First use equation labels that occur as their own PDF text operators. These
    // distinguish an equation's location from a reference to it elsewhere.
    for (const anchor of directAnchors) make(anchor.label, anchor.pdf_page, true, anchor.y);
    // Some formulas in the source are typeset as multiple text operators, making
    // their labels inaccessible to the first method. Fall back to text matching.
    const candidates = new Map();
    for (const page of pages) {
      for (const line of page.text.split(/\n+/)) {
        for (const m of line.matchAll(
          /\(((?:\d{1,2}|[A-C])\.\d{1,2}\.\d{1,3}[a-z]?(?:,[a-z])?)\)/g
        )) {
          const label = m[1];
          if (located.has(label)) continue;
          const hit = { label, page: page.pdf_page, line: line.trim() };
          // Prefer labels isolated on a formula line over prose cross-references.
          hit.score =
            (line.trim() === '(' + label + ')' ? 6 : 0) +
            (line.trim().endsWith('(' + label + ')') ? 3 : 0) +
            (line.trim().length < 75 ? 1 : 0);
          if (!candidates.has(label) || hit.score > candidates.get(label).score)
            candidates.set(label, hit);
        }
      }
    }
    for (const candidate of candidates.values()) make(candidate.label, candidate.page, false);
    // A few source pages combine two lettered equation labels into one displayed
    // expression (e.g., 1.4.9a,b). Those shared groups are kept as one entry.
    ctx.equations.sort(
      (a, b) =>
        a.pdf_page - b.pdf_page || a.label.localeCompare(b.label, undefined, { numeric: true })
    );
  }
  /**
   * Separate illustrated page insertions from the problem statement around
   * them. PDF text-show operators can put graph tick labels and legends between
   * the final words of a problem on one page and its continuation on the next.
   *
   * Only remove a run of non-prose blocks when a matching source Figure/Table
   * caption establishes that the content is an insertion. This avoids a global
   * removal of short formulae, numerical data, or valid problem subparts.
   */
  function problemInsertionBlocks(blocks, chapter) {
    const ignored = new Set();
    if (!Array.isArray(blocks) || !blocks.length) return ignored;
    const contents = blocks.map(b => reflowRuns(b.runs || []) || reflowFragment(b.text));
    const caption = /^(?:Figure|Table)\s+(?:[A-C]\.\d+|\d+(?:\.\d+){0,3})(?=\s|\(|[.:]|$)/i;
    const itemLabel = new RegExp(
      '^' + String(chapter).replace(/[^A-C0-9]/gi, '') + '\\.\\d{1,3}(?:\\s|$)'
    );
    const hasSentences = text => {
      const words = text.match(/\b[a-z]{3,}\b/gi) || [];
      return words.length >= 5 && (text.match(/[a-z]/gi) || []).length >= text.length * 0.4;
    };
    const graphLike = text => {
      if (!text) return true;
      if (/^(?:[\d.+−–\-\s°µμΩ/()]+|\([a-z]\)|[a-z])$/i.test(text)) return true;
      if (
        /(?:\bvs\.?\b|\b(?:cm|mV|µF|dyn|NCE|SCE)\b|\d[.,]\d)/i.test(text) &&
        (text.match(/\b[a-z]{3,}\b/gi) || []).length < 5
      )
        return true;
      const digits = (text.match(/\d/g) || []).length;
      const letters = (text.match(/[a-z]/gi) || []).length;
      return digits >= 4 && digits >= letters * 0.6;
    };
    const bodyFont = block => (block.runs || []).some(r => r.font === 'F3' || r.font === 'F4');
    const isBody = (text, block) => {
      if (graphLike(text)) return false;
      if (hasSentences(text))
        return bodyFont(block) || (text.match(/\b[a-z]{3,}\b/gi) || []).length >= 14;
      // A text operator may contain only the last two words of a paragraph.
      // Preserve fragments such as "Sketch the" before a figure insertion.
      return (
        bodyFont(block) &&
        /^[A-Z]?[a-z]+(?:\s+[a-z]+){1,7}[.!?:]?$/i.test(text) &&
        /\b(?:the|of|to|and|for|which|with|by|will|in|at|be|from|are|is|what|how)\b/i.test(text)
      );
    };
    for (let i = 0; i < blocks.length; i++) {
      const text = contents[i];
      if (!caption.test(text)) continue;
      ignored.add(i);
      // Figure art normally comes BEFORE its caption; keep the last ordinary
      // paragraph intact (it can end without a period, e.g. "Sketch the").
      let j = i - 1,
        candidates = [];
      for (; j >= 0; j--) {
        const prior = contents[j];
        if (!prior || itemLabel.test(prior) || isBody(prior, blocks[j]) || caption.test(prior))
          break;
        candidates.push(j);
        if (candidates.length >= 60) break;
      }
      if (candidates.length >= 2 || candidates.some(k => graphLike(contents[k])))
        for (const k of candidates) ignored.add(k);
      // Tables often print their title ABOVE the rows. Allow the prose to
      // resume after the inserted table, even on the very same PDF page.
      if (/^Table\s/i.test(text)) {
        const following = [];
        for (let k = i + 1; k < blocks.length; k++) {
          const after = contents[k];
          if (!after || itemLabel.test(after) || caption.test(after) || isBody(after, blocks[k]))
            break;
          following.push(k);
          if (following.length >= 90) break;
        }
        if (following.length >= 2 || following.some(k => graphLike(contents[k])))
          for (const k of following) ignored.add(k);
      }
    }
    return ignored;
  }
  /** Running headers/footers are not part of a problem continuation. */
  function problemRunningMatter(text, blockIndex, totalBlocks, chapter) {
    const value = clean(text);
    if (!value) return true;
    if (
      /^\d{1,2}\.\d+\s+Problems\s+\d{1,4}$/i.test(value) ||
      /^\d{1,4}\s+\d{1,2}\s+[A-Z][A-Za-z\-–,\s]+$/.test(value)
    )
      return true;
    if ((blockIndex < 3 || blockIndex >= totalBlocks - 2) && /^\d{1,4}$/.test(value)) return true;
    // Headers can use either "14.9 Problems 649" or "650 14 Chapter name".
    if (blockIndex < 3 && new RegExp('^\\d{1,4}\\s+' + String(chapter) + '\\s+').test(value))
      return true;
    return false;
  }
  function parseProblemsAndRefs(engine, pages, ctx, blocksByPage) {
    for (const section of ctx.sections) {
      if (!/(?:\bProblems|\bReferences)\b/i.test(section.title)) continue;
      const isProblem = /\bProblems\b/i.test(section.title);
      const chapter = section.id.match(/^(\d+|[A-C])/i)?.[1];
      if (!chapter) continue;
      const limit = Math.min(
        pages.length,
        section.pdf_page_end + (isProblem ? 0 : 1),
        section.pdf_page + 28
      );
      let started = false,
        record = null,
        expected = 1,
        stop = false;
      const nextSection = ctx.sections
        .slice(ctx.sections.indexOf(section) + 1)
        .find(x => x.level <= section.level);
      const labelRX = isProblem
        ? new RegExp('(?:^|\\n)(' + chapter + '\\.\\d{1,3})(?=\\n|$)', 'g')
        : /((?:^|\n)(\d{1,3}))(?=\n|$)/g;
      const finish = () => {
        if (!record) return;
        let value = reflowRuns(record.fragments);
        if (
          !isProblem &&
          nextSection &&
          (nextSection.kind === 'chapter' || nextSection.kind === 'appendix')
        ) {
          const nextTitle = nextSection.short_title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const nextId = nextSection.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // Page headers can share a text block with the last bibliography
          // entry; remove only when they match the actual next heading.
          value = value
            .replace(
              new RegExp(
                '\\s*(?:ff\\s*){0,4}(?:Chapter\\s+|Appendix\\s+)?' +
                  nextId +
                  '\\s+' +
                  nextTitle +
                  '.*$',
                'i'
              ),
              ''
            )
            .trim();
        }
        if (!isProblem) {
          const root =
            ctx.sections.find(x => x.kind === 'chapter' && x.id === String(chapter)) ||
            ctx.sections.find(x => x.kind === 'appendix' && x.id === String(chapter));
          if (root) {
            const escapedTitle = root.short_title
              .replace(/[‐‑‒–—−]/g, '-')
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              .replace(/-/g, '[-‐‑‒–—−]');
            const escapedId = String(chapter).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Discard a running chapter header appended after a citation when
            // the source PDF laid out the header and final reference together.
            value = value
              .replace(
                new RegExp(
                  '\\s*(?:ff\\s*){0,4}' + escapedId + '\\s+' + escapedTitle + '\\s*$',
                  'i'
                ),
                ''
              )
              .trim();
          }
        }
        if (isProblem)
          value = value.replace(/\s*\d{1,2}\.\d{1,2}\s+Problems\s*\d{1,4}\s*$/i, '').trim();
        if (value.length >= 12) {
          if (isProblem) {
            if (!ctx.seen.prob.has(record.label)) {
              ctx.seen.prob.add(record.label);
              const text = record.label + ' ' + value;
              ctx.problems.push({
                label: record.label,
                title: 'Problem ' + record.label,
                text,
                caption: value.slice(0, 410),
                description: value.slice(0, 410),
                context: value.slice(0, 410),
                pdf_page: record.page,
                pdf_page_end: record.lastPage,
                printed_page: printed(engine, record.page),
                source_kind: 'Original problem statement from selected PDF'
              });
            }
          } else {
            const key = chapter + '-' + record.label;
            if (!ctx.seen.ref.has(key)) {
              ctx.seen.ref.add(key);
              ctx.references.push({
                chapter,
                number: Number(record.label),
                title: 'Chapter ' + chapter + ', reference ' + record.label,
                text: value,
                description: value.slice(0, 410),
                pdf_page: record.page,
                printed_page: printed(engine, record.page),
                source_kind: 'Original bibliography entry from selected PDF'
              });
            }
          }
        }
        record = null;
      };
      for (let pg = section.pdf_page; pg <= limit && !stop; pg++) {
        const pageBlocks = blocksByPage[pg - 1] || [];
        const insertions = isProblem ? problemInsertionBlocks(pageBlocks, chapter) : null;
        for (let bi = 0; bi < pageBlocks.length && !stop; bi++) {
          const block = pageBlocks[bi];
          if (block.text === '\u0002' || block.text === 'Th' || /^ff$/.test(block.text)) continue;
          if (isProblem && insertions.has(bi)) continue;
          if (
            isProblem &&
            started &&
            problemRunningMatter(block.text, bi, pageBlocks.length, chapter)
          )
            continue;
          for (const run of block.runs) {
            const src = run.text;
            if (started && run.font === 'F2' && nextSection) {
              const nextTitle = nextSection.short_title || '';
              const heading =
                src.includes(nextSection.title) ||
                (nextSection.kind === 'chapter' &&
                  nextTitle.length >= 3 &&
                  src.includes(nextTitle.slice(0, Math.min(24, nextTitle.length)))) ||
                (nextSection.kind === 'appendix' &&
                  nextTitle.length >= 3 &&
                  src.includes(nextTitle.slice(0, Math.min(24, nextTitle.length))));
              if (heading) {
                stop = true;
                break;
              }
            }
            if (!started) {
              const pos = src.indexOf(section.title);
              if (pos < 0) continue;
              started = true;
              // If the heading and the first label share a PDF text span,
              // retain only the text after the heading.
            }
            const isLabelFont = run.font === 'F2';
            if (isLabelFont) {
              let at = 0;
              const matches = [...src.matchAll(labelRX)];
              for (const match of matches) {
                const label = isProblem ? match[1] : match[2];
                const n = Number(isProblem ? label.split('.').at(-1) : label);
                if (n !== expected) continue; // prevents running folios and unrelated numbers
                const idx = match.index + match[0].lastIndexOf(label);
                if (record && idx > at)
                  record.fragments.push({ font: run.font, text: src.slice(at, idx) });
                finish();
                record = { label, page: pg, lastPage: pg, fragments: [] };
                expected++;
                at = idx + label.length;
              }
              // Ignore the remainder of a plain page header, but preserve any
              // fragment after a numbered item if it appears in the same run.
              if (record && at > 0 && at < src.length) {
                const part = src.slice(at);
                if (part.trim() && !/^\d{1,4}$/.test(part.trim())) {
                  record.fragments.push({ font: run.font, text: part });
                  record.lastPage = pg;
                }
              }
            } else if (record) {
              record.fragments.push({ font: run.font, text: src });
              record.lastPage = pg;
            }
          }
        }
      }
      finish();
    }
  }
  // Preserve explicit source typography. The searchable fields remain text;
  // these runs let the UI render only source-proven styles and script levels.
  function notationGlyphs(source) {
    const glyphs = [];
    const nearby = new Map();
    for (const [order, original] of source.entries()) {
      const glyph = { ...original, order };
      const bx = Math.round(glyph.x * 2),
        by = Math.round(glyph.y * 2);
      let duplicate;
      for (let dx = -1; dx <= 1 && !duplicate; dx++)
        for (let dy = -1; dy <= 1 && !duplicate; dy++) {
          const key = [glyph.fontName || glyph.font, glyph.text, bx + dx, by + dy].join('|');
          duplicate = nearby
            .get(key)
            ?.find(
              other =>
                Math.abs(other.x - glyph.x) < glyph.size * 0.05 &&
                Math.abs(other.y - glyph.y) < glyph.size * 0.05 &&
                Math.abs(other.size - glyph.size) < 0.1
            );
        }
      if (duplicate) {
        // Synthetic bold is repeated near-identical ink, not repeated letters.
        duplicate.bold = true;
        duplicate.overbar ||= glyph.overbar;
        continue;
      }
      const key = [glyph.fontName || glyph.font, glyph.text, bx, by].join('|');
      if (!nearby.has(key)) nearby.set(key, []);
      nearby.get(key).push(glyph);
      glyphs.push(glyph);
    }
    for (const mark of glyphs.filter(glyph => /^\p{M}+$/u.test(glyph.text))) {
      const base = glyphs
        .filter(
          glyph =>
            glyph !== mark &&
            /^\p{L}$/u.test(glyph.text) &&
            glyph.y <= mark.y &&
            mark.y - glyph.y < glyph.size * 0.6 &&
            mark.x >= glyph.x - glyph.size * 0.1 &&
            mark.x <= glyph.x + glyph.width
        )
        .sort(
          (a, b) => Math.abs(a.x + a.width / 2 - mark.x) - Math.abs(b.x + b.width / 2 - mark.x)
        )[0];
      if (base) {
        base.text += mark.text;
        mark.merged = true;
      }
    }
    return glyphs.filter(glyph => !glyph.merged);
  }
  function scriptLetter(text, bold) {
    const upper = [...'𝒜ℬ𝒞𝒟ℰℱ𝒢ℋℐ𝒥𝒦ℒℳ𝒩𝒪𝒫𝒬ℛ𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵'];
    const lower = [...'𝒶𝒷𝒸𝒹ℯ𝒻ℊ𝒽𝒾𝒿𝓀𝓁𝓂𝓃ℴ𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏'];
    return text.replace(/[A-Za-z]/g, letter => {
      const capital = letter <= 'Z';
      const index = letter.charCodeAt(0) - (capital ? 65 : 97);
      return bold
        ? String.fromCodePoint((capital ? 0x1d4d0 : 0x1d4ea) + index)
        : (capital ? upper : lower)[index];
    });
  }
  function notationCell(glyphs, bodySize, { identifier = false } = {}) {
    if (!glyphs.length) return { text: '', runs: [], lines: [] };
    const baselines = [];
    for (const glyph of glyphs.filter(
      glyph => glyph.size >= bodySize * 0.9 && !/^\p{M}+$/u.test(glyph.text)
    ))
      if (!baselines.some(y => Math.abs(y - glyph.y) < bodySize * 0.3)) baselines.push(glyph.y);
    if (!baselines.length) baselines.push(glyphs[0].y);
    baselines.sort((a, b) => b - a);
    const lines = baselines.map(y => ({ y, glyphs: [] }));
    let previousBase = null;
    for (const glyph of [...glyphs].sort((a, b) => a.order - b.order)) {
      let line = lines.reduce((best, candidate) =>
        Math.abs(candidate.y - glyph.y) < Math.abs(best.y - glyph.y) ? candidate : best
      );
      if (
        glyph.size < bodySize * 0.9 &&
        previousBase &&
        Math.abs(glyph.y - previousBase.y) < bodySize * 1.3 &&
        glyph.x >= previousBase.x - bodySize * 0.15 &&
        glyph.x <= previousBase.x + previousBase.width + bodySize * 4
      )
        line = previousBase.line;
      line.glyphs.push(glyph);
      if (glyph.size >= bodySize * 0.9) previousBase = { ...glyph, line };
    }
    const runs = [];
    const append = run => {
      if (!run.text) return;
      const previous = runs.at(-1);
      const sameStyle =
        previous &&
        previous.script === run.script &&
        previous.bold === run.bold &&
        previous.italic === run.italic &&
        previous.scriptFont === run.scriptFont &&
        previous.overbar === run.overbar &&
        JSON.stringify(previous.scripts || []) === JSON.stringify(run.scripts || []);
      if (sameStyle) previous.text += run.text;
      else runs.push(run);
    };
    const plain = text => ({
      text,
      script: null,
      bold: false,
      italic: false,
      scriptFont: false,
      overbar: false
    });
    let lineCount = 0;
    for (const line of lines.filter(line => line.glyphs.length)) {
      if (lineCount++)
        append(plain(identifier ? '\n' : runs.at(-1)?.text.endsWith('-') ? '' : ' '));
      let right = null;
      const levels = [{ size: bodySize, y: line.y, path: [] }];
      for (const glyph of line.glyphs.sort((a, b) => a.order - b.order)) {
        let path = [];
        if (glyph.size < bodySize * 0.9) {
          let parent = levels.length - 1;
          while (parent > 0 && levels[parent].size < glyph.size * 1.12) parent--;
          const base = levels[parent];
          const shift = glyph.y - base.y;
          if (Math.abs(shift) > base.size * 0.13) {
            path = [...base.path, shift > 0 ? 'super' : 'sub'].slice(0, 4);
            levels.splice(parent + 1, levels.length, { size: glyph.size, y: glyph.y, path });
          }
        } else levels.splice(0, levels.length, { size: glyph.size, y: line.y, path: [] });
        if (!path.length && right !== null && glyph.x - right > bodySize * 0.12) append(plain(' '));
        const run = {
          text: glyph.scriptFont ? scriptLetter(glyph.text, glyph.bold) : glyph.text,
          script: path.length === 1 ? path[0] : null,
          bold: !!glyph.bold,
          italic: !!glyph.italic,
          scriptFont: !!glyph.scriptFont,
          overbar: !!glyph.overbar
        };
        if (path.length > 1) run.scripts = path;
        append(run);
        right = Math.max(right ?? -Infinity, glyph.x + glyph.width);
      }
    }
    // Do not manufacture mathematical notation in the plain-text search field.
    // Script placement, font distinctions and overbars remain explicit in runs.
    return {
      text: runs
        .map(run => run.text)
        .join('')
        .trim(),
      runs,
      lines
    };
  }
  function frontMatterRows(raw, positions, table, page) {
    const unavailable = { rows: [], forSourceLine: () => null };
    const lines = positions
      .map(line => ({ ...line, text: clean(line.text) }))
      .filter(line => line.text);
    const sourceLines = raw.split('\n').map(clean).filter(Boolean);
    const isHeader = text =>
      /^(?:Symbol Meaning Usual Units|Abbreviation Meaning) Section$/.test(text);
    const isEnd = text => /^(?:Table\s+\d+|\(Continued\)|\(a\)\s+(?:Letters|Standard))/.test(text);
    const headerIndex = lines.findIndex(line => isHeader(line.text));
    const sourceHeaderIndex = sourceLines.findIndex(isHeader);
    if (headerIndex < 0 || sourceHeaderIndex < 0) return unavailable;
    const valid = fragment => Number.isFinite(fragment.x) && Number.isFinite(fragment.y);
    const joinGlyphs = glyphs => {
      let text = '',
        right = null;
      for (const glyph of [...glyphs].sort((a, b) => a.x - b.x)) {
        if (right !== null && glyph.x - right > glyph.size * 0.12) text += ' ';
        text += glyph.text;
        right = glyph.x + glyph.width;
      }
      return clean(text);
    };
    const headerCells = [];
    for (const glyph of lines[headerIndex].fragments.filter(valid)) {
      const cell = headerCells.at(-1);
      if (!cell || glyph.x - cell.at(-1).x - cell.at(-1).width > glyph.size * 1.25)
        headerCells.push([glyph]);
      else cell.push(glyph);
    }
    const columns = new Map(headerCells.map(cell => [joinGlyphs(cell), cell[0]]));
    const identifier = columns.get('Symbol') || columns.get('Abbreviation');
    const meaning = columns.get('Meaning'),
      section = columns.get('Section');
    const units = columns.get('Usual Units') || section;
    if (!identifier || !meaning || !section) return unavailable;
    const bodyEnd = lines.findIndex((line, i) => i > headerIndex && isEnd(line.text));
    const end = bodyEnd < 0 ? lines.length : bodyEnd;
    const sourceBodyEnd = sourceLines.findIndex((text, i) => i > sourceHeaderIndex && isEnd(text));
    const sourceEnd = sourceBodyEnd < 0 ? sourceLines.length : sourceBodyEnd;
    const bodyLines = lines.slice(headerIndex + 1, end);
    const sourceBody = sourceLines.slice(sourceHeaderIndex + 1, sourceEnd);
    // Normal text indexing is unchanged. Only table-body lines link its old
    // identifiers to the complete positioned rows, keeping migration explicit.
    if (
      bodyLines.length !== sourceBody.length ||
      bodyLines.some((line, i) => line.text !== sourceBody[i]) ||
      bodyLines.some(line =>
        line.fragments.some(fragment => clean(fragment.text) && !valid(fragment))
      )
    )
      return unavailable;
    const body = notationGlyphs(
      bodyLines
        .flatMap(line => line.fragments)
        .filter(fragment => valid(fragment) && fragment.y < identifier.y - identifier.size * 0.38)
    );
    const sizes = body.map(glyph => glyph.size).sort((a, b) => a - b);
    const bodySize = sizes[Math.floor(sizes.length / 2)] || identifier.size;
    const alignment = identifier.size * 0.32;
    const meaningStarts = body.filter(
      fragment =>
        Math.abs(fragment.x - meaning.x) < identifier.size * 0.13 &&
        fragment.size >= identifier.size * 0.95 &&
        clean(fragment.text)
    );
    const rows = [];
    for (const fragment of body) {
      if (
        Math.abs(fragment.x - identifier.x) > identifier.size * 0.25 ||
        fragment.size < identifier.size * 0.95 ||
        !clean(fragment.text)
      )
        continue;
      const start = meaningStarts.find(other => Math.abs(other.y - fragment.y) < alignment);
      if (start && !rows.some(row => Math.abs(row.y - start.y) < identifier.size * 0.38))
        rows.push({ y: start.y });
    }
    rows.sort((a, b) => b.y - a.y);
    // Assign scripts through their actual text-line baseline. A nested prime
    // can sit above a row's ordinary top margin without belonging to the row
    // above it; raw glyph height alone cannot define a table boundary.
    const margin = identifier.size * 0.38;
    const lineBaseline = new Map();
    const edges = [identifier.x, meaning.x, units.x, section.x, Infinity];
    for (let column = 0; column < edges.length - 1; column++) {
      const layout = notationCell(
        body.filter(glyph => glyph.x >= edges[column] - 1 && glyph.x < edges[column + 1] - 1),
        bodySize
      );
      for (const line of layout.lines)
        for (const glyph of line.glyphs) lineBaseline.set(glyph, line.y);
    }
    const baselineOf = glyph => lineBaseline.get(glyph) ?? glyph.y;
    const rowAt = y =>
      rows.find(
        (row, i) => y <= row.y + margin && (i + 1 === rows.length || y > rows[i + 1].y + margin)
      );
    const reference = '(?:Table\\s+)?(?:\\d{1,2}|[A-C])(?:\\.\\d+)*(?:\\([a-z](?:,[a-z])*\\))?';
    const range = reference + '(?:[–-]' + reference + ')?';
    const referenceList = new RegExp('^' + range + '(?:\\s*[,;]\\s*' + range + ')*$');
    const references = glyphs => {
      const baselines = [];
      for (const glyph of glyphs) {
        let baseline = baselines.find(line => Math.abs(line.y - glyph.y) < 1);
        if (!baseline) baselines.push((baseline = { y: glyph.y, glyphs: [] }));
        baseline.glyphs.push(glyph);
      }
      const values = [];
      let result = '';
      for (const line of baselines.sort((a, b) => b.y - a.y)) {
        const text = joinGlyphs(line.glyphs)
          .replace(/\s*([.()–-])\s*/g, '$1')
          .replace(/\(([a-z,\s]+)\)/g, (_, letters) => '(' + letters.replace(/\s/g, '') + ')');
        if (!referenceList.test(text)) continue;
        let previousEnd = 0;
        for (const match of text.matchAll(new RegExp(range, 'g'))) {
          if (!values.includes(match[0])) {
            const separator = text.slice(previousEnd, match.index).includes(';') ? '; ' : ', ';
            result += (result ? separator : '') + match[0];
            values.push(match[0]);
          }
          previousEnd = match.index + match[0].length;
        }
      }
      return result;
    };
    for (const row of rows) {
      const glyphs = body.filter(glyph => rowAt(baselineOf(glyph)) === row);
      const identifierGlyphs = glyphs.filter(glyph => glyph.x < meaning.x - 1);
      const meaningGlyphs = glyphs.filter(
        glyph => glyph.x >= meaning.x - 1 && glyph.x < units.x - 1
      );
      const unitGlyphs = glyphs.filter(glyph => glyph.x >= units.x - 1 && glyph.x < section.x - 1);
      const sectionGlyphs = glyphs.filter(glyph => glyph.x >= section.x - 1);
      const identifierCell = notationCell(identifierGlyphs, bodySize, { identifier: true });
      const meaningCell = notationCell(meaningGlyphs, bodySize);
      const starts = [{ y: row.y, label: '' }];
      for (const line of meaningCell.lines) {
        const first = line.glyphs.reduce((best, glyph) => (glyph.x < best.x ? glyph : best));
        const label = joinGlyphs(
          line.glyphs.filter(glyph => Math.abs(glyph.y - line.y) < alignment)
        ).match(/^\(([a-z])\)/)?.[1];
        if (!label || Math.abs(first.x - meaning.x) > alignment) continue;
        if (Math.abs(line.y - row.y) < alignment) starts[0].label = label;
        else starts.push({ y: line.y, label });
      }
      starts.sort((a, b) => b.y - a.y);
      const definitionAt = y =>
        starts.find(
          (definition, i) =>
            y <= definition.y + margin && (i + 1 === starts.length || y > starts[i + 1].y + margin)
        );
      const definitions = starts.map(start => {
        let cell = notationCell(
          meaningGlyphs.filter(glyph => definitionAt(baselineOf(glyph)) === start),
          bodySize
        );
        if (start.label) {
          let remaining = 3;
          cell.runs = cell.runs
            .map(run => {
              const take = Math.min(remaining, run.text.length);
              remaining -= take;
              return { ...run, text: run.text.slice(take) };
            })
            .filter(run => run.text);
          if (cell.runs.length) cell.runs[0].text = cell.runs[0].text.trimStart();
          cell.runs = cell.runs.filter(run => run.text);
          cell.text = cell.runs
            .map(run => run.text)
            .join('')
            .trim();
        }
        const unit = notationCell(
          unitGlyphs.filter(glyph => definitionAt(baselineOf(glyph)) === start),
          bodySize
        );
        const refs = references(
          sectionGlyphs.filter(glyph => definitionAt(baselineOf(glyph)) === start)
        );
        return {
          label: start.label ? '(' + start.label + ')' : '',
          meaning: cell.text,
          meaning_runs: cell.runs,
          units: unit.text,
          units_runs: unit.runs,
          sections: refs
        };
      });
      row.item = {
        [columns.has('Symbol') ? 'symbol' : 'abbr']: identifierCell.text,
        symbol_runs: identifierCell.runs,
        meaning: definitions
          .map(definition => (definition.label ? definition.label + ' ' : '') + definition.meaning)
          .join('\n'),
        units: definitions.length === 1 ? definitions[0].units : '',
        sections: references(sectionGlyphs),
        definitions,
        source_row: `table-${table}-p${page}-y${Math.round(row.y * 1000)}`,
        source_table: String(table),
        pdf_page: page,
        y: row.y,
        legacy_keys: [],
        legacy_refs: []
      };
      if (!columns.has('Symbol'))
        row.item.source_kind = 'Standard abbreviations table in selected PDF';
    }
    return {
      rows: rows.map(row => row.item),
      forSourceLine(sourceLine) {
        if (sourceLine <= sourceHeaderIndex || sourceLine >= sourceEnd) return null;
        const positionedLine = sourceLine - sourceHeaderIndex + headerIndex;
        const anchor = lines[positionedLine]?.fragments.find(
          fragment =>
            valid(fragment) && fragment.x >= identifier.x - margin && fragment.x < section.x
        );
        return anchor ? rowAt(anchor.y)?.item || null : null;
      }
    };
  }
  async function frontMatter(engine, pages, ctx) {
    // Each front-matter table is parsed only from its own PDF content. A page
    // can contain the end of Table 4 and the start of Table 5; never apply the
    // later table's label to the whole page.
    const frontHead =
      engine.outline.find(x => /Major Symbols and Abbreviations/i.test(x.title))?.page || 27;
    const end = engine.outline.find(x => /About the Companion Website/i.test(x.title))?.page || 55;
    const seenA = new Set(),
      seenC = new Set(),
      seenS = new Set();
    const legacySourceLines = new WeakMap();
    const positionedPages = new Map();
    let mode = '',
      table = '';
    const heading = t =>
      /^Table\s+[1-5]$/.test(t) ||
      /^(?:Abbreviation Meaning (?:Section|Structure)|Symbol Meaning Usual Units Section|Major Symbols and Abbreviations|Standard Abbreviations|Abbreviated Chemical Species|Roman Symbols|Greek Symbols|\(Continued\))/.test(
        t
      );
    function splitRows(raw, chemical, pg, sectionsForLine = () => '') {
      const fixed = String(raw)
        .replace(/([A-Za-z])\[\n([a-z]{1,5})\n\]([A-Za-z]+)/g, '$1[$2]$3')
        .replace(/(?<=\n)([a-z])\n([A-Z][a-z]{1,5})\n([a-z])\n-/g, '$1$2 $3-')
        .replace(/(?<=\n)([A-Z][a-z]?)\n(\d{1,2})\n([A-Z][a-z]?)\s/g, '$1$2$3 ');
      const lines = fixed.split(/\n/).map(clean).filter(Boolean);
      let current = null;
      const commit = () => {
        if (!current) return;
        let meaning = reflowFragment(current.parts.join(' '))
          .replace(/\s+([,.;)])/g, '$1')
          .replace(/([([])\s+/g, '$1')
          .replace(/\s+[-]\s*/g, '-')
          .replace(/\s+([′+−∙])/g, '$1')
          .trim();
        const code = current.code;
        if (!code || meaning.length < 4) {
          current = null;
          return;
        }
        if (chemical) {
          const linked = meaning.match(
            /\b(?:Figure|Equation)\s+(?:\d+(?:\.\d+)*|[A-C]\.\d+)\s*(?:\([^)]*\))?\s*$/i
          );
          const structure = linked ? linked[0].trim() : '';
          if (structure) meaning = meaning.slice(0, -linked[0].length).trim();
          if (meaning.length >= 4 && !seenC.has(code)) {
            seenC.add(code);
            ctx.chemicals.push({
              abbr: code,
              meaning,
              structure_ref: structure,
              pdf_page: pg,
              source_kind: 'Abbreviated chemical species table in selected PDF'
            });
          }
        } else {
          const tail = meaning.match(
            /\s+((?:(?:\d{1,2}|[A-C])\.\d+(?:\.\d+)*(?:\([a-z]\))?|Table\s+[A-C]\.\d+)(?:\s*,\s*(?:\d{1,2}(?:\.\d+)*|[A-C]\.\d+)(?:\([a-z]\))?)*)$/
          );
          const sections = sectionsForLine(current.sourceLine);
          // A complete source-confirmed tail can begin with a chapter number.
          // Remove it before the older dotted-reference cleanup, which would
          // otherwise leave a stray "11," from a cell such as "11, 11.4".
          if (sections && meaning.endsWith(' ' + sections))
            meaning = meaning.slice(0, -sections.length).trim();
          else if (tail) meaning = meaning.slice(0, -tail[0].length).trim();
          if (meaning.length >= 4 && !seenA.has(code)) {
            seenA.add(code);
            const item = {
              abbr: code,
              meaning,
              sections,
              pdf_page: pg,
              source_kind: 'Standard abbreviations table in selected PDF'
            };
            legacySourceLines.set(item, current.sourceLine);
            ctx.abbreviations.push(item);
          }
        }
        current = null;
      };
      const candidate = line => {
        const m = line.match(/^([a-zA-Z0-9][a-zA-Z0-9/′+−∙.\[\],-]{0,17})\s+(.{3,})$/);
        if (!m) return null;
        const word = m[1],
          rest = m[2];
        if (
          heading(line) ||
          /^(?:Figure|Table|Section|Meaning|Structure|Usual|Standard|Major|Symbol|Abbreviated|Conducting)\b/.test(
            word
          )
        )
          return null;
        const plausible = chemical
          ? /^[A-Z0-9]/.test(word) || /^[a-z][A-Z]/.test(word) || /^(?:bpy|ttBP)$/.test(word)
          : /^[A-Z]/.test(word) || word === 'emf';
        if (!plausible) return null;
        if (!chemical && /^[A-Z][a-z]+\d/.test(word)) return null;
        // A definition starts with ordinary words, a parenthetical variant, a
        // numerical chemical name, or an italic chemical prefix.
        if (!/^(?:[a-z]|\([a-z]|\d[,\-]|[A-Z][a-z]|[A-Z]{2,}\b|[A-Z]-)/.test(rest)) return null;
        return { code: word, meaning: rest };
      };
      let inBody = false;
      for (let ix = 0; ix < lines.length; ix++) {
        let line = lines[ix];
        if (/^Abbreviation Meaning (?:Section|Structure)$/.test(line)) {
          inBody = true;
          continue;
        }
        if (!inBody) continue;
        if (
          /^(?:\(a\) Letters|\(a\) Standard chemical|Table [1-5]|Figure 1|\(Continued\))/.test(line)
        ) {
          if (/^\(Continued\)/.test(line)) continue;
          if (/^(?:\(a\) Letters|\(a\) Standard chemical)/.test(line)) break;
        }
        if (
          heading(line) ||
          /^(?:ff|\u0002|xl[vix]*|l(?:i{0,3}|v{0,3})|[A-Z][a-z]{2,}\s+Symbols)/.test(line)
        )
          continue;
        // Recombine PDF's floating font spans for formatted identifiers, using
        // only pattern rules (never a stored list of book entries).
        if (/^([a-zA-Z][a-zA-Z0-9]{1,12})$/.test(line) && ix + 1 < lines.length) {
          let code = line;
          let j = ix + 1;
          if (chemical) {
            if (/^(?:\d{1,2}|[′+−∙])$/.test(lines[j])) {
              code += lines[j++];
              if (/^\d+$/.test(lines[j - 1]) && j < lines.length && /^[A-Z][a-z]?$/.test(lines[j]))
                code += lines[j++];
              if (j < lines.length && /^[′+−∙]$/.test(lines[j])) code += lines[j++];
            } else if (code === 'p' && lines[j] === 'Chl') {
              code += lines[j++];
            }
          } else if (/^[A-Z]+$/.test(code) && /^[′2]$/.test(lines[j])) code += lines[j++];
          if (j > ix + 1) {
            commit();
            current = { code, parts: [], sourceLine: ix };
            ix = j - 1;
            continue;
          }
        }
        if (
          chemical &&
          /^[A-Za-z] ?\[$/.test(line) &&
          ix + 2 < lines.length &&
          /^[a-z]{1,4}$/.test(lines[ix + 1]) &&
          /^\][A-Za-z]{0,4}/.test(lines[ix + 2])
        ) {
          const assembled = line.replace(/\s/g, '') + lines[ix + 1] + lines[ix + 2];
          const m = assembled.match(/^([^ ]+)\s+(.+)$/);
          if (m) {
            commit();
            current = { code: m[1], parts: [m[2]], sourceLine: ix };
            ix += 2;
            continue;
          }
        }
        if (
          (chemical && /^(?:\d{1,2},\d-|\d{1,2}-[A-Z])/.test(line)) ||
          (!chemical && /^1D, 2D, 3D\s/.test(line))
        ) {
          const m = line.match(/^((?:\d+,\d-[A-Z]+|\d{1,2}-[A-Z]{1,8}|1D, 2D, 3D))\s+(.+)$/);
          if (m) {
            commit();
            current = { code: m[1], parts: [m[2]], sourceLine: ix };
            continue;
          }
        }
        if (!chemical && /^A$/.test(line) && lines[ix + 1] === '/' && lines[ix + 2] === 'V') {
          commit();
          current = { code: 'A/V', parts: [], sourceLine: ix };
          ix += 2;
          continue;
        }
        if (
          !chemical &&
          /^1$/.test(line) &&
          lines
            .slice(ix + 1, ix + 9)
            .join(' ')
            .includes('ne')
        ) {
          commit();
          current = { code: '1e, 2e, …ne', parts: [], sourceLine: ix };
          ix += 8;
          continue;
        }
        const hit = candidate(line);
        if (hit) {
          commit();
          current = { code: hit.code, parts: [hit.meaning], sourceLine: ix };
          continue;
        }
        if (chemical && /^[A-Z][A-Za-z0-9]{1,12}$/.test(line) && line.length >= 2) {
          // An isolated typeset code (e.g. with a superscript or italicized
          // chemical name following) starts a NEW entry, not the old one's tail.
          commit();
          current = { code: line, parts: [], sourceLine: ix };
          continue;
        }
        if (current) {
          if (/^\(Continued\)$/.test(line)) continue;
          if (/^(?:\(a\) |\(b\) )/.test(line)) current.parts.push(line);
          else if (/^(?:[a-zA-Z]|[\d+−∙′.,()=-])/.test(line)) current.parts.push(line);
        }
      }
      commit();
    }
    for (let pg = frontHead; pg < end; pg++) {
      const raw = pages[pg - 1]?.text || '';
      if (/Table\s+2\s+Roman Symbols/.test(raw)) {
        mode = 'symbols';
        table = '2';
      }
      if (/Table\s+3\s+Greek Symbols/.test(raw)) {
        mode = 'symbols';
        table = '3';
      }
      if (/Table\s+4\s+Standard Abbreviations/.test(raw)) {
        mode = 'abbreviations';
        table = '4';
      }
      const positions =
        (mode === 'symbols' || mode === 'abbreviations') && engine.pageTextPositions
          ? await engine.pageTextPositions(pg)
          : [];
      const sourceRows = frontMatterRows(raw, positions, table, pg);
      if (sourceRows.rows.length) positionedPages.set(pg, { ...sourceRows, kind: mode });
      const sectionsForLine = line => sourceRows.forSourceLine(line)?.sections || '';
      const tab5Pos = raw.search(/Table\s+5\s+Abbreviated Chemical Species/);
      if (mode === 'abbreviations' && tab5Pos >= 0) {
        splitRows(raw.slice(0, tab5Pos), false, pg, sectionsForLine);
        mode = 'chemicals';
        splitRows(
          'Abbreviation Meaning Structure\n' +
            raw
              .slice(tab5Pos)
              .split('Abbreviation Meaning Structure')
              .slice(1)
              .join('Abbreviation Meaning Structure'),
          true,
          pg
        );
      } else if (mode === 'abbreviations') splitRows(raw, false, pg, sectionsForLine);
      else if (mode === 'chemicals') splitRows(raw, true, pg);
      // Preserve existing identifiers and ordering. Section references come
      // exclusively from the positioned source row, not a text lookahead.
      if (pg >= 28 && pg <= 44) {
        const lines = raw.split('\n').map(clean).filter(Boolean);
        const banned = new Set([
          'Table',
          'Section',
          'Meaning',
          'Symbol',
          'Units',
          'Major',
          '(Continued)',
          'Roman',
          'Greek',
          'None'
        ]);
        for (let i = 0; i < lines.length - 1; i++) {
          let key = lines[i];
          if (!/^[A-Za-z𝛼𝛽𝛾𝛿𝜀𝜁𝜂𝜃𝜅𝜆𝜇𝜈𝜉𝜌𝜎𝜏𝜙𝜒𝜓𝜔ΓΔΛΣΩΦ]{1,4}$/.test(key) || banned.has(key)) continue;
          let j = i + 1;
          const pieces = [key];
          while (
            j + 1 < lines.length &&
            pieces.length < 4 &&
            /^[A-Za-z0-9𝛼𝛽𝛾𝛿𝜀𝜂𝜃𝜎ΓΔΩ∗*]{1,3}$/.test(lines[j]) &&
            /^[({]?[a-z]/.test(lines[j + 1]) &&
            !/^[({]?[a-d][)\d]/.test(lines[j])
          ) {
            pieces.push(lines[j]);
            j++;
          }
          const def = lines[j] || '';
          if (!/^(?:\([a-d]\)\s*|[a-z][a-z-]{2,}\s+)/.test(def)) continue;
          if (
            /^\(?[a-d]\)?$/.test(def) ||
            /^(?:Table|Symbol|Greek|Roman|section|continued|the|in|as|at)$/i.test(def)
          )
            continue;
          const symbol = pieces.join('');
          const meaning = def.replace(/\s+\d{1,2}\.\d+(?:\.\d+)?(?:,.*)?$/, '').slice(0, 155);
          if (meaning.length < 7 || seenS.has(symbol + '|' + pg)) continue;
          seenS.add(symbol + '|' + pg);
          const item = {
            symbol,
            meaning,
            units: 'See table in source',
            sections: sectionsForLine(j),
            pdf_page: pg
          };
          legacySourceLines.set(item, j);
          ctx.symbols.push(item);
          i = j;
        }
      }
    }
    // The old text parser runs only to preserve the meaning of saved legacy
    // references, and as a fallback when a different PDF cannot be positioned.
    // Complete source rows supply the live catalog whenever available.
    for (const kind of ['symbols', 'abbreviations']) {
      const type = kind === 'symbols' ? 'symbol' : 'abbreviation';
      const field = kind === 'symbols' ? 'symbol' : 'abbr';
      const legacy = ctx[kind];
      const groups = new Map();
      for (const item of legacy) {
        const groupKey = item[field] + '|' + item.pdf_page;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(item);
      }
      for (const item of legacy) {
        const target = positionedPages
          .get(item.pdf_page)
          ?.forSourceLine(legacySourceLines.get(item));
        if (!target) continue;
        const key = type + '-' + item[field];
        if (!target.legacy_keys.includes(key)) target.legacy_keys.push(key);
        const group = groups.get(item[field] + '|' + item.pdf_page);
        const reference = { key, page: item.pdf_page };
        if (group.length > 1) reference.occurrence = group.indexOf(item);
        target.legacy_refs.push(reference);
      }
      const pageNumbers = new Set(legacy.map(item => item.pdf_page));
      for (const [page, data] of positionedPages) if (data.kind === kind) pageNumbers.add(page);
      ctx[kind] = [...pageNumbers]
        .sort((a, b) => a - b)
        .flatMap(page => {
          const data = positionedPages.get(page);
          return data?.kind === kind ? data.rows : legacy.filter(item => item.pdf_page === page);
        });
    }
  }
  function indexFromPages(engine, pages, ctx) {
    const start = engine.outline.find(x => /^(?:Index)$/i.test(x.title))?.page;
    if (!start) return;
    const seen = new Set();
    for (let pg = start; pg <= engine.pageObjects.length; pg++) {
      const lines = (pages[pg - 1]?.text || '').split('\n');
      for (const line of lines) {
        const l = clean(line);
        // Book index lines generally end with one or more printed page numbers.
        const m = l.match(
          /^(.{3,115}?)(?:,?\s+)(\d{1,4}(?:\s*[-–]\s*\d{1,4})?(?:,\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?)*)$/
        );
        if (!m || !/^[A-Za-z]/.test(m[1]) || seen.has(m[1])) continue;
        seen.add(m[1]);
        ctx.index.push({
          term: m[1],
          pages: m[2].split(/\s*,\s*/),
          see: '',
          pdf_page: pg,
          level: 0,
          parent: null
        });
      }
    }
  }
  async function build(engine, onProgress) {
    const { toc, sections } = sectionsFromOutline(engine);
    const pages = Array.from({ length: engine.pageObjects.length }, (_, i) => ({
      pdf_page: i + 1,
      printed_page: printed(engine, i + 1),
      chapter: null,
      section: null,
      text: ''
    }));
    const ctx = {
      sections,
      figures: [],
      tables: [],
      equations: [],
      problems: [],
      references: [],
      symbols: [],
      abbreviations: [],
      chemicals: [],
      index: [],
      seen: { fig: new Set(), tab: new Set(), eq: new Set(), prob: new Set(), ref: new Set() }
    };
    const blocksByPage = Array(pages.length);
    const directAnchors = [];
    for (let i = 0; i < pages.length; i++) {
      const pg = i + 1,
        section = sectionFor(sections, pg);
      pages[i].text = await engine.pageText(pg);
      blocksByPage[i] = await engine.pageBlocks(pg);
      directAnchors.push(...(await engine.pageEquationAnchors(pg)));
      pages[i].chapter = section?.id?.match(/^(?:\d+|[A-C])/)?.[0] || null;
      pages[i].section = section?.id || null;
      extractPerPage(engine, pg, pages[i], ctx, blocksByPage[i]);
      if (i % 22 === 0) {
        onProgress?.(
          `Indexing your PDF · ${pg} of ${pages.length} pages`,
          11 + Math.round((77 * pg) / pages.length)
        );
        await new Promise(r => setTimeout(r, 0));
      }
    }
    onProgress?.('Building problem, bibliography, symbol, and index entries…', 90);
    for (const s of sections) s.excerpt = sourceExcerpt(pages[s.pdf_page - 1]?.text || '', s);
    extractEquations(engine, pages, ctx, directAnchors);
    parseProblemsAndRefs(engine, pages, ctx, blocksByPage);
    await frontMatter(engine, pages, ctx);
    indexFromPages(engine, pages, ctx);
    const catalog = {
      meta: {
        title: 'Electrochemical Atlas',
        book_title: 'Imported source PDF',
        pdf_pages: pages.length,
        counts: {
          toc: toc.length,
          sections: sections.length,
          figures: ctx.figures.length,
          tables: ctx.tables.length,
          equations: ctx.equations.length,
          problems: ctx.problems.length,
          references: ctx.references.length,
          abbreviations: ctx.abbreviations.length,
          chemicals: ctx.chemicals.length,
          symbols: ctx.symbols.length,
          index_entries: ctx.index.length,
          pdf_links: 0
        },
        revision: 'PDF Import',
        reader: 'Your original selected PDF'
      },
      toc,
      sections,
      figures: ctx.figures,
      tables: ctx.tables,
      equations: ctx.equations,
      problems: ctx.problems,
      references: ctx.references,
      abbreviations: ctx.abbreviations,
      chemicals: ctx.chemicals,
      symbols: ctx.symbols,
      index: ctx.index,
      entity_aliases: {}
    };
    onProgress?.('Finished building the local reference index.', 100);
    return {
      catalog,
      pages,
      reader: { pageCount: pages.length, labels: engine.labels, outline: engine.outline }
    };
  }
  root.AtlasRuntimeCatalog = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = { build };
})(typeof window !== 'undefined' ? window : globalThis);
