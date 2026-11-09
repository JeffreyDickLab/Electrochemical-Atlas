  function openStudyPath(id) {
    goView('paths');
    renderPaths(id);
  }

  function bindCommonActions(root) {
    $$('[data-view-target]', root).forEach(btn =>
      btn.addEventListener('click', () => goView(btn.dataset.viewTarget))
    );
    $$('[data-open-section]', root).forEach(btn =>
      btn.addEventListener('click', () => openSection(btn.dataset.openSection))
    );
    $$('[data-open-path]', root).forEach(btn =>
      btn.addEventListener('click', () => openStudyPath(btn.dataset.openPath))
    );
    $$('[data-open-pdf]', root).forEach(btn =>
      btn.addEventListener('click', () =>
        openPdf(
          Number(btn.dataset.openPdf),
          state.currentEntity
            ? entityTitle(state.currentEntity.type, state.currentEntity.item)
            : 'Book page',
          {
            targetY:
              btn.dataset.targetY != null
                ? Number(btn.dataset.targetY)
                : state.currentEntity?.item?.y || 0,
            preferRead: btn.dataset.sourceFocus === 'true',
            snap: true
          }
        )
      )
    );
    bindEntityButtons(root);
  }

  function bindEntityButtons(root) {
    $$('[data-entity-type="section"]', root).forEach(btn =>
      btn.addEventListener('click', () => {
        const item = sectionByKey.get(btn.dataset.entityKey);
        if (item) showEntity('section', item);
      })
    );
  }

  function initEvents() {
    $('#mainNav').addEventListener('click', e => {
      const btn = e.target.closest('[data-view]');
      if (!btn) return;
      goView(btn.dataset.view);
    });
    $('#homeButton').addEventListener('click', () => goView('home'));
    searchInput.addEventListener('focus', () => {
      if (!window.AtlasNavigation?.inlineSearch) window.AtlasNavigation?.open(searchInput.value);
    });
    searchInput.addEventListener(
      'input',
      debounce(() => {
        if (window.AtlasNavigation?.inlineSearch) return;
        if (window.AtlasNavigation) window.AtlasNavigation.open(searchInput.value);
        else runSearch();
      }, 220)
    );
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !window.AtlasNavigation?.inlineSearch) {
        e.preventDefault();
        runSearch();
      }
    });
    searchScope.addEventListener('change', () => {
      if (searchInput.value.trim()) runSearch();
    });
    $('#themeToggle').addEventListener('click', () =>
      applyTheme(user.theme === 'dark' ? 'light' : 'dark')
    );
    $('#beginnerToggle').addEventListener('click', toggleGuide);
    $('#openCurrentExternal').addEventListener('click', () => openExternal());
    $('#fallbackOpen').addEventListener('click', () => openExternal());
    $('#readerPrev').addEventListener('click', () =>
      openPdf(state.readerPage - 1, 'Previous PDF page')
    );
    $('#readerNext').addEventListener('click', () =>
      openPdf(state.readerPage + 1, 'Next PDF page')
    );
    $('#readerBack').addEventListener('click', () => readerHistory(-1));
    $('#readerForward').addEventListener('click', () => readerHistory(1));
    readerPageInput.addEventListener('change', () =>
      openPdf(Number(readerPageInput.value), 'Direct PDF page')
    );
    readerPageInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') openPdf(Number(readerPageInput.value), 'Direct PDF page');
    });
    $('#bookmarkPage').addEventListener('click', () => togglePageBookmark());
    $('#importNotesFile').addEventListener('change', e => {
      if (e.target.files[0]) importUserData(e.target.files[0]);
      e.target.value = '';
    });
    document.addEventListener('keydown', e => {
      if (document.querySelector('dialog[open]')) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        window.AtlasNavigation ? window.AtlasNavigation.open() : searchInput.focus();
      } else if (e.key === '[' && !typing) openPdf(state.readerPage - 1, 'Previous PDF page');
      else if (e.key === ']' && !typing) openPdf(state.readerPage + 1, 'Next PDF page');
      else if ((e.key === 'b' || e.key === 'B') && !typing) togglePageBookmark();
      else if (e.key === 'Escape' && document.activeElement === searchInput) {
        searchInput.blur();
      }
    });
    // No page URL hashing is required: the user's PDF is held in memory only.
  }

  function init() {
    initializeSavedEntries();
    applyTheme(user.theme);
    state.guideMode = user.guide;
    document.body.classList.toggle('guide-mode', state.guideMode);
    $('#beginnerToggle').classList.remove('active');
    initEvents();
    state.resumePage = loadResumePage();
    renderHome();
    openPdf(state.resumePage, 'Your imported PDF');
    booting = false;
    signalLocation({ kind: 'view', view: 'home' });
    if (window.ATLAS_TEMP_STORAGE) {
      const notice = document.createElement('p');
      notice.className = 'info-card';
      notice.textContent =
        'This browser has disabled local saving. Reading and search still work. Export your notes before closing the app.';
      $('#sidebar').appendChild(notice);
    }
  }

  window.AtlasApp = {
    goView,
    openSection,
    showEntity,
    runSearch,
    searchAll,
    openPdf,
    entityKey,
    entitySourceId,
    resolveEntityBookmark,
    parseSearchCommand,
    sectionById,
    studyPaths: STUDY_PATHS,
    openStudyPath,
    state,
    user
  };
  init();
})();
