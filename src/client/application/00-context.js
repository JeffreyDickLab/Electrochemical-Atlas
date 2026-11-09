(() => {
  'use strict';

  const storage = window.AtlasStorage.create(window);
  window.ATLAS_TEMP_STORAGE = storage.isTemporary;
  const {
    escapeHtml: esc,
    normalize: norm,
    formatNumber: fmt,
    debounce,
    regexEscape,
    shorten
  } = window.AtlasText;
  const C = window.ATLAS_CATALOG;
  const PAGES = window.ATLAS_PAGES;
  const PDF_URL = window.ATLAS_PDF_URL;
  const F = 96485.33212;
  const R = 8.314462618;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const content = $('#content');
  const searchInput = $('#globalSearch');
  const searchScope = $('#searchScope');
  let booting = true;
  const readerPageInput = $('#readerPage');
  const readerPrinted = $('#readerPrinted');
  const readerMessage = $('#readerMessage');
  const resumeSourceId = entitySourceId();
  const resumeStorageKey = resumeSourceId ? `ea_resume_page_v6:${resumeSourceId}` : '';

  const state = {
    view: 'home',
    collectionPage: 0,
    collectionFilter: '',
    collectionChapter: '',
    symbolTab: 'abbreviations',
    searchPage: 0,
    readerPage: 57,
    resumePage: 1,
    readerHistory: [],
    readerHistoryIndex: -1,
    currentEntity: null,
    entryContext: null,
    guideMode: false,
    searchTimer: null
  };

  const user = {
    bookmarks: loadJSON('ea_bookmarks', { pages: [], entities: [] }),
    notes: loadJSON('ea_notes', {}),
    read: loadJSON('ea_read', {}),
    theme: storage.getItem('ea_theme') || 'light',
    guide: storage.getItem('ea_guide') === 'true'
  };

  const sectionByKey = new Map(C.sections.map(x => [x.key, x]));
  const sectionById = new Map(C.sections.filter(x => x.id).map(x => [String(x.id), x]));
  const pageByNumber = new Map(PAGES.map(x => [x.pdf_page, x]));

  const STUDY_PATHS = [
    {
      id: 'foundations',
      title: 'Start from zero: the electrochemical core',
      description:
        'A sequenced route through cells, potential, current, thermodynamics, kinetics, mass transport, steady-state methods, transients, and cyclic voltammetry.',
      steps: [
        '1',
        '1.1.3',
        '1.1.5',
        '1.1.9',
        '1.3.1',
        '1.5.3',
        '2.1',
        '3.3',
        '4.4',
        '5.1',
        '6.1',
        '7.2.2'
      ]
    },
    {
      id: 'cv',
      title: 'Cyclic voltammetry: from first scan to mechanism',
      description:
        'Build the physical foundation before moving into reversible, quasireversible, irreversible, coupled-reaction, fast-scan, and adsorbed-layer CV.',
      steps: [
        '1.6.4',
        '3.4.6',
        '4.5',
        '6.1',
        '7.1',
        '7.2.2',
        '7.3.2',
        '7.4.2',
        '7.9',
        '13.2',
        '13.3',
        '17.2'
      ]
    },
    {
      id: 'eis',
      title: 'Electrochemical impedance spectroscopy',
      description:
        'Start with capacitance, cell resistance, and ac circuits; then proceed through equivalent circuits, EIS measurement, interpretation, and instrumentation.',
      steps: ['1.5', '1.6', '11.1', '11.2', '11.3', '11.4', '11.8', '16.7', '17.3.3']
    },
    {
      id: 'ume-secm',
      title: 'Ultramicroelectrodes, SECM, and single entities',
      description:
        'A route from radial diffusion and UME steady state to scanning probe feedback, kinetic measurements, particle collisions, and single-molecule electrochemistry.',
      steps: [
        '4.4',
        '5.1',
        '5.2',
        '5.3',
        '5.9',
        '18.1',
        '18.2',
        '18.3',
        '18.4',
        '18.8',
        '19.2',
        '19.4',
        '19.6'
      ]
    },
    {
      id: 'electrocatalysis',
      title: 'Electrocatalysis and inner-sphere reactions',
      description:
        'Connect Butler–Volmer kinetics, double-layer effects, transport diagnostics, and surface chemistry to HER, ORR, CO₂ reduction, deposition, and gas evolution.',
      steps: ['3.3', '3.4', '10.2.5', '14.7', '15.1', '15.2', '15.3', '15.4', '15.5', '15.6']
    },
    {
      id: 'interfaces',
      title: 'Interfaces, adsorption, films, and modified electrodes',
      description:
        'Follow charge and capacitance into detailed double-layer models, adsorption, monolayers, thick films, blocking layers, sensors, and bioelectrocatalysis.',
      steps: [
        '1.6',
        '14.1',
        '14.2',
        '14.3',
        '14.5',
        '14.7',
        '17.1',
        '17.2',
        '17.4',
        '17.5',
        '17.6',
        '17.8'
      ]
    },
    {
      id: 'practical',
      title: 'Practical electrochemistry and troubleshooting',
      description:
        'The book’s laboratory notes and instrumentation chapters assembled into one experimental route.',
      steps: ['1.9', '2.5', '5.9', '6.8', '7.9', '12.1.3', '16.4', '16.7', '16.8', '16.10']
    },
    {
      id: 'ecl',
      title: 'Photoelectrochemistry and ECL',
      description:
        'A focused route through semiconductor energetics, photoeffects, sensitization, radical-ion annihilation, coreactants, quantum dots, and analytical ECL.',
      steps: [
        '2.2.5',
        '3.5',
        '20.1',
        '20.2',
        '20.3',
        '20.5.1',
        '20.5.2',
        '20.5.3',
        '20.5.4',
        '20.5.5'
      ]
    },
    {
      id: 'simulation',
      title: 'Digital simulation and mathematical support',
      description:
        'Review the mathematical tools and then use the book’s simulation appendix alongside the methods chapters where numerical modeling is most useful.',
      steps: ['A.1', 'A.3', 'A.5', 'B.1', 'B.2', 'B.3', 'B.4', '5.1', '6.1', '7.2', '13.2.5']
    }
  ];
