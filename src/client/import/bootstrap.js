/* Source PDF import, with optional remembered file handle (read-only).
   No book content is stored by the application. */
(async () => {
  'use strict';
  const $ = id => document.getElementById(id),
    memory = window.AtlasFileMemory;
  const portable = await window.AtlasPortable?.detect();
  let importing = false,
    rememberedHandle = null,
    nativeSelectController = null;
  let openPortable = null,
    portableChooserFailed = false,
    rememberedNeedsPermission = false,
    browserPickerFailed = false;
  const primary = $('pdfChoosePrimary'),
    more = $('pdfMoreOptions');
  function showStatus(message) {
    const el = $('pdfSelectionName');
    el.textContent = message || '';
    el.hidden = !message;
  }
  function showOtherOptions(visible) {
    more.hidden = !visible;
    if (!visible) more.open = false;
  }
  function chooseInBrowser() {
    $('sourcePdfFile').click();
  }
  function updatePrimaryLabel(label) {
    primary.textContent = label || 'Choose PDF';
  }

  function progress(text, p) {
    $('importProgressArea').hidden = false;
    $('importProgressText').textContent = text;
    $('importProgressBar').style.width = Math.max(0, Math.min(100, p)) + '%';
  }
  function error(message) {
    $('pdfImportError').textContent = message;
    $('pdfImportError').hidden = false;
  }
  function busy(active) {
    $('sourcePdfFile').disabled = active;
    for (const id of [
      'pdfChoosePrimary',
      'portablePick',
      'portableForget',
      'portableSavePath',
      'pdfBrowserFallback',
      'rememberPdfPicker',
      'reconnectPdf',
      'forgetSavedPdf'
    ])
      if ($(id)) $(id).disabled = active;
  }
  async function importPDF(file, handle = null) {
    if (importing) return false;
    if (!file || (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')) {
      error('Please select a PDF file.');
      return false;
    }
    importing = true;
    $('pdfImportError').hidden = true;
    busy(true);
    let pdfUrl = '';
    try {
      const engine = await new window.AtlasPDFCore.PDFLite(file).init(progress);
      const result = await window.AtlasRuntimeCatalog.build(engine, progress);
      window.ATLAS_PAGES = result.pages;
      window.ATLAS_CATALOG = result.catalog;
      window.ATLAS_CATALOG.meta.book_title = file.name.replace(/\.pdf$/i, '');
      window.ATLAS_READER_META = result.reader;
      // Validate the exact uploaded source before displaying edition-specific
      // source-page equation coordinates. A same-titled but different PDF never receives
      // potentially misleading equation renderings.
      try {
        const digest = await crypto.subtle.digest('SHA-256', engine.buffer);
        window.ATLAS_SOURCE_SHA256 = Array.from(new Uint8Array(digest), x =>
          x.toString(16).padStart(2, '0')
        ).join('');
      } catch (e) {
        window.ATLAS_SOURCE_SHA256 = '';
        console.warn('Source signature unavailable', e);
      }
      // The generic PDF text index can misidentify a prose reference such as
      // “see (3.3.7)” as a displayed equation. Reconcile against the actual
      // source-positioned equation index when the source PDF matches.
      window.AtlasEquationIndex.reconcile(
        result,
        window.AtlasEquationManifest,
        window.ATLAS_SOURCE_SHA256
      );
      // Keep multipage figure parts individually readable while preserving the
      // original caption and old whole-figure bookmarks and notes.
      window.AtlasReviewedFigureCrops.reconcile(
        result,
        window.AtlasFigureManifest,
        window.ATLAS_SOURCE_SHA256
      );
      window.ATLAS_SOURCE_REPORT = await window.AtlasSourceTrust.build(engine, result, file);
      pdfUrl = URL.createObjectURL(file);
      window.ATLAS_PDF_URL = pdfUrl;
      // Equation previews are created exclusively from the selected local PDF.
      // No textbook graphics or page images are bundled with the application.
      window.AtlasEquationPreview.setSource(pdfUrl);
      window.AtlasFigurePreview.setSource(pdfUrl);
      window.AtlasTablePreview.setSource(pdfUrl);
      window.ATLAS_IMPORT_START_PAGE =
        result.catalog.sections.find(s => s.kind === 'chapter')?.pdf_page || 1;
      engine.source = '';
      engine.buffer = null;
      window.ATLAS_PDF_ENGINE = engine;
      // Keep one copy of each local script; no network, font download or server.
      const scripts = [
        'reader.js',
        'layout-controller.js',
        'app.js',
        'navigation.js',
        'catalog-rail.js',
        'toolbar.js'
      ];
      for (const src of scripts)
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = src;
          s.onload = res;
          s.onerror = () => rej(new Error('The local application script ' + src + ' is missing.'));
          document.body.appendChild(s);
        });
      window.AtlasSourceTrust.mount();
      let rememberFailed = false;
      if (handle) {
        try {
          await memory.remember(handle);
        } catch (e) {
          rememberFailed = true;
          console.warn('The browser could not remember the file reference:', e);
        }
      }
      $('pdfImport').remove();
      if (rememberFailed)
        window.AtlasLayout?.notify?.(
          'The PDF opened, but this browser could not save its file reference. You may need to choose it again next session.'
        );
      $('sourcePdfFile')?.remove();
      return true;
    } catch (e) {
      console.error('PDF import failed', e);
      if (pdfUrl) {
        window.AtlasEquationPreview.setSource(null);
        window.AtlasFigurePreview.setSource(null);
        window.AtlasTablePreview.setSource(null);
        URL.revokeObjectURL(pdfUrl);
      }
      error('Could not import this PDF: ' + (e.message || e));
      progress('Import stopped', 0);
      busy(false);
      $('sourcePdfFile').value = '';
      importing = false;
      return false;
    }
  }
  async function tryStored(handle, request = false) {
    if (importing || !handle) return;
    try {
      const allowed = await memory.permission(handle, request);
      if (allowed !== 'granted') {
        $('savedPdfStatus').textContent =
          allowed === 'denied'
            ? 'Permission denied. Reconnect or select another PDF.'
            : 'Permission required. Reconnect to continue.';
        rememberedNeedsPermission = true;
        showStatus('Saved: ' + (handle.name || 'PDF') + ' · needs permission');
        updatePrimaryLabel('Open saved PDF');
        return;
      }
      const file = await handle.getFile();
      showStatus(file.name);
      progress('Reopening your saved PDF…', 2);
      await importPDF(file, handle);
    } catch (e) {
      console.warn('Saved PDF could not be reopened:', e);
      $('savedPdfStatus').textContent = 'Saved file unavailable or moved.';
      rememberedNeedsPermission = false;
      updatePrimaryLabel('Choose PDF');
      showStatus('Saved file unavailable. Choose PDF again.');
      error('Could not open the saved PDF. Choose it again.');
    }
  }
  const picker = $('rememberPdfPicker');
  if (memory?.available()) {
    picker.hidden = true;
    picker.addEventListener('click', async () => {
      nativeSelectController?.abort();
      try {
        const handle = await memory.pick();
        if (!handle) return;
        const file = await handle.getFile();
        showStatus(file.name);
        await importPDF(file, handle);
      } catch (e) {
        if (e.name !== 'AbortError') {
          browserPickerFailed = true;
          updatePrimaryLabel('Browse PDF');
          showOtherOptions(!$('savedPdfPanel').hidden);
          error('Saved-file picker unavailable. Use Browse PDF to open the file for this session.');
        }
      }
    });
    $('reconnectPdf').addEventListener('click', () => tryStored(rememberedHandle, true));
    $('forgetSavedPdf').addEventListener('click', async () => {
      try {
        await memory.forget();
        rememberedHandle = null;
        rememberedNeedsPermission = false;
        $('savedPdfPanel').hidden = true;
        $('pdfImportError').hidden = true;
        showStatus('');
        updatePrimaryLabel(browserPickerFailed ? 'Browse PDF' : 'Choose PDF');
        showOtherOptions(false);
      } catch (e) {
        error('Could not clear the saved reference: ' + (e.message || e));
      }
    });
    // A stored browser handle can be read without user interaction *only* when
    // permission remains granted. Otherwise we show a single reconnect button.
    memory
      .recall()
      .then(handle => {
        if (!handle || importing || portable) return;
        rememberedHandle = handle;
        $('savedPdfName').textContent = handle.name || 'Previously selected PDF';
        $('savedPdfPanel').hidden = false;
        showOtherOptions(true);
        showStatus('Saved: ' + (handle.name || 'PDF'));
        $('savedPdfStatus').textContent = 'Checking saved PDF access…';
        tryStored(handle, false);
      })
      .catch(e => {
        console.warn('Remembered file access unavailable:', e);
      });
  }
  if (portable) {
    $('portablePdfPanel').hidden = false;
    $('rememberPdfPicker').hidden = true;
    $('savedPdfPanel').hidden = true;
    showOtherOptions(true);
    openPortable = async function (status) {
      if (!status.available) {
        $('portablePdfStatus').textContent = status.configured
          ? 'Saved PDF unavailable. Choose again.'
          : 'No saved PDF location.';
        $('portableForget').hidden = !status.configured;
        showStatus(status.configured ? 'Saved PDF unavailable. Choose again.' : '');
        updatePrimaryLabel(status.configured ? 'Choose another PDF' : 'Choose PDF');
        return false;
      }
      $('portablePdfStatus').textContent = 'Saved: ' + status.name;
      showStatus('Opening ' + status.name + '…');
      $('portableForget').hidden = false;
      try {
        progress('Loading your original PDF from its saved location…', 2);
        const file = await window.AtlasPortable.readFile(status.name);
        showStatus(file.name);
        return await importPDF(file);
      } catch (e) {
        error('Saved PDF could not be opened: ' + (e.message || e));
        $('portablePdfStatus').textContent =
          'Saved PDF unavailable. Choose again or enter its path.';
        showStatus('Saved PDF unavailable. Choose again.');
        $('importProgressArea').hidden = true;
        return false;
      }
    };
    $('portablePick').addEventListener('click', async () => {
      if (importing || nativeSelectController) return;
      const controller = new AbortController();
      nativeSelectController = controller;
      $('portablePdfStatus').textContent = 'Opening file chooser…';
      $('portablePick').disabled = true;
      primary.disabled = true;
      $('pdfImportError').hidden = true;
      try {
        const saved = await window.AtlasPortable.choose(controller.signal);
        if ($('pdfImport')) await openPortable({ ...saved, available: true, configured: true });
      } catch (e) {
        if (e.name !== 'AbortError' && $('pdfImport')) {
          if (/^no file was selected$/i.test(String(e.message || e).trim())) {
            $('portablePdfStatus').textContent = 'No file selected.';
            return;
          }
          portableChooserFailed = true;
          updatePrimaryLabel('Browse PDF');
          $('pdfBrowserFallback').hidden = true;
          error('System chooser unavailable. Browse PDF now or save a file path below.');
          $('portablePdfStatus').textContent = '';
          more.open = true;
        }
      } finally {
        if (nativeSelectController === controller) nativeSelectController = null;
        if ($('portablePick')) $('portablePick').disabled = false;
        if ($('pdfChoosePrimary')) primary.disabled = false;
      }
    });
    $('portableSavePath').addEventListener('click', async () => {
      if (importing) return;
      const input = $('portablePath')
        .value.trim()
        .replace(/^['"]|['"]$/g, '');
      if (!input) {
        error('Enter the full path to your PDF.');
        return;
      }
      try {
        const saved = await window.AtlasPortable.rememberPath(input);
        await openPortable({ ...saved, available: true, configured: true });
      } catch (e) {
        error(e.message || String(e));
      }
    });
    $('portableForget').addEventListener('click', async () => {
      try {
        await window.AtlasPortable.forget();
        $('portableForget').hidden = true;
        $('portablePdfStatus').textContent = 'No saved PDF location.';
        showStatus('');
        updatePrimaryLabel('Choose PDF');
        portableChooserFailed = false;
        $('pdfBrowserFallback').hidden = false;
        $('pdfImportError').hidden = true;
      } catch (e) {
        error(e.message || String(e));
      }
    });
  }
  $('sourcePdfFile').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) {
      nativeSelectController?.abort();
      showStatus(file.name);
      importPDF(file);
    }
  });
  const zone = $('pdfDropZone');
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      nativeSelectController?.abort();
      showStatus(file.name);
      importPDF(file);
    }
  });
  $('pdfBrowserFallback').addEventListener('click', chooseInBrowser);
  primary.addEventListener('click', () => {
    if (importing) return;
    if (portable) {
      if (portableChooserFailed) chooseInBrowser();
      else $('portablePick').click();
    } else if (rememberedHandle && rememberedNeedsPermission) {
      tryStored(rememberedHandle, true);
    } else if (browserPickerFailed || !memory?.available()) {
      chooseInBrowser();
    } else {
      picker.click();
    }
  });
  if (portable) await openPortable(portable);
})();
