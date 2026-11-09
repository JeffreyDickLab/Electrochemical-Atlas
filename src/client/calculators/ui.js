/* Single-tool calculator workbench. All calculations use calculator-core.js. */
(() => {
  'use strict';
  const E = window.AtlasCalcEngine,
    esc = s =>
      String(s ?? '').replace(
        /[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
      );
  const fmt = n =>
    typeof n !== 'number'
      ? String(n)
      : n === 0
        ? '0'
        : Math.abs(n) < 0.001 || Math.abs(n) >= 1e6
          ? n.toExponential(6)
          : Number(n.toPrecision(7)).toLocaleString('en-US', { maximumSignificantDigits: 7 });
  // Keep the authored calculator models intact for copying/export while
  // showing explicit Unicode powers and safe scientific typography in the UI.
  const modelHtml = value =>
    String(value ?? '')
      .split(/\r?\n/)
      .map(
        line =>
          `<div class="calc-equation-line">${window.AtlasScience?.html(line) ?? esc(line)}</div>`
      )
      .join('');
  const saved = () => {
    try {
      return JSON.parse(localStorage.getItem('ea_calculators_v3') || 'null');
    } catch (_) {
      return null;
    }
  };
  function sanitize(x) {
    const s = { version: 3, active: 'nernst', tools: {} };
    if (!x || typeof x !== 'object') return s;
    if (E.specs.some(t => t.id === x.active)) s.active = x.active;
    for (const spec of E.specs) {
      const z = x.tools?.[spec.id];
      if (!z || typeof z !== 'object') continue;
      const d = E.defaults(spec.id);
      for (const f of spec.fields) {
        const value = z.values?.[f.id];
        if (
          ['string', 'number'].includes(typeof value) &&
          String(value).length < 100 &&
          (!f.options || f.options.some(o => o[0] === String(value)))
        )
          d.values[f.id] = String(value);
        const unit = z.units?.[f.id];
        if (f.dimension && Object.hasOwn(E.units[f.dimension], unit)) d.units[f.id] = unit;
      }
      d.folds = {};
      if (z.folds)
        for (const k of ['inputs', 'model', 'curve', 'data'])
          if (typeof z.folds[k] === 'boolean') d.folds[k] = z.folds[k];
      s.tools[spec.id] = d;
    }
    return s;
  }
  let state = sanitize(saved()),
    host = null,
    callbacks = {},
    lastResult = null,
    lastSpec = null,
    resizeObserver = null,
    chartCache = null;
  const $ = s => host?.querySelector(s),
    $$ = s => [...(host?.querySelectorAll(s) || [])];
  function save() {
    try {
      localStorage.setItem('ea_calculators_v3', JSON.stringify(state));
    } catch (_) {}
  }
  function toolState(id) {
    if (!state.tools[id]) state.tools[id] = { ...E.defaults(id), folds: {} };
    return state.tools[id];
  }
  function sourceButton(section) {
    return `<button class="text-button" data-calc-source="${esc(section)}">Book §${esc(section)}</button>`;
  }
  function source(id) {
    const item = window.ATLAS_CATALOG.sections.find(s => String(s.id) === id);
    if (item) window.AtlasNavigate(item.pdf_page, 'Calculator source · §' + id);
    else callbacks.openSection?.(id);
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function field(f, s) {
    const id = 'calc-' + f.id;
    if (f.options)
      return `<label class="calc-field" data-field="${f.id}" for="${id}"><span>${esc(f.label)}</span><select id="${id}" name="${f.id}">${f.options.map(([v, t]) => `<option value="${esc(v)}" ${s.values[f.id] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
    return `<div class="calc-field" data-field="${f.id}"><label for="${id}">${esc(f.label)}</label><div class="quantity-input"><input id="${id}" name="${f.id}" type="number" inputmode="decimal" step="${f.integer ? '1' : 'any'}" value="${esc(s.values[f.id])}" autocomplete="off" ${f.hint ? `aria-describedby="hint-${id}"` : ''}>${
      f.dimension
        ? `<select data-unit="${f.id}" aria-label="Units for ${esc(f.label)}">${Object.keys(
            E.units[f.dimension]
          )
            .map(u => `<option ${u === s.units[f.id] ? 'selected' : ''}>${esc(u)}</option>`)
            .join('')}</select>`
        : `<span class="fixed-unit">${esc(f.unit)}</span>`
    }</div>${f.hint ? `<small id="hint-${id}">${esc(f.hint)}</small>` : ''}</div>`;
  }
  function updatePicker() {
    const q = $('#calculatorFilter').value.toLowerCase().trim(),
      category = $('#calculatorCategory').value;
    const matches = E.specs.filter(
      t =>
        (category === 'all' || t.category === category) &&
        [t.title, t.description, t.id, t.category].join(' ').toLowerCase().includes(q)
    );
    const list = $('#calcToolList');
    const categories = [...new Set(matches.map(t => t.category))];
    list.innerHTML = categories
      .map(
        cat =>
          `<div class="calc-tool-group" role="group" aria-label="${esc(cat)}"><div class="calc-tool-group-title">${esc(cat)}</div>${matches
            .filter(t => t.category === cat)
            .map(
              t =>
                `<button type="button" class="calc-tool-item${t.id === state.active ? ' active' : ''}" data-calc-tool="${esc(t.id)}" aria-current="${t.id === state.active ? 'true' : 'false'}" title="${esc(t.description)}"><span class="calc-tool-name">${esc(t.title)}</span><span aria-hidden="true" class="calc-tool-arrow">›</span></button>`
            )
            .join('')}</div>`
      )
      .join('');
    $('#calcMatchCount').textContent = matches.length + ' of ' + E.specs.length + ' tools';
    list.querySelectorAll('[data-calc-tool]').forEach(btn =>
      btn.addEventListener('click', () => {
        renderTool(btn.dataset.calcTool);
        if (window.matchMedia('(max-width:780px)').matches) $('#calcLibrary').open = false;
      })
    );
    if (!matches.length) {
      $('#calcEmpty').hidden = false;
      $('#calcTool').hidden = true;
      return;
    }
    $('#calcEmpty').hidden = true;
    $('#calcTool').hidden = false;
    const active = matches.find(t => t.id === state.active) || matches[0];
    if (lastSpec?.id !== active.id || !$('#calcForm')) renderTool(active.id);
  }
  function updateActiveTool() {
    $$('.calc-tool-item').forEach(btn => {
      const active = btn.dataset.calcTool === state.active;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-current', String(active));
    });
    if ($('#calcCurrentTool'))
      $('#calcCurrentTool').textContent = lastSpec?.title || 'Select a tool';
  }
  function mount(element, options = {}) {
    if (resizeObserver) resizeObserver.disconnect();
    host = element;
    callbacks = options;
    host.innerHTML = `<header class="view-header calc-header"><h1>Calculation workbench</h1></header>
    <div class="calc-layout"><details id="calcLibrary" class="calc-library" open><summary><span>Tool library</span><strong id="calcCurrentTool">Choose a calculator</strong></summary>
      <div class="calc-library-body"><label for="calculatorFilter" class="calc-search-label">Find a calculator</label><input id="calculatorFilter" type="search" autocomplete="off" placeholder="Search by method or quantity…">
      <label for="calculatorCategory" class="calc-search-label">Filter by area</label><select id="calculatorCategory"><option value="all">All areas</option>${[...new Set(E.specs.map(t => t.category))].map(cat => `<option value="${esc(cat)}">${esc(cat)}</option>`).join('')}</select>
      <div class="calc-tool-list" id="calcToolList" aria-label="Available calculators"></div><div class="calc-library-footer" id="calcMatchCount"></div></div></details>
      <div class="calc-main"><div class="empty" id="calcEmpty" hidden>No tools match. Clear the search or choose a different area.</div><div id="calcTool"></div></div></div>`;
    $('#calculatorFilter').addEventListener('input', updatePicker);
    $('#calculatorCategory').addEventListener('change', updatePicker);
    lastSpec = null;
    updatePicker();
  }
  function renderTool(id) {
    const spec = E.specs.find(s => s.id === id);
    if (!spec) return;
    lastSpec = spec;
    state.active = id;
    const s = toolState(id);
    save();
    lastResult = null;
    chartCache = null;
    $('#calcTool').innerHTML =
      `<article class="calc-workbench" data-calc="${id}"><header class="calc-title-row"><div><div class="eyebrow">${esc(spec.category)}</div><h2>${esc(spec.title)}</h2><p>${esc(spec.description)}</p></div><button type="button" class="calc-source-pill" id="calcSources" title="Read the mathematical model and source references">Model & sources ↗</button></header>
    <div class="calc-actions"><span class="calc-live-badge" id="calcStatus" role="status" aria-live="polite">Ready to calculate</span><div class="calc-action-buttons"><button type="button" class="secondary" id="calcCopy" title="Copy current calculation with units">Copy results</button><button type="button" class="secondary" id="calcExport" title="Download a complete JSON record">Export</button><button type="button" class="secondary" id="calcReset" title="Restore the model's reference inputs">Reset</button></div></div>
    ${['bv', 'tafel', 'exchange'].includes(id) ? '<p class="calc-convention">One-step, one-electron kinetics.</p>' : ''}
    <div class="calc-work-grid"><details class="calc-fold" data-fold="inputs" ${s.folds.inputs === false ? '' : 'open'}><summary><span>Inputs</span></summary><div class="calc-resize"><form id="calcForm" novalidate><div class="calc-field-grid">${spec.fields.map(f => field(f, s)).join('')}</div><button class="primary calc-submit" type="submit">Calculate</button></form></div></details>
    <section class="calc-results" aria-label="Calculation results"><div class="calc-results-heading"><div><h3>Calculated results</h3></div><span class="calc-results-icon" aria-hidden="true">∑</span></div><div id="calcErrors" role="status" hidden></div><div id="calcWarnings" role="status"></div><div id="calcResultRows" aria-live="polite"></div></section></div>
    <details class="calc-fold" data-fold="model" ${s.folds.model ? 'open' : ''}><summary>Model, assumptions & sources</summary><div class="calc-resize"><div class="calc-equation sci-rich">${modelHtml(spec.formula)}</div><h3>When this model applies</h3><p>${esc(spec.assumptions)}</p><h3>Source in your imported book</h3><div class="button-row">${spec.sections.map(sourceButton).join('')}</div><p class="calc-book-citation">Bard, Faulkner & White, <em>Electrochemical Methods: Fundamentals and Applications</em>, 3rd ed., Wiley, 2022. </p>${spec.links.length ? '<h3>Additional checks</h3>' + spec.links.map(k => `<p><a href="${esc(E.external[k].url)}" target="_blank" rel="noopener noreferrer">${esc(E.external[k].title)}</a> <small>(external; optional internet access)</small></p>`).join('') : ''}<p class="calc-constants">Constants from SI definitions / NIST CODATA: F = ${E.constants.F.toFixed(8)} C/mol; R = ${E.constants.R.toFixed(12)} J/(mol·K). </p></div></details>
    <details class="calc-fold calc-sensitivity" id="calcSensitivityPanel"><summary>Input sensitivity <small>optional · local numerical derivatives</small></summary>
    <div class="calc-resize"><p>Calculate how each numeric input locally affects the first reported output. This is a finite-difference diagnostic, not uncertainty propagation or evidence that the physical model applies.</p>
    <button type="button" class="secondary" id="calcSensitivity">Evaluate sensitivities</button><div id="calcSensitivityResults" role="status" aria-live="polite"></div></div></details>
    <details class="calc-fold" data-fold="curve" id="calcCurve" hidden ${s.folds.curve ? 'open' : ''}><summary>Explore the model curve <small>optional</small></summary><div class="calc-curve-controls"><select id="calcPlotSelect" aria-label="Plot type"></select><button id="calcCSV" class="secondary">Export curve CSV</button></div><div class="calc-plot-shell"><canvas id="calcCanvas" role="img" aria-label="Calculated model curve"></canvas></div><output id="calcPlotReadout" class="calc-plot-readout">Hover over the curve for coordinates.</output><details class="calc-data" data-fold="data"><summary>Preview calculated data</summary><div id="calcDataTable"></div></details></details>
    </article>`;
    updateActiveTool();
    $('#calcForm').addEventListener('submit', e => {
      e.preventDefault();
      readInputs();
      updateResult();
    });
    $('#calcForm').addEventListener('input', e => {
      if (e.target.matches('[data-unit]')) return;
      readInputs();
      updateResult();
    });
    $$('[data-unit]').forEach(select =>
      select.addEventListener('change', () => {
        const f = spec.fields.find(f => f.id === select.dataset.unit),
          input = $(`[name="${f.id}"]`),
          old = s.units[f.id],
          value = input.value;
        if (value.trim() !== '' && Number.isFinite(Number(value))) {
          const converted = E.convert(Number(value), f.dimension, old, select.value);
          input.value = Number(converted.toPrecision(14)).toString();
        }
        s.units[f.id] = select.value;
        readInputs();
        updateResult();
      })
    );
    $('#calcSensitivity').addEventListener('click', calculateSensitivity);
    $('#calcReset').addEventListener('click', () => {
      state.tools[id] = { ...E.defaults(id), folds: s.folds || {} };
      renderTool(id);
    });
    $('#calcSources').addEventListener('click', () => {
      const d = $('[data-fold="model"]');
      d.open = true;
      d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    $$('[data-calc-source]').forEach(b =>
      b.addEventListener('click', () => source(b.dataset.calcSource))
    );
    $$('details[data-fold]').forEach(d =>
      d.addEventListener('toggle', () => {
        s.folds[d.dataset.fold] = d.open;
        save();
        if (d.id === 'calcCurve' && d.open) requestAnimationFrame(draw);
      })
    );
    $('#calcCopy').addEventListener('click', async () => {
      if (!lastResult) return;
      const lines = [
        spec.title,
        ...spec.fields
          .filter(f => !(f.when && !f.when(toolState(id).values)))
          .map(
            f =>
              f.label +
              ': ' +
              toolState(id).values[f.id] +
              ' ' +
              (toolState(id).units[f.id] || f.unit || '')
          ),
        '',
        ...lastResult.rows.map(r => r.label + ': ' + fmt(r.value) + ' ' + (r.unit || '')),
        '',
        'Model: ' + spec.formula,
        'Assumptions: ' + spec.assumptions
      ].join('\n');
      try {
        await navigator.clipboard.writeText(lines);
      } catch (_) {
        const textarea = document.createElement('textarea');
        textarea.value = lines;
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      $('#calcStatus').textContent = 'Results copied';
    });
    $('#calcExport').addEventListener('click', () => {
      if (!lastResult) return;
      const payload = {
        atlasVersion: 6,
        sourceFingerprint: window.ATLAS_SOURCE_REPORT?.signature || null,
        exportedAt: new Date().toISOString(),
        calculator: spec.title,
        model: spec.id,
        enteredInputs: s.values,
        enteredUnits: s.units,
        canonicalInputs: lastResult.canonicalInputs,
        results: lastResult.rows,
        warnings: lastResult.warnings,
        equations: spec.formula,
        assumptions: spec.assumptions,
        book: { title: 'Electrochemical Methods', edition: 3, year: 2022, sections: spec.sections },
        constants: E.constants
      };
      download(
        'Atlas_' + id + '_result.json',
        JSON.stringify(payload, null, 2),
        'application/json'
      );
    });
    $('#calcCSV').addEventListener('click', () => {
      if (!lastResult?.series) return;
      const rows = lastResult.series.rows,
        keys = Object.keys(rows[0]);
      download(
        'Atlas_' + id + '_curve.csv',
        keys.join(',') + '\n' + rows.map(r => keys.map(k => r[k]).join(',')).join('\n') + '\n',
        'text/csv'
      );
    });
    $('#calcPlotSelect').addEventListener('change', draw);
    $('#calcCanvas').addEventListener('pointermove', inspectPlot);
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(() => requestAnimationFrame(draw));
    resizeObserver.observe($('.calc-plot-shell'));
    updateResult();
  }
  function readInputs() {
    if (!lastSpec) return;
    const s = toolState(lastSpec.id);
    for (const f of lastSpec.fields) {
      const input = $(`[name="${f.id}"]`);
      if (input) s.values[f.id] = input.value;
    }
    save();
    const out = $('#calcSensitivityResults');
    if (out) out.textContent = 'Inputs changed; reevaluate sensitivities for the new values.';
  }
  function calculateSensitivity() {
    const spec = lastSpec,
      s = toolState(spec.id),
      target = $('#calcSensitivityResults');
    if (!target) return;
    let base;
    try {
      base = E.evaluate(spec.id, s.values, s.units);
    } catch (e) {
      target.textContent = 'Cannot evaluate the current model: ' + e.message;
      return;
    }
    const result = base.rows.find(r => Number.isFinite(r.value));
    if (!result) {
      target.textContent = 'No finite scalar output is available for this model state.';
      return;
    }
    const rows = [];
    for (const f of spec.fields) {
      if (f.options || (f.when && !f.when(s.values))) continue;
      const x = Number(s.values[f.id]);
      if (!Number.isFinite(x)) continue;
      const h = Math.max(Math.abs(x) * 1e-5, 1e-10);
      const evaluate = sign => {
        try {
          const inputs = { ...s.values, [f.id]: String(x + sign * h) };
          const r = E.evaluate(spec.id, inputs, s.units);
          return r.rows.find(z => z.id === result.id)?.value;
        } catch (_) {
          return NaN;
        }
      };
      const p = evaluate(1),
        m = evaluate(-1);
      let derivative,
        method = 'central';
      if (Number.isFinite(p) && Number.isFinite(m)) derivative = (p - m) / (2 * h);
      else if (Number.isFinite(p)) {
        derivative = (p - result.value) / h;
        method = 'forward';
      } else if (Number.isFinite(m)) {
        derivative = (result.value - m) / h;
        method = 'backward';
      } else continue;
      if (!Number.isFinite(derivative)) continue;
      const elasticity = Math.abs(result.value) > 1e-16 ? (derivative * x) / result.value : null;
      rows.push({
        label: f.label,
        derivative,
        elasticity,
        unit: s.units[f.id] || f.unit || '',
        method
      });
    }
    if (!rows.length) {
      target.textContent =
        'No valid numeric input perturbations could be evaluated near the current state.';
      return;
    }
    target.innerHTML =
      '<p>Output: <strong>' +
      esc(result.label) +
      '</strong> (' +
      esc(result.unit || 'dimensionless') +
      '). Each input is perturbed by a small step in its displayed unit, keeping the other inputs fixed.</p>' +
      '<div class="sensitivity-table-wrap"><table class="sensitivity-table"><thead><tr><th>Input</th><th>Local derivative (output / input unit)</th><th>Relative sensitivity</th></tr></thead><tbody>' +
      rows
        .map(
          r =>
            '<tr><td>' +
            esc(r.label) +
            ' <small>' +
            esc(r.unit) +
            '</small></td><td>' +
            esc(fmt(r.derivative)) +
            '</td><td>' +
            (r.elasticity === null ? '—' : esc(fmt(r.elasticity)) + ' % per 1%') +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table></div>' +
      '<p class="source-note">Finite differences are approximate; endpoints can use one-sided estimates. A relative sensitivity is undefined for a zero-valued output. Do not treat these results as measured uncertainty, confidence intervals, or an experimental model-validity test.</p>';
  }

  function updateResult() {
    const spec = lastSpec,
      s = toolState(spec.id);
    for (const f of spec.fields) {
      const el = $(`[data-field="${f.id}"]`);
      el.hidden = !!(f.when && !f.when(s.values));
    }
    try {
      const result = E.evaluate(spec.id, s.values, s.units);
      lastResult = result;
      $('#calcErrors').hidden = true;
      $('#calcResultRows').hidden = false;
      $('#calcExport').disabled = false;
      $('#calcCopy').disabled = false;
      $('#calcStatus').textContent = 'Updated';
      $('#calcWarnings').innerHTML = result.warnings
        .map(w => `<p class="calc-warning">${esc(w)}</p>`)
        .join('');
      $('#calcResultRows').innerHTML = result.rows
        .map(
          (r, i) =>
            `<div class="calc-result-row${i === 0 ? ' calc-primary-result' : ''}"><span>${esc(r.label)}</span><strong data-result="${r.id}"><span>${esc(fmt(r.value))}</span>${r.unit ? ` <small>${esc(r.unit)}</small>` : ''}</strong></div>`
        )
        .join('');
      const curve = result.series?.rows?.length > 1;
      $('#calcCurve').hidden = !curve;
      if (curve) {
        const plotSelect = $('#calcPlotSelect'),
          previous = plotSelect.value;
        plotSelect.innerHTML = result.plots
          .map((p, i) => `<option value="${i}">${esc(p.title)}</option>`)
          .join('');
        plotSelect.value = Number(previous) < result.plots.length ? previous : '0';
        if (!plotSelect.value) plotSelect.value = '0';
        const rows = result.series.rows,
          keys = Object.keys(rows[0]);
        $('#calcDataTable').innerHTML =
          `<p>First 10 of ${rows.length} points. The CSV contains all points, with units in the column names.</p><table><thead><tr>${keys.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows
            .slice(0, 10)
            .map(r => `<tr>${keys.map(k => `<td>${esc(fmt(r[k]))}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`;
        draw();
      }
    } catch (err) {
      lastResult = null;
      chartCache = null;
      $('#calcErrors').textContent = err.message;
      $('#calcErrors').hidden = false;
      $('#calcResultRows').replaceChildren();
      $('#calcWarnings').replaceChildren();
      $('#calcCurve').hidden = true;
      $('#calcExport').disabled = true;
      $('#calcCopy').disabled = true;
      $('#calcStatus').textContent = 'Review highlighted inputs';
    }
  }
  const labels = {
    log10_O_over_R: 'log₁₀ (O/R)',
    E_V: 'E / V',
    time_s: 't / s',
    current_A: 'i / A',
    scan_rate_V_s: 'v / V s⁻¹',
    peak_current_A: '|ip| / A',
    rotation_rpm: 'Rotation / rpm',
    limiting_current_A: '|iL| / A',
    combined_current_A: '|i| / A',
    distance_um: 'Distance / µm',
    Zreal_ohm: 'Z′ / Ω',
    minus_Zimag_ohm: '−Z″ / Ω',
    frequency_Hz: 'f / Hz',
    modulus_ohm: '|Z| / Ω',
    phase_deg: 'Phase / °',
    overpotential_V: 'η / V',
    net_current_density_A_cm2: 'j / A cm⁻²',
    sqrt_time_s12: '√t / s½',
    charge_C: 'Q / C',
    free_concentration_M: 'Free concentration / M',
    coverage_fraction: 'Fractional coverage θ'
  };
  function draw() {
    const canvas = $('#calcCanvas'),
      shell = $('.calc-plot-shell');
    if (!canvas || !lastResult?.series || !$('#calcCurve').open || !shell.clientWidth) return;
    const p = lastResult.plots[Number($('#calcPlotSelect').value) || 0],
      all = lastResult.series.rows,
      rows = all.filter(r => (!p.logX || r[p.x] > 0) && (!p.logY || r[p.y] > 0));
    const w = shell.clientWidth,
      h = shell.clientHeight,
      dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(document.documentElement),
      line = style.getPropertyValue('--line').trim(),
      accent = style.getPropertyValue('--accent').trim(),
      text = style.getPropertyValue('--muted').trim();
    ctx.fillStyle = text;
    ctx.font = '11px system-ui';
    if (!rows.length) {
      ctx.fillText('No positive values available for this logarithmic plot.', 20, 30);
      chartCache = null;
      return;
    }
    const tx = x => (p.logX ? Math.log10(x) : x),
      ty = y => (p.logY ? Math.log10(y) : y);
    let xmin = Math.min(...rows.map(r => tx(r[p.x]))),
      xmax = Math.max(...rows.map(r => tx(r[p.x]))),
      ymin = Math.min(...rows.map(r => ty(r[p.y]))),
      ymax = Math.max(...rows.map(r => ty(r[p.y])));
    if (!p.logY) {
      ymin = Math.min(0, ymin);
      ymax = Math.max(0, ymax);
    }
    if (p.equalAspect) xmin = Math.min(0, xmin);
    if (xmax === xmin) {
      xmin -= 0.5;
      xmax += 0.5;
    }
    if (ymax === ymin) {
      ymin -= 0.5;
      ymax += 0.5;
    }
    const xPad = (xmax - xmin) * 0.03,
      yPad = (ymax - ymin) * 0.06;
    xmin -= xPad;
    xmax += xPad;
    ymin -= yPad;
    ymax += yPad;
    const left = 77,
      right = 19,
      top = 22,
      bottom = 48,
      pw = Math.max(20, w - left - right),
      ph = Math.max(20, h - top - bottom);
    if (p.equalAspect) {
      const scale = Math.min(pw / (xmax - xmin), ph / (ymax - ymin)),
        newX = pw / scale,
        newY = ph / scale,
        cx = (xmax + xmin) / 2,
        cy = (ymax + ymin) / 2;
      xmin = cx - newX / 2;
      xmax = cx + newX / 2;
      ymin = cy - newY / 2;
      ymax = cy + newY / 2;
    }
    const sx = x => left + ((tx(x) - xmin) / (xmax - xmin)) * pw,
      sy = y => h - bottom - ((ty(y) - ymin) / (ymax - ymin)) * ph;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const xx = left + (i / 4) * pw,
        yy = top + (i / 4) * ph;
      ctx.beginPath();
      ctx.moveTo(xx, top);
      ctx.lineTo(xx, h - bottom);
      ctx.moveTo(left, yy);
      ctx.lineTo(w - right, yy);
      ctx.stroke();
      let xv = xmin + ((xmax - xmin) * i) / 4,
        yv = ymax - ((ymax - ymin) * i) / 4;
      if (p.logX) xv = 10 ** xv;
      if (p.logY) yv = 10 ** yv;
      ctx.textAlign = 'center';
      ctx.fillText(Number(xv.toPrecision(3)).toString(), xx, h - bottom + 18);
      ctx.textAlign = 'right';
      ctx.fillText(Number(yv.toPrecision(3)).toString(), left - 8, yy + 4);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    rows.forEach((r, i) => {
      const x = sx(r[p.x]),
        y = sy(r[p.y]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    ctx.fillText(labels[p.x] || p.x, left + pw / 2, h - 9);
    ctx.save();
    ctx.translate(13, top + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(labels[p.y] || p.y, 0, 0);
    ctx.restore();
    canvas.setAttribute(
      'aria-label',
      `${p.title}. ${labels[p.y] || p.y} versus ${labels[p.x] || p.x}. Values are available in the data preview and exported CSV.`
    );
    chartCache = { rows, p, sx, sy, w, h };
  }
  function inspectPlot(event) {
    if (!chartCache) return;
    const c = chartCache,
      r = event.currentTarget.getBoundingClientRect(),
      x = event.clientX - r.left,
      y = event.clientY - r.top;
    let best = null,
      distance = Infinity;
    for (const row of c.rows) {
      const d = (c.sx(row[c.p.x]) - x) ** 2 + (c.sy(row[c.p.y]) - y) ** 2;
      if (d < distance) {
        distance = d;
        best = row;
      }
    }
    if (best)
      $('#calcPlotReadout').textContent =
        `${labels[c.p.x] || c.p.x}: ${fmt(best[c.p.x])}  ·  ${labels[c.p.y] || c.p.y}: ${fmt(best[c.p.y])}${best.frequency_Hz !== undefined ? '  ·  f = ' + fmt(best.frequency_Hz) + ' Hz' : ''}`;
  }
  new MutationObserver(() => {
    if (host?.isConnected && lastResult) requestAnimationFrame(draw);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.AtlasCalculators = {
    mount,
    exportState: () => JSON.parse(JSON.stringify(state)),
    importState: x => {
      state = sanitize(x);
      save();
    },
    select: id => {
      if (!E.specs.some(s => s.id === id)) return false;
      state.active = id;
      save();
      if (host?.querySelector('#calcToolList')) {
        renderTool(id);
      }
      return true;
    }
  };
})();
