/* Quality checks based solely on the PDF selected by the user.
   Do not ship book text, images, pages, or precomputed content. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const text = (node, value) => {
    if (node) node.textContent = value;
  };
  const escape = s =>
    String(s ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const fmtN = n => Number(n || 0).toLocaleString();
  let report = null;
  async function build(engine, result, file) {
    const cat = result.catalog,
      pages = result.pages;
    const chapters = cat.sections.filter(s => s.kind === 'chapter');
    const appendices = cat.sections.filter(s => s.kind === 'appendix');
    const withText = pages.filter(p => (p.text || '').trim().length > 50).length;
    const directEq = cat.equations.filter(
      e =>
        Number.isInteger(Number(e.pdf_page)) && /^Printed equation number/.test(e.source_kind || '')
    ).length;
    const flaggedEq = cat.equations.length - directEq;
    const warnings = [];
    if (pages.length !== 1107)
      warnings.push(
        'The PDF page count differs from this application’s expected third-edition book (1,107 pages). Catalog destinations and study paths may be incorrect.'
      );
    if (chapters.length !== 21)
      warnings.push(
        'Found ' +
          chapters.length +
          ' numbered chapters, rather than the expected 21. Confirm the selected edition.'
      );
    if (appendices.length < 3)
      warnings.push(
        'Fewer than three appendices were located in the PDF outline. Appendix references may be incomplete.'
      );
    if (withText / pages.length < 0.8)
      warnings.push(
        'Many pages have little or no selectable text. This no-install reader does not OCR scanned pages.'
      );
    if (!cat.figures.length || !cat.tables.length || !cat.problems.length)
      warnings.push(
        'One or more primary catalogs are empty. Verify the PDF or try another text-based copy of the edition.'
      );
    if (flaggedEq)
      warnings.push(
        fmtN(flaggedEq) +
          ' equation labels required fallback text matching; their locations are less certain.'
      );
    const coverage = Math.round((withText / pages.length) * 100);
    let digest = null;
    try {
      if (globalThis.crypto?.subtle) {
        // Identifier is computed in memory. Neither the digest nor the PDF is written by Atlas.
        const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        digest = [...new Uint8Array(hash)]
          .map(x => x.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 20);
      }
    } catch (_) {}
    report = {
      fileName: file.name,
      fileSize: file.size,
      signature: digest,
      pageCount: pages.length,
      bookPagesWithText: withText,
      textCoverage: coverage,
      chapterCount: chapters.length,
      appendixCount: appendices.length,
      outlineCount: engine.outline.length,
      directEq,
      flaggedEq,
      counts: cat.meta.counts,
      warnings,
      ready: !warnings.some(w =>
        /page count differs|numbered chapters|primary catalogs are empty/i.test(w)
      )
    };
    return report;
  }
  function sourceDialog() {
    const d = $('sourceAuditDialog');
    if (!d || !report) return;
    const count = report.counts;
    d.querySelector('.source-audit-body').innerHTML = `
   <p class="source-audit-summary">${report.ready ? 'The imported PDF passed core edition and structural checks.' : 'One or more structural checks need attention.'} No PDF content is stored in the application or uploaded.</p>
   <dl class="source-facts">
     <div><dt>Selected file</dt><dd>${escape(report.fileName)}</dd></div>
     <div><dt>Pages / with selectable text</dt><dd>${fmtN(report.pageCount)} / ${fmtN(report.bookPagesWithText)} (${report.textCoverage}%)</dd></div>
     <div><dt>Chapter / appendix bookmarks</dt><dd>${fmtN(report.chapterCount)} / ${fmtN(report.appendixCount)}</dd></div>
     <div><dt>Cataloged figures / tables</dt><dd>${fmtN(count.figures)} / ${fmtN(count.tables)}</dd></div>
     <div><dt>Equations (direct label / inferred)</dt><dd>${fmtN(report.directEq)} / ${fmtN(report.flaggedEq)}</dd></div>
     <div><dt>Problems / references</dt><dd>${fmtN(count.problems)} / ${fmtN(count.references)}</dd></div>
     ${report.signature ? `<div><dt>Session source fingerprint</dt><dd><code>${escape(report.signature)}…</code></dd></div>` : ''}
   </dl>
   <h3>Import findings</h3>${report.warnings.length ? `<ul>${report.warnings.map(w => `<li>${escape(w)}</li>`).join('')}</ul>` : '<p>No structural warnings were detected.</p>'}
   <p>Source facsimiles display the exact page from <em>your own original PDF</em> using your browser’s built-in PDF viewer. A native browser viewer may not jump to the precise position within that page.</p>`;
  }
  function show() {
    const d = $('sourceAuditDialog');
    if (!d) return;
    sourceDialog();
    if (typeof d.showModal === 'function') d.showModal();
    else d.hidden = false;
  }
  function mount() {
    // The diagnostic report is opened from the Atlas home screen. There is no
    // persistent source-check badge in the PDF reader.
    const dialog = $('sourceAuditDialog');
    dialog?.querySelector('[data-close-audit]')?.addEventListener('click', () => dialog.close?.());
  }
  window.AtlasSourceTrust = { build, mount, show, get: () => report };
})();
