/* Electrochemical Atlas v3: explicit-unit, source-linked pure calculation engine.
   Canonical electrochemical units: cm, cm2, cm2/s, mol/cm3, A, V, s, K.
   Stokes-Einstein converts to SI explicitly. See CALCULATOR_AUDIT.md.
   All models are deterministic educational evaluations, not experimental fits. */
(function (root) {
  'use strict';
  const NA = 6.02214076e23,
    e = 1.602176634e-19,
    kB = 1.380649e-23,
    F = NA * e,
    R = NA * kB,
    LN10 = Math.log(10);
  const U = {
    potential: { V: [1, 0], mV: [0.001, 0] },
    current: { A: [1, 0], mA: [0.001, 0], µA: [1e-6, 0], nA: [1e-9, 0], pA: [1e-12, 0] },
    density: { 'A/cm²': [1, 0], 'mA/cm²': [1e-3, 0], 'µA/cm²': [1e-6, 0], 'A/m²': [1e-4, 0] },
    area: { 'cm²': [1, 0], 'mm²': [0.01, 0], 'µm²': [1e-8, 0], 'm²': [1e4, 0] },
    length: { cm: [1, 0], mm: [0.1, 0], µm: [1e-4, 0], nm: [1e-7, 0], m: [100, 0] },
    diffusion: { 'cm²/s': [1, 0], 'm²/s': [1e4, 0], 'µm²/s': [1e-8, 0] },
    concentration: {
      M: [1e-3, 0],
      mM: [1e-6, 0],
      µM: [1e-9, 0],
      nM: [1e-12, 0],
      'mol/cm³': [1, 0],
      'mol/m³': [1e-6, 0]
    },
    time: { s: [1, 0], ms: [1e-3, 0], µs: [1e-6, 0], min: [60, 0], h: [3600, 0] },
    temperature: { K: [1, 0], '°C': [1, 273.15] },
    resistance: { Ω: [1, 0], kΩ: [1e3, 0], MΩ: [1e6, 0] },
    capacitance: { F: [1, 0], µF: [1e-6, 0], nF: [1e-9, 0] },
    arealcap: { 'µF/cm²': [1e-6, 0], 'F/cm²': [1, 0], 'F/m²': [1e-4, 0] },
    scan: { 'V/s': [1, 0], 'mV/s': [0.001, 0] },
    frequency: { Hz: [1, 0], kHz: [1e3, 0], mHz: [0.001, 0] },
    rotation: { rpm: [1, 0], 'rev/s': [60, 0], 'rad/s': [60 / (2 * Math.PI), 0] },
    rate: { 'cm/s': [1, 0], 'm/s': [100, 0] },
    coverage: {
      'mol/cm²': [1, 0],
      'nmol/cm²': [1e-9, 0],
      'pmol/cm²': [1e-12, 0],
      'mol/m²': [1e-4, 0]
    },
    amount: { mol: [1, 0], mmol: [1e-3, 0], µmol: [1e-6, 0], nmol: [1e-9, 0] },
    charge: { C: [1, 0], mC: [1e-3, 0], µC: [1e-6, 0] },
    viscosity: { 'Pa·s': [1, 0], 'mPa·s': [0.001, 0] },
    conductivity: { 'S/cm': [1, 0], 'mS/cm': [0.001, 0], 'S/m': [0.01, 0] },
    energy: { 'J/mol': [1, 0], 'kJ/mol': [1000, 0] },
    binding: { 'L/mol': [1000, 0], 'm³/mol': [1e6, 0] },
    particleconc: {
      'particles/mL': [1, 0],
      'particles/L': [0.001, 0],
      pM: [NA * 1e-15, 0],
      fM: [NA * 1e-18, 0]
    }
  };
  const external = {
    constants: {
      title: 'NIST · 2022 CODATA constants (checked 31 October 2026)',
      url: 'https://physics.nist.gov/cuu/Constants/Table/allascii.txt'
    },
    kinetics: {
      title: 'COMSOL · Electroanalytical Butler–Volmer equation (one-electron model)',
      url: 'https://doc.comsol.com/6.3/doc/com.comsol.help.edecm/edecm_ug_electrochem.06.126.html'
    },
    levich: {
      title: 'IUPAC Gold Book · Levich equation, 09140',
      url: 'https://goldbook.iupac.org/terms/view/09140'
    },
    mit: {
      title: 'MIT OCW · 10.626, Lecture 13: Butler–Volmer equation',
      url: 'https://ocw.mit.edu/courses/10-626-electrochemical-energy-systems-spring-2014/56cfa6e0f28bc8fc1a647cbe679384d1_MIT10_626S14_S11lec13.pdf'
    }
  };
  const num = (id, label, value, dimension = null, unit = '', extra = {}) => ({
    id,
    label,
    value: String(value),
    dimension,
    unit,
    ...extra
  });
  const choose = (id, label, options, value, extra = {}) => ({
    id,
    label,
    options,
    value,
    ...extra
  });
  const positive = { min: 0, exclusive: true },
    nonnegative = { min: 0 };
  const N = () =>
    num('n', 'Electrons per net reaction, n', 1, null, '', {
      min: 1,
      integer: true,
      hint: 'Stoichiometric electrons; do not substitute this into a multistep kinetic exponent.'
    });
  const T = () => num('T', 'Temperature', 298.15, 'temperature', 'K', positive);
  const A = (v = 0.0707) => num('A', 'Electrode area', v, 'area', 'cm²', positive);
  const D = (v = 1e-5) => num('D', 'Diffusion coefficient', v, 'diffusion', 'cm²/s', positive);
  const C = (v = 1) =>
    num('C', 'Bulk reactant concentration', v, 'concentration', 'mM', nonnegative);
  const alpha = () =>
    num('alpha', 'Cathodic transfer coefficient α', 0.5, null, '', {
      min: 0,
      max: 1,
      exclusive: true,
      hint: 'Anodic coefficient = 1 − α in this one-step, one-electron model.'
    });
  const convention = () =>
    choose(
      'convention',
      'Current sign convention',
      [
        ['book', 'Cathodic positive (book)'],
        ['anodic', 'Anodic positive']
      ],
      'book'
    );
  const V = (id, label, value = 0) => num(id, label, value, 'potential', 'V');
  const row = (id, label, value, unit = '') => ({ id, label, value, unit });
  function pack(rows, warnings = [], series = null, plots = []) {
    const values = {};
    for (const r of rows) {
      if (typeof r.value === 'number' && !Number.isFinite(r.value))
        throw new Error('Result is outside the supported numerical range. Check the input scale.');
      values[r.id] = r.value;
    }
    if (
      series &&
      series.rows.some(p =>
        Object.values(p).some(v => typeof v === 'number' && !Number.isFinite(v))
      )
    )
      throw new Error('Curve is outside the supported numerical range.');
    return { rows, values, warnings, series, plots };
  }
  const curve = (column, xs, fn) => xs.map(x => ({ [column]: x, ...fn(x) }));
  const lin = (lo, hi, count = 121) =>
    Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
  const log = (lo, hi, count = 121) => lin(Math.log(lo), Math.log(hi), count).map(Math.exp);
  const plot = (x, y, title, extra = {}) => ({ x, y, title, ...extra });
  const fail = (condition, text) => {
    if (condition) throw new Error(text);
  };
  const notes = {
    transport:
      'Requires the specified diffusion/flow geometry, negligible migration (normally excess supporting electrolyte), and no unmodeled coupled chemistry. Electrode kinetics must be fast enough to reach the assumed mass-transfer limit.',
    nernst:
      'O + n e ⇌ R with unit stoichiometric coefficients for O and R. Activities are dimensionless relative to standard states. A concentration ratio is appropriate with a medium-specific formal potential or when activity corrections cancel. This does not predict a mixed/open-circuit potential in an arbitrary multicomponent solution.',
    onee: 'Restricted to a one-step, one-electron reaction O + e ⇌ R. Constant surface concentrations; no mass-transfer, uncompensated resistance, double-layer, adsorption, or coupled-reaction corrections. The overall electron count of a multistep reaction is not a general replacement for 1 in these kinetic exponents.'
  };
  const specs = [];
  function add(
    id,
    title,
    category,
    description,
    sections,
    formula,
    assumptions,
    fields,
    calculate,
    links = []
  ) {
    specs.push({
      id,
      title,
      category,
      description,
      sections,
      formula,
      assumptions,
      fields,
      calculate,
      links
    });
  }
  add(
    'nernst',
    'Nernst equilibrium potential',
    'Potentials & thermodynamics',
    'Calculate the equilibrium potential from activities or a concentration ratio.',
    ['2.1.6', '2.1.7', '2.1.5'],
    'E = E° + (RT/nF) ln(aO/aR)\nFormal-potential form: E = E°′ + (RT/nF) ln(CO/CR)',
    notes.nernst,
    [
      choose(
        'basis',
        'Input basis',
        [
          ['formal', 'Concentrations + formal potential E°′'],
          ['activity', 'Activities + standard potential E°']
        ],
        'formal'
      ),
      V('E0', 'Standard/formal potential (same reference as result)', 0.2),
      N(),
      T(),
      num('CO', 'Oxidized concentration', 1, 'concentration', 'mM', {
        ...positive,
        when: v => v.basis === 'formal'
      }),
      num('CR', 'Reduced concentration', 1, 'concentration', 'mM', {
        ...positive,
        when: v => v.basis === 'formal'
      }),
      num('aO', 'Oxidized activity', 1, null, '', {
        ...positive,
        when: v => v.basis === 'activity'
      }),
      num('aR', 'Reduced activity', 1, null, '', { ...positive, when: v => v.basis === 'activity' })
    ],
    v => {
      const lnr =
          v.basis === 'activity'
            ? Math.log(v.aO) - Math.log(v.aR)
            : Math.log(v.CO) - Math.log(v.CR),
        shift = ((R * v.T) / (v.n * F)) * lnr,
        slope = (LN10 * R * v.T) / (v.n * F);
      return pack(
        [
          row('E', 'Equilibrium potential', v.E0 + shift, 'V'),
          row('shift', 'Shift relative to E° or E°′', shift * 1000, 'mV'),
          row('slope', 'Potential change per decade in O/R', slope * 1000, 'mV/dec')
        ],
        [],
        { rows: curve('log10_O_over_R', lin(-4, 4), x => ({ E_V: v.E0 + slope * x })) },
        [plot('log10_O_over_R', 'E_V', 'Nernst response')]
      );
    }
  );
  add(
    'faraday',
    'Faraday: charge, amount & yield',
    'Charge & interfaces',
    'Convert a constant current into charge, product amount, rate, mass, and target time.',
    ['1.1.5', '12.1.2'],
    'Q = I t\nNproduct = ε |Q|/(nF)\nProduct rate = ε |I|/(nF)\nMass = Nproduct M; target time = nF Ntarget/(ε |I|)',
    'Constant current over the entered duration. For a varying current integrate I(t) first. ε is a specified faradaic efficiency (0–1), not a predicted selectivity. Product amount is a positive magnitude; signed charge follows the entered current. M must be the molar mass of the species whose n is used.',
    [
      N(),
      num('I', 'Constant signed current', 1, 'current', 'mA'),
      num('t', 'Duration', 60, 'time', 's', nonnegative),
      num('eff', 'Faradaic efficiency', 100, null, '%', { min: 0, max: 100 }),
      num('M', 'Product molar mass', 63.546, null, 'g/mol', positive),
      num('target', 'Target product amount', 1, 'amount', 'µmol', nonnegative)
    ],
    v => {
      const eps = v.eff / 100,
        Q = v.I * v.t,
        rate = (eps * Math.abs(v.I)) / (v.n * F),
        amount = rate * v.t;
      return pack([
        row('Q', 'Signed charge passed', Q, 'C'),
        row('amount', 'Product amount', amount, 'mol'),
        row('rate', 'Product formation rate', rate, 'mol/s'),
        row('mass', 'Product mass', amount * v.M * 1000, 'mg'),
        row(
          'targetTime',
          'Time to entered target',
          v.target === 0
            ? 0
            : rate > 0
              ? v.target / rate
              : 'Not attainable at zero current/efficiency',
          rate > 0 || v.target === 0 ? 's' : ''
        )
      ]);
    }
  );
  add(
    'cottrell',
    'Cottrell transient current',
    'Transport & voltammetry',
    'Predict planar diffusion current or infer D from a background-corrected current.',
    ['6.1.1'],
    '|i(t)| = nFAC √[D/(πt)]\nD = πt [|i|/(nFAC)]²',
    'A sufficiently large potential step makes the reactant surface concentration effectively zero. Semi-infinite planar diffusion, uniform initial concentration, no convection, and negligible charging current. The t = 0 singularity is excluded. An inferred D is only meaningful if these assumptions and area are valid. ' +
      notes.transport,
    [
      choose(
        'solve',
        'Calculate',
        [
          ['current', 'Current from D'],
          ['D', 'D from measured current']
        ],
        'current'
      ),
      N(),
      A(),
      { ...D(), when: v => v.solve === 'current' },
      C(),
      num('t', 'Time after the step', 1, 'time', 's', positive),
      num('measured', 'Measured current magnitude', 12, 'current', 'µA', {
        ...positive,
        when: v => v.solve === 'D'
      })
    ],
    v => {
      fail(v.solve === 'D' && v.C === 0, 'A positive concentration is required to infer D.');
      const d = v.solve === 'D' ? Math.PI * v.t * (v.measured / (v.n * F * v.A * v.C)) ** 2 : v.D;
      const pref = v.n * F * v.A * v.C * Math.sqrt(d / Math.PI),
        i = pref / Math.sqrt(v.t);
      return pack(
        [
          row('i', 'Diffusion current magnitude', i, 'A'),
          row('microamp', 'Current magnitude', i * 1e6, 'µA'),
          row('D', 'Diffusion coefficient', d, 'cm²/s')
        ],
        [],
        {
          rows: curve('time_s', log(v.t / 100, v.t * 100), t => ({
            current_A: pref / Math.sqrt(t)
          }))
        },
        [plot('time_s', 'current_A', 'Cottrell response', { logX: true, logY: true })]
      );
    }
  );
  add(
    'randles',
    'Randles–Ševčík peak current',
    'Transport & voltammetry',
    'Reversible planar peak current; inverse area or diffusion coefficient.',
    ['7.2.1'],
    '|ip| = 0.4463 n F A C √[n F D v/(RT)]\nD = (RT/nFv) [|ip|/(0.4463 n F A C)]²',
    'Reversible (Nernstian) soluble redox couple with semi-infinite planar diffusion and an appropriate starting potential. This is a forward peak-current relation, not a complete CV simulation or a quasireversible/irreversible formula. Use background-corrected peak current and the reactant diffusion coefficient. n is for a single Nernstian wave, not an arbitrary collection of separated steps. ' +
      notes.transport,
    [
      choose(
        'solve',
        'Calculate',
        [
          ['current', 'Peak current'],
          ['D', 'Diffusion coefficient from peak'],
          ['A', 'Area from peak']
        ],
        'current'
      ),
      N(),
      { ...A(), when: v => v.solve !== 'A' },
      { ...D(), when: v => v.solve !== 'D' },
      C(),
      num('v', 'Scan-rate magnitude', 100, 'scan', 'mV/s', positive),
      T(),
      num('measured', 'Measured peak-current magnitude', 20, 'current', 'µA', {
        ...positive,
        when: v => v.solve !== 'current'
      })
    ],
    v => {
      fail(
        v.solve !== 'current' && v.C === 0,
        'A positive concentration is required for the inverse calculation.'
      );
      let d = v.D,
        a = v.A;
      if (v.solve === 'D')
        d = ((R * v.T) / (v.n * F * v.v)) * (v.measured / (0.4463 * v.n * F * v.A * v.C)) ** 2;
      if (v.solve === 'A')
        a = v.measured / (0.4463 * v.n * F * v.C * Math.sqrt((v.n * F * d * v.v) / (R * v.T)));
      const pref = 0.4463 * v.n * F * a * v.C * Math.sqrt((v.n * F * d) / (R * v.T)),
        ip = pref * Math.sqrt(v.v);
      return pack(
        [
          row('ip', 'Peak current magnitude', ip, 'A'),
          row('microamp', 'Peak current magnitude', ip * 1e6, 'µA'),
          row('D', 'Diffusion coefficient', d, 'cm²/s'),
          row('A', 'Electroactive area', a, 'cm²')
        ],
        [],
        {
          rows: curve('scan_rate_V_s', log(v.v / 10, v.v * 10), x => ({
            peak_current_A: pref * Math.sqrt(x)
          }))
        },
        [plot('scan_rate_V_s', 'peak_current_A', 'Peak current vs. scan rate')]
      );
    }
  );
  add(
    'levich',
    'Levich & Koutecký–Levich',
    'Transport & voltammetry',
    'Rotating-disk limiting current, diffusion-layer thickness, and optional kinetic combination.',
    ['10.2.2', '10.2.3', '10.2.5'],
    'ω = 2π rpm/60\n|iL| = 0.620 n F A D^(2/3) ν^(−1/6) ω^(1/2) C\nm = 0.620 D^(2/3) ν^(−1/6) ω^(1/2); δ = D/m\n1/|i| = 1/|ik| + 1/|iL|',
    'Steady laminar flow at a flush rotating disk; large excess supporting electrolyte. ν is kinematic viscosity, not dynamic viscosity. The coefficient 0.620 uses angular speed in rad/s; using revolutions/s without conversion changes the coefficient. The optional K–L combination assumes an applicable first-order kinetic/transport model and same-direction current magnitudes.',
    [
      N(),
      A(0.196),
      D(),
      num('nu', 'Kinematic viscosity', 0.01, 'diffusion', 'cm²/s', positive),
      num('rotation', 'Disk rotation', 1600, 'rotation', 'rpm', positive),
      C(),
      num('ik', 'Kinetic current magnitude (0 = omit)', 0, 'current', 'mA', nonnegative)
    ],
    v => {
      const omega = (2 * Math.PI * v.rotation) / 60,
        m = 0.62 * v.D ** (2 / 3) * v.nu ** (-1 / 6) * Math.sqrt(omega),
        iL = v.n * F * v.A * m * v.C;
      const combine = il => (v.ik > 0 ? (il === 0 ? 0 : (il * v.ik) / (il + v.ik)) : il);
      const rows = [
        row('omega', 'Angular speed', omega, 'rad/s'),
        row('iL', 'Limiting current magnitude', iL, 'A'),
        row('m', 'Mass-transfer coefficient', m, 'cm/s'),
        row('delta', 'Equivalent diffusion-layer thickness', (v.D / m) * 1e4, 'µm')
      ];
      if (v.ik > 0) rows.push(row('combined', 'K–L combined current magnitude', combine(iL), 'A'));
      return pack(
        rows,
        [],
        {
          rows: curve('rotation_rpm', lin(v.rotation * 0.1, v.rotation * 2), rpm => {
            const il = iL * Math.sqrt(rpm / v.rotation);
            return { limiting_current_A: il, combined_current_A: combine(il) };
          })
        },
        [
          plot('rotation_rpm', 'limiting_current_A', 'Rotating-disk response'),
          ...(v.ik > 0
            ? [plot('rotation_rpm', 'combined_current_A', 'K–L current vs. rotation')]
            : [])
        ]
      );
    },
    ['levich']
  );
  add(
    'ume',
    'Ultramicroelectrode steady state',
    'Transport & voltammetry',
    'Disk, hemisphere, or full sphere; predict current or infer radius.',
    ['5.1.2', '5.2.1', '5.2.2', '5.2.5'],
    'Disk: |iss| = 4 n F D C a\nHemisphere: |iss| = 2π n F D C a\nFull sphere: |iss| = 4π n F D C a\nCharacteristic scale: tD = a²/D (not a universal time-to-steady-state criterion)',
    'A disk or hemisphere is flush in an insulating plane; a full sphere is exposed on all sides. Steady diffusion-limited current without convection, migration, blocking, or overlapping diffusion fields. Finite boundaries and short transients invalidate these steady-state expressions.',
    [
      choose(
        'geometry',
        'Electrode geometry',
        [
          ['disk', 'Disk in an insulating plane'],
          ['hemisphere', 'Hemisphere on an insulating plane'],
          ['sphere', 'Fully exposed sphere']
        ],
        'disk'
      ),
      choose(
        'solve',
        'Calculate',
        [
          ['current', 'Current from radius'],
          ['radius', 'Radius from current']
        ],
        'current'
      ),
      N(),
      num('radius', 'Electrode radius', 5, 'length', 'µm', {
        ...positive,
        when: v => v.solve === 'current'
      }),
      D(),
      C(),
      num('measured', 'Measured current magnitude', 2, 'current', 'nA', {
        ...positive,
        when: v => v.solve === 'radius'
      })
    ],
    v => {
      fail(
        v.solve === 'radius' && v.C === 0,
        'A positive concentration is required to infer radius.'
      );
      const g = { disk: 4, hemisphere: 2 * Math.PI, sphere: 4 * Math.PI }[v.geometry],
        a = v.solve === 'radius' ? v.measured / (g * v.n * F * v.D * v.C) : v.radius,
        i = g * v.n * F * v.D * v.C * a;
      return pack([
        row('i', 'Steady current magnitude', i, 'A'),
        row('nanoamp', 'Steady current magnitude', i * 1e9, 'nA'),
        row('radius', 'Radius', a * 1e4, 'µm'),
        row('tD', 'a²/D characteristic scale', (a * a) / v.D, 's')
      ]);
    }
  );
  add(
    'rc',
    'Double-layer charging',
    'Charge & interfaces',
    'Signed step transient, time constants, and steady-ramp capacitive current.',
    ['1.6.4'],
    'Ctotal = Careal A; τ = Ru Ctotal\nAnodic-positive step current: i(t) = ΔE/Ru · exp(−t/τ)\nAnodic-positive steady-ramp current: i = Ctotal dE/dt\nBook (cathodic-positive) currents have the opposite sign.\ntp = −τ ln(1 − p)',
    'Ideal, constant capacitance in series with Ru; no faradaic current. The double layer is equilibrated before the step. Enter signed ΔE = Efinal − Einitial and signed ramp dE/dt (positive for a positive-going sweep). A finite-rate potentiostat and potential-dependent capacitance can change the transient. Ramp output is the long-time limit.',
    [
      num('Ru', 'Uncompensated resistance', 100, 'resistance', 'Ω', positive),
      choose(
        'capBasis',
        'Capacitance basis',
        [
          ['areal', 'Capacitance per unit area'],
          ['total', 'Total capacitance']
        ],
        'areal'
      ),
      num('careal', 'Areal capacitance', 20, 'arealcap', 'µF/cm²', {
        ...positive,
        when: v => v.capBasis === 'areal'
      }),
      { ...A(0.1), when: v => v.capBasis === 'areal' },
      num('ctotal', 'Total capacitance', 2, 'capacitance', 'µF', {
        ...positive,
        when: v => v.capBasis === 'total'
      }),
      V('dE', 'Signed potential step ΔE', 0.1),
      num('t', 'Time after step', 0.2, 'time', 'ms', nonnegative),
      num('v', 'Signed potential ramp dE/dt', 0.1, 'scan', 'V/s'),
      convention()
    ],
    v => {
      const cap = v.capBasis === 'areal' ? v.careal * v.A : v.ctotal,
        tau = v.Ru * cap,
        sign = v.convention === 'book' ? -1 : 1,
        i0 = (sign * v.dE) / v.Ru;
      return pack(
        [
          row('C', 'Total capacitance', cap * 1e6, 'µF'),
          row('tau', 'RC time constant', tau, 's'),
          row('t95', 'Time to 95% of charge change', -Math.log(0.05) * tau, 's'),
          row('t99', 'Time to 99% of charge change', -Math.log(0.01) * tau, 's'),
          row('i0', 'Initial signed charging current', i0, 'A'),
          row('it', 'Signed current at entered time', i0 * Math.exp(-v.t / tau), 'A'),
          row('ramp', 'Signed steady-ramp current', sign * cap * v.v, 'A'),
          row('dQ', 'Change of electrode charge C ΔE', cap * v.dE, 'C')
        ],
        [],
        { rows: curve('time_s', lin(0, 8 * tau), t => ({ current_A: i0 * Math.exp(-t / tau) })) },
        [plot('time_s', 'current_A', 'Charging transient')]
      );
    }
  );
  add(
    'tafel',
    'Tafel branches & validity',
    'Kinetics',
    'Calculate branch-specific overpotential and estimate the neglected reverse-current fraction.',
    ['3.4.3', '15.2.2'],
    'One-electron model, α = cathodic transfer coefficient:\nCathodic: η = −RT/(αF) ln(|j|/j0)\nAnodic: η = +RT/[(1 − α)F] ln(|j|/j0)\nSlope dη/dlog10|j| = ±ln(10)RT/(βF)\nReverse/forward branch ratio = exp[−F|η|/(RT)]',
    notes.onee +
      ' The Tafel approximation neglects the reverse partial current and requires large |η|. It does not apply near equilibrium or on a diffusion-limited plateau. A 1% reverse/forward ratio is used as an illustrative criterion, not a guarantee of experimental validity. The reported η is a branch approximation for the entered net-current magnitude.',
    [
      choose(
        'branch',
        'Reaction branch',
        [
          ['cathodic', 'Cathodic (reduction)'],
          ['anodic', 'Anodic (oxidation)']
        ],
        'cathodic'
      ),
      num('j0', 'Exchange current density', 1, 'density', 'µA/cm²', positive),
      num('j', 'Net-current density magnitude', 1, 'density', 'mA/cm²', positive),
      alpha(),
      T()
    ],
    v => {
      fail(
        v.j <= v.j0,
        'For this Tafel estimate, |j| must exceed j0. Use Butler–Volmer near equilibrium.'
      );
      const beta = v.branch === 'cathodic' ? v.alpha : 1 - v.alpha,
        sign = v.branch === 'cathodic' ? -1 : 1,
        eta = ((sign * R * v.T) / (beta * F)) * Math.log(v.j / v.j0),
        reverse = Math.exp((-F * Math.abs(eta)) / (R * v.T)),
        slope = (sign * LN10 * R * v.T) / (beta * F);
      const warn = [];
      if (reverse > 0.01)
        warn.push(
          'The omitted reverse branch exceeds 1% of the forward branch. This Tafel estimate is not in the selected asymptotic regime; use Butler–Volmer.'
        );
      return pack(
        [
          row('eta', 'Signed overpotential η', eta, 'V'),
          row('slope', 'Signed slope dη/dlog10|j|', slope * 1000, 'mV/dec'),
          row('reverse', 'Reverse / forward partial current', reverse * 100, '%'),
          row(
            'threshold',
            '|η| needed for ≤1% reverse/forward',
            ((Math.log(100) * R * v.T) / F) * 1000,
            'mV'
          )
        ],
        warn
      );
    },
    ['kinetics', 'mit']
  );
  add(
    'reference',
    'Reference-electrode conversion',
    'Potentials & thermodynamics',
    'Convert potentials through the SHE scale; fixed 25 °C book values or supplied offsets.',
    ['1.1.3', '2.1.8', '2.5'],
    'Evs target = Evs source + Esource vs SHE − Etarget vs SHE\nERHE vs SHE = −ln(10) RT/F · pH  (hydrogen fugacity = 1 bar)',
    'The built-in saturated-KCl offsets reproduce this book: Ag/AgCl = +0.197 V and SCE = +0.244 V versus SHE at 25 °C. These are approximate reference values, not universal calibration constants. Published nominal offsets can differ by several millivolts (for example, some SCE tables use +0.241 V rather than this book’s +0.244 V). Actual filling solution, temperature, junction potential, and electrode condition matter; use the documented calibration for your electrode rather than treating a preset as exact. For another temperature/reference, supply a measured or properly sourced custom offset. RHE assumes hydrogen fugacity 1 bar and thermodynamic pH. NHE is not a rigorously separate fixed calibration in this converter.',
    [
      V('E', 'Reported electrode potential', 0.2),
      choose(
        'from',
        'Source reference',
        [
          ['SHE', 'SHE'],
          ['AgCl', 'Ag/AgCl, saturated KCl, book 25 °C'],
          ['SCE', 'SCE, book 25 °C'],
          ['RHE', 'RHE, H₂ at 1 bar'],
          ['custom', 'Custom offset vs SHE']
        ],
        'AgCl'
      ),
      choose(
        'to',
        'Target reference',
        [
          ['SHE', 'SHE'],
          ['AgCl', 'Ag/AgCl, saturated KCl, book 25 °C'],
          ['SCE', 'SCE, book 25 °C'],
          ['RHE', 'RHE, H₂ at 1 bar'],
          ['custom', 'Custom offset vs SHE']
        ],
        'RHE'
      ),
      T(),
      num('pH', 'pH (for RHE)', 7, null, '', { when: v => v.from === 'RHE' || v.to === 'RHE' }),
      {
        ...V('fromOffset', 'Source reference potential vs SHE', 0.197),
        when: v => v.from === 'custom'
      },
      { ...V('toOffset', 'Target reference potential vs SHE', 0), when: v => v.to === 'custom' }
    ],
    v => {
      fail(
        (['AgCl', 'SCE'].includes(v.from) || ['AgCl', 'SCE'].includes(v.to)) &&
          Math.abs(v.T - 298.15) > 1e-6,
        'Built-in Ag/AgCl and SCE offsets are only supplied at 25 °C (298.15 K). Select custom offsets at other temperatures.'
      );
      const offset = (name, custom) =>
          ({ SHE: 0, AgCl: 0.197, SCE: 0.244, RHE: ((-LN10 * R * v.T) / F) * v.pH, custom })[name],
        src = offset(v.from, v.fromOffset),
        dst = offset(v.to, v.toOffset);
      return pack(
        [
          row('result', 'Converted potential vs target', v.E + src - dst, 'V'),
          row('SHE', 'Potential vs SHE', v.E + src, 'V'),
          row('sourceOffset', 'Source reference vs SHE', src, 'V'),
          row('targetOffset', 'Target reference vs SHE', dst, 'V')
        ],
        [
          'Reference conversion is algebraic; it does not remove liquid-junction or uncompensated-resistance errors.'
        ]
      );
    }
  );
  add(
    'diffusion',
    'Diffusion distance & timescale',
    'Transport & voltammetry',
    'Distinguish RMS displacement from an equivalent planar diffusion-layer thickness.',
    ['4.4.1', '6.1.1'],
    'RMS displacement in d dimensions: Lrms = √(2dDt)\nInverse RMS timescale: t = L²/(2dD)\nCottrell equivalent diffusion layer: δ = √(πDt), with t = δ²/(πD)',
    'Free isotropic diffusion for RMS displacement. The inferred t is a characteristic statistical timescale, not a mean first-passage time or a guaranteed arrival time. The Cottrell δ is defined by matching flux D C/δ; it is not a sharp moving front or an RMS distance.',
    [
      D(),
      choose(
        'definition',
        'Distance definition',
        [
          ['1', '1D RMS: √(2Dt)'],
          ['2', '2D radial RMS: √(4Dt)'],
          ['3', '3D radial RMS: √(6Dt)'],
          ['cottrell', 'Cottrell equivalent layer: √(πDt)']
        ],
        '1'
      ),
      num('t', 'Elapsed time', 1, 'time', 's', nonnegative),
      num('length', 'Distance for inverse timescale', 100, 'length', 'µm', nonnegative)
    ],
    v => {
      const factor = v.definition === 'cottrell' ? Math.PI : 2 * Number(v.definition);
      return pack(
        [
          row(
            'distance',
            'Selected characteristic distance',
            Math.sqrt(factor * v.D * v.t) * 1e4,
            'µm'
          ),
          row(
            'time',
            'Timescale for the entered distance',
            (v.length * v.length) / (factor * v.D),
            's'
          )
        ],
        [],
        {
          rows: curve('time_s', lin(0, Math.max(v.t * 5, 1)), t => ({
            distance_um: Math.sqrt(factor * v.D * t) * 1e4
          }))
        },
        [plot('time_s', 'distance_um', 'Characteristic diffusion distance')]
      );
    }
  );
  add(
    'mass',
    'Mass-transfer-limited current',
    'Transport & voltammetry',
    'Limiting current, flux, and an equivalent diffusion-layer estimate.',
    ['1.3.2'],
    '|il| = n F A m Cbulk\nJtoward = m Cbulk; equivalent δ = D/m',
    'The surface reactant concentration is set to zero (limiting-current condition). m is a specified effective mass-transfer coefficient, not automatically a property of the solution. δ = D/m is an equivalent layer, not a physical sharp boundary. Consistent units and correct active area are required.',
    [N(), A(0.1), num('m', 'Mass-transfer coefficient', 0.001, 'rate', 'cm/s', positive), C(), D()],
    v =>
      pack([
        row('i', 'Limiting current magnitude', v.n * F * v.A * v.m * v.C, 'A'),
        row('flux', 'Reactant flux magnitude toward electrode', v.m * v.C, 'mol/(cm²·s)'),
        row('delta', 'Equivalent layer D/m', (v.D / v.m) * 1e4, 'µm')
      ])
  );
  function impedance(v, f) {
    const omega = 2 * Math.PI * f,
      w = v.model === 'warburg' ? v.sigma / Math.sqrt(omega) : 0,
      a = v.Rct + w,
      b = -w;
    // Zfaradaic=a+jb; parallel admittance is 1/Zfaradaic+jωC.
    const den = a * a + b * b,
      yr = a / den,
      yi = -b / den + omega * v.Cdl,
      yd = yr * yr + yi * yi;
    const re = v.Ru + yr / yd,
      im = -yi / yd;
    return {
      frequency_Hz: f,
      Zreal_ohm: re,
      Zimag_ohm: im,
      minus_Zimag_ohm: -im,
      modulus_ohm: Math.hypot(re, im),
      phase_deg: (Math.atan2(im, re) * 180) / Math.PI
    };
  }
  add(
    'eis',
    'EIS: ideal RC & Randles–Warburg',
    'Kinetics',
    'Explore complex impedance, a correctly scaled Nyquist plot, and Bode plots.',
    ['11.3.1', '11.3.3', '11.4.2'],
    'Ideal RC: Z = Ru + [1/Rct + jωCdl]⁻¹\nRandles–Warburg: Z = Ru + [jωCdl + 1/(Rct + ZW)]⁻¹\nZW = σ(1 − j)/√ω, ω = 2πf\nIdeal RC only: fapex = 1/(2πRctCdl)',
    'Small-signal, linear, time-invariant response about a stable operating point. The ideal RC option omits diffusion. The Warburg option assumes semi-infinite planar diffusion and an ideal capacitor, not a CPE or finite-length diffusion. σ has units Ω·s^(−1/2) in the stated definition. The ideal-RC apex formula is not asserted to be the apex of the full Warburg model. This tool evaluates a circuit, not fits data or proves a mechanism.',
    [
      choose(
        'model',
        'Circuit model',
        [
          ['ideal', 'Ru + (Rct parallel Cdl)'],
          ['warburg', 'Ru + [Cdl parallel (Rct + Warburg)]']
        ],
        'ideal'
      ),
      num('Ru', 'Solution resistance Ru', 25, 'resistance', 'Ω', nonnegative),
      num('Rct', 'Charge-transfer resistance', 500, 'resistance', 'Ω', positive),
      num('Cdl', 'Total double-layer capacitance', 20, 'capacitance', 'µF', positive),
      num('sigma', 'Warburg coefficient σ', 100, null, 'Ω·s^(−1/2)', {
        ...nonnegative,
        when: v => v.model === 'warburg'
      }),
      num('fmin', 'Lowest frequency', 0.1, 'frequency', 'Hz', positive),
      num('fmax', 'Highest frequency', 100, 'frequency', 'kHz', positive),
      num('probe', 'Probe frequency', 10, 'frequency', 'Hz', positive)
    ],
    v => {
      fail(v.fmax <= v.fmin, 'Maximum frequency must exceed minimum frequency.');
      const z = impedance(v, v.probe),
        tau = v.Rct * v.Cdl,
        warnings = [];
      const rows = [
        row('tau', 'Rct Cdl time constant', tau, 's'),
        row(
          'fRC',
          v.model === 'ideal'
            ? 'Ideal-RC apex frequency'
            : 'RC characteristic frequency (not full-model apex)',
          1 / (2 * Math.PI * tau),
          'Hz'
        ),
        row('real', 'Probe Z′', z.Zreal_ohm, 'Ω'),
        row('imag', 'Probe Z″', z.Zimag_ohm, 'Ω'),
        row('modulus', 'Probe |Z|', z.modulus_ohm, 'Ω'),
        row('phase', 'Probe phase angle', z.phase_deg, '°')
      ];
      if (v.model === 'ideal') {
        rows.push(
          row('high', 'High-frequency real intercept', v.Ru, 'Ω'),
          row('low', 'Low-frequency real intercept', v.Ru + v.Rct, 'Ω')
        );
        if (1 / (2 * Math.PI * tau) < v.fmin || 1 / (2 * Math.PI * tau) > v.fmax)
          warnings.push('The ideal-RC apex lies outside the selected frequency window.');
      } else
        warnings.push(
          'Semi-infinite diffusion does not have the same finite low-frequency real intercept as the ideal RC circuit.'
        );
      return pack(rows, warnings, { rows: log(v.fmin, v.fmax, 241).map(f => impedance(v, f)) }, [
        plot('Zreal_ohm', 'minus_Zimag_ohm', 'Nyquist (equal Ω scale on both axes)', {
          equalAspect: true
        }),
        plot('frequency_Hz', 'modulus_ohm', 'Bode magnitude', { logX: true, logY: true }),
        plot('frequency_Hz', 'phase_deg', 'Bode phase', { logX: true })
      ]);
    }
  );
  add(
    'bv',
    'Butler–Volmer (one electron)',
    'Kinetics',
    'Separate cathodic, anodic, and net current, with explicit sign convention.',
    ['3.3.2', '3.4.3', '3.4.7'],
    'f = F/(RT)\njc = j0 exp(−αfη); ja = j0 exp[(1 − α)fη]\nBook convention: jnet = jc − ja\nAnodic-positive convention: jnet = ja − jc',
    notes.onee,
    [
      num('j0', 'Exchange current density', 1, 'density', 'µA/cm²', positive),
      alpha(),
      V('eta', 'Overpotential η = E − Eeq', 0.1),
      T(),
      convention()
    ],
    v => {
      const x = (F * v.eta) / (R * v.T);
      fail(
        Math.max(-v.alpha * x, (1 - v.alpha) * x) > 650,
        'Exponential is too large for this numerical evaluation. Reduce |η| or check T.'
      );
      const jc = v.j0 * Math.exp(-v.alpha * x),
        ja = v.j0 * Math.exp((1 - v.alpha) * x),
        sgn = v.convention === 'book' ? 1 : -1;
      const net = sgn * v.j0 * (Math.expm1(-v.alpha * x) - Math.expm1((1 - v.alpha) * x));
      const extent = Math.min(Math.max(0.15, Math.abs(v.eta) * 1.25), (600 * R * v.T) / F),
        rows = curve('overpotential_V', lin(-extent, extent), eta => {
          const x = (F * eta) / (R * v.T);
          return {
            net_current_density_A_cm2:
              sgn * v.j0 * (Math.expm1(-v.alpha * x) - Math.expm1((1 - v.alpha) * x))
          };
        });
      return pack(
        [
          row('net', 'Signed net current density', net, 'A/cm²'),
          row('jc', 'Cathodic partial-current magnitude', jc, 'A/cm²'),
          row('ja', 'Anodic partial-current magnitude', ja, 'A/cm²')
        ],
        Math.abs(v.eta) > 0.2
          ? [
              'Large predicted currents are not capped by mass transfer in this model. Verify the experimental regime.'
            ]
          : [],
        { rows },
        [plot('overpotential_V', 'net_current_density_A_cm2', 'Butler–Volmer response')]
      );
    },
    ['kinetics', 'mit']
  );
  add(
    'exchange',
    'Exchange current & Rct',
    'Kinetics',
    'Relate k° and equilibrium concentrations to exchange current and linearized resistance.',
    ['3.4.1', '3.4.3'],
    'One electron: j0 = F k° CO^(1 − α) CR^α\nI0 = A j0; Rct = RT/(F I0)\nArea-normalized Rct A = RT/(F j0)',
    'One-step, one-electron solution reaction at equilibrium; k° in cm/s and concentrations in mol/cm³. Both forms must be present. Rct is the small-signal charge-transfer resistance near equilibrium, not total cell resistance. The area-normalized result in Ω·cm² must not be confused with resistance in Ω.',
    [
      num('k0', 'Standard heterogeneous rate constant', 0.001, 'rate', 'cm/s', positive),
      num('CO', 'Equilibrium oxidized concentration', 1, 'concentration', 'mM', positive),
      num('CR', 'Equilibrium reduced concentration', 1, 'concentration', 'mM', positive),
      alpha(),
      A(0.1),
      T()
    ],
    v => {
      const j0 = F * v.k0 * Math.exp((1 - v.alpha) * Math.log(v.CO) + v.alpha * Math.log(v.CR)),
        I0 = v.A * j0,
        rct = (R * v.T) / (F * I0);
      return pack([
        row('j0', 'Exchange current density', j0, 'A/cm²'),
        row('I0', 'Exchange current', I0, 'A'),
        row('Rct', 'Charge-transfer resistance', rct, 'Ω'),
        row('RctA', 'Area-normalized charge-transfer resistance', rct * v.A, 'Ω·cm²')
      ]);
    },
    ['kinetics']
  );
  add(
    'thermo',
    'Cell free energy & equilibrium',
    'Potentials & thermodynamics',
    'Distinguish actual reaction free energy from standard free energy and equilibrium constant.',
    ['2.1.3'],
    'ΔG = −nF Ecell\nΔG° = −nF E°cell\nlog10 K = nF E°cell / [ln(10)RT]',
    'Ecell is the reversible thermodynamic emf for the reaction as written, not a measured polarized working-electrode potential. E°cell is the standard cell emf for the same reaction and temperature. ΔG values are per mole of the written reaction. Reversing the reaction reverses E and ΔG and inverts K. K is expressed as a dimensionless activity quotient.',
    [N(), T(), V('E', 'Reversible cell emf Ecell', 1), V('E0', 'Standard cell emf E°cell', 1)],
    v => {
      const logK = (v.n * F * v.E0) / (LN10 * R * v.T),
        K = Math.pow(10, logK);
      return pack([
        row('dG', 'Reaction free energy', (-v.n * F * v.E) / 1000, 'kJ/mol'),
        row('dG0', 'Standard reaction free energy', (-v.n * F * v.E0) / 1000, 'kJ/mol'),
        row('logK', 'log₁₀ K', logK),
        row(
          'K',
          'Equilibrium constant K',
          Number.isFinite(K) && K > 0 ? K : 'Use log₁₀ K; outside floating-point range'
        )
      ]);
    }
  );
  add(
    'ohmic',
    'Solution resistance & iR correction',
    'Potentials & thermodynamics',
    'Use a measured Ru or ideal geometry estimate to correct the applied potential.',
    ['1.5.2', '1.5.4', '5.6.1'],
    'Parallel planar electrodes: R = L/(κA)\nDisk access resistance in a conducting half-space: R = 1/(4κa)\nCathodic-positive: Einterface = Eapplied + I Ru\nAnodic-positive: Einterface = Eapplied − I Ru',
    'Use measured uncompensated resistance for experimental correction whenever possible. L/(κA) assumes uniform current between parallel plates and represents their solution resistance; 1/(4κa) is the disk-to-distant-bulk access resistance in an ideal half-space. Neither automatically equals the working-to-reference uncompensated resistance in a real three-electrode cell. I is the signed total measured current, including charging current.',
    [
      choose(
        'method',
        'Resistance source',
        [
          ['measured', 'Enter measured Ru'],
          ['planar', 'Ideal parallel-plate estimate'],
          ['disk', 'Ideal disk access estimate']
        ],
        'measured'
      ),
      num('Ru', 'Measured uncompensated resistance', 100, 'resistance', 'Ω', {
        ...nonnegative,
        when: v => v.method === 'measured'
      }),
      num('kappa', 'Conductivity', 10, 'conductivity', 'mS/cm', {
        ...positive,
        when: v => v.method !== 'measured'
      }),
      num('length', 'Plate separation', 1, 'length', 'mm', {
        ...positive,
        when: v => v.method === 'planar'
      }),
      { ...A(0.1), when: v => v.method === 'planar' },
      num('radius', 'Disk radius', 5, 'length', 'µm', {
        ...positive,
        when: v => v.method === 'disk'
      }),
      V('E', 'Applied/measured potential', -0.5),
      num('I', 'Signed total current', 1, 'current', 'µA'),
      convention()
    ],
    v => {
      const ru =
          v.method === 'measured'
            ? v.Ru
            : v.method === 'planar'
              ? v.length / (v.kappa * v.A)
              : 1 / (4 * v.kappa * v.radius),
        corr = (v.convention === 'book' ? 1 : -1) * v.I * ru;
      return pack(
        [
          row('Ru', 'Resistance used for correction', ru, 'Ω'),
          row('drop', 'Signed current × resistance', v.I * ru, 'V'),
          row('corrected', 'Corrected interfacial potential', v.E + corr, 'V')
        ],
        v.method === 'measured'
          ? []
          : [
              'Geometry estimate: confirm that this resistance is the appropriate uncompensated path before applying the correction.'
            ]
      );
    }
  );
  add(
    'sand',
    'Sand transition time',
    'Transport & voltammetry',
    'Planar constant-current depletion time and inverse current for a chosen time.',
    ['9.2.2'],
    'τ = (πD/4) [nFAC/|I|]²\n|I| for target τ = nFAC √[πD/(4τ)]',
    'Constant-current electrolysis under semi-infinite planar diffusion with negligible migration and convection. The reactant surface concentration reaches zero at τ. Current is faradaic and devoted to this reaction; charging, adsorption, side reactions, finite cells, and curved electrodes require other treatments. This is not a generic solid-state battery depletion formula.',
    [
      N(),
      A(0.1),
      D(),
      { ...C(), ...positive },
      num('I', 'Faradaic current magnitude', 10, 'current', 'µA', positive),
      num('target', 'Target transition time', 1, 'time', 's', positive)
    ],
    v => {
      const pref = v.n * F * v.A * v.C,
        tau = ((Math.PI * v.D) / 4) * (pref / v.I) ** 2;
      return pack([
        row('tau', 'Transition time', tau, 's'),
        row(
          'I',
          'Current for target transition time',
          pref * Math.sqrt((Math.PI * v.D) / (4 * v.target)),
          'A'
        )
      ]);
    }
  );
  add(
    'anson',
    'Chronocoulometry / Anson',
    'Charge & interfaces',
    'Separate diffusion, adsorbed charge, and a specified double-layer offset.',
    ['6.6.1', '17.3.1'],
    'Qdiff = 2 n F A C √(Dt/π)\nQads = n F A Γ\nQtotal = Qdiff + Qads + Qdl\nAnson slope dQ/d√t = 2 n F A C √(D/π)',
    'Planar diffusion-limited potential-step chronocoulometry. Adsorbed reactant is assumed rapidly and completely electrolyzed; the supplied double-layer charge is an effectively time-independent offset in the fitted-time regime. Qdiff and Qads are positive reaction-charge magnitudes in the chosen integration direction; Qdl is a signed offset in that same convention. The ideal intercept is extrapolated; the formula does not resolve the earliest charging transient.',
    [
      N(),
      A(0.1),
      D(),
      C(),
      num('t', 'Time after step', 1, 'time', 's', positive),
      num(
        'Gamma',
        'Initially adsorbed reactant coverage',
        100,
        'coverage',
        'pmol/cm²',
        nonnegative
      ),
      num('Qdl', 'Signed double-layer offset', 0, 'charge', 'µC')
    ],
    v => {
      const slope = 2 * v.n * F * v.A * v.C * Math.sqrt(v.D / Math.PI),
        ads = v.n * F * v.A * v.Gamma,
        diff = slope * Math.sqrt(v.t),
        intercept = ads + v.Qdl;
      return pack(
        [
          row('diff', 'Diffusion charge', diff, 'C'),
          row('ads', 'Adsorbed-reactant charge', ads, 'C'),
          row('total', 'Total model charge', diff + intercept, 'C'),
          row('slope', 'Anson slope', slope, 'C/s^(1/2)'),
          row('intercept', 'Anson intercept Qads + Qdl', intercept, 'C')
        ],
        [],
        {
          rows: curve('sqrt_time_s12', lin(0, Math.sqrt(v.t * 5)), x => ({
            charge_C: slope * x + intercept
          }))
        },
        [plot('sqrt_time_s12', 'charge_C', 'Anson plot (zero-time point is an extrapolation)')]
      );
    }
  );
  add(
    'surface',
    'Reversible surface-confined CV',
    'Charge & interfaces',
    'Ideal peak current, integrated charge, peak width, and coverage inferred from charge.',
    ['17.2.2', '17.3.2'],
    '|ip| = n²F² A Γ v/(4RT)\nQ = nFAΓ\nFWHM = 4 acosh(√2) RT/(nF) ≈ 3.52549 RT/(nF)\nΓ from integrated peak charge = |Q|/(nFA)',
    'Ideal reversible, noninteracting, surface-confined redox sites with one Nernstian wave. No diffusion contribution, finite electron-transfer kinetics, site-energy distribution, lateral interactions, or background charging. n must describe that modeled redox wave. Coverage inferred from charge requires complete conversion and correct baseline subtraction.',
    [
      N(),
      A(0.1),
      num('Gamma', 'Total redox-site coverage', 100, 'coverage', 'pmol/cm²', nonnegative),
      num('v', 'Scan-rate magnitude', 0.1, 'scan', 'V/s', positive),
      T(),
      num('Q', 'Measured integrated faradaic peak charge', 1, 'charge', 'µC', nonnegative)
    ],
    v => {
      const Q = v.n * F * v.A * v.Gamma,
        ip = (v.n * F * Q * v.v) / (4 * R * v.T),
        fwhm = (4 * Math.acosh(Math.sqrt(2)) * R * v.T) / (v.n * F);
      return pack(
        [
          row('ip', 'Ideal peak current magnitude', ip, 'A'),
          row('Q', 'Integrated faradaic peak charge', Q, 'C'),
          row('FWHM', 'Ideal full width at half maximum', fwhm * 1000, 'mV'),
          row('Gamma', 'Coverage from measured peak charge', v.Q / (v.n * F * v.A), 'mol/cm²')
        ],
        [],
        {
          rows: curve('scan_rate_V_s', lin(0, v.v * 5), x => ({
            peak_current_A: (v.n * F * Q * x) / (4 * R * v.T)
          }))
        },
        [plot('scan_rate_V_s', 'peak_current_A', 'Surface peak current vs. scan rate')]
      );
    }
  );
  add(
    'langmuir',
    'Langmuir surface coverage',
    'Charge & interfaces',
    'Equilibrium fractional coverage and occupied-site density from free concentration.',
    ['14.5.3'],
    'θ = K Cfree/(1 + K Cfree)\nΓ = Γmax θ\nC at half coverage = 1/K',
    'Independent equivalent sites, one adsorbate per site, equilibrium, and no lateral interactions. Cfree is the equilibrium free concentration, not the initial total added concentration. K is concentration-based here, with reciprocal concentration units. A fit to this model does not prove a unique binding mechanism, site uniformity, or the number of sites in a heterogeneous material.',
    [
      num('K', 'Concentration-based binding constant', 1e5, 'binding', 'L/mol', positive),
      num('C', 'Equilibrium free concentration', 10, 'concentration', 'µM', nonnegative),
      num('Gmax', 'Saturation surface coverage', 100, 'coverage', 'pmol/cm²', nonnegative)
    ],
    v => {
      const x = v.K * v.C,
        theta = x > 1 ? 1 - 1 / (1 + x) : x / (1 + x),
        half = 1 / v.K;
      return pack(
        [
          row('theta', 'Fractional coverage θ', theta),
          row('percent', 'Occupied sites', theta * 100, '%'),
          row('Gamma', 'Occupied surface coverage', v.Gmax * theta, 'mol/cm²'),
          row('half', 'Free concentration at half coverage', half * 1e3, 'M')
        ],
        [],
        {
          rows: curve('free_concentration_M', log((half * 1e3) / 100, half * 1e3 * 100), cm => ({
            coverage_fraction: (v.K * cm) / 1000 / (1 + (v.K * cm) / 1000)
          }))
        },
        [plot('free_concentration_M', 'coverage_fraction', 'Langmuir isotherm', { logX: true })]
      );
    }
  );
  add(
    'arrhenius',
    'Arrhenius temperature scaling',
    'Kinetics',
    'Rescale a specified rate constant with a constant apparent activation energy.',
    ['3.1.2'],
    'k2/k1 = exp[−Ea/R (1/T2 − 1/T1)]',
    'Assumes one applicable Arrhenius regime with temperature-independent apparent activation energy and prefactor. k1 and k2 have the same units. This is not a universal temperature correction for diffusion, electrode reference potentials, or multistep mechanisms. A negative apparent activation energy is permitted but requires physical justification.',
    [
      num('k1', 'Rate constant at T1', 1, null, 'same units as k2', positive),
      num('Ea', 'Apparent activation energy', 50, 'energy', 'kJ/mol'),
      num('T1', 'Reference temperature', 298.15, 'temperature', 'K', positive),
      num('T2', 'New temperature', 308.15, 'temperature', 'K', positive)
    ],
    v => {
      const lnRatio = (-v.Ea / R) * (1 / v.T2 - 1 / v.T1);
      fail(Math.abs(lnRatio) > 650, 'Temperature ratio is outside the supported numerical range.');
      const ratio = Math.exp(lnRatio);
      return pack(
        [
          row('k2', 'Rate constant at T2', v.k1 * ratio, 'same units as k1'),
          row('ratio', 'k2 / k1', ratio)
        ],
        v.Ea < 0
          ? [
              'A negative apparent activation energy is entered. Confirm it is appropriate for the mechanism and temperature interval.'
            ]
          : []
      );
    }
  );
  add(
    'stokes',
    'Stokes–Einstein diffusion',
    'Transport & voltammetry',
    'Estimate translational diffusion for a spherical hydrodynamic particle.',
    ['4.4.1', '19.3.1'],
    'D = kB T/(6πηrh)\nCalculation uses SI: η in Pa·s; rh in m; D in m²/s.',
    'Dilute, spherical, noninteracting particles in a continuum Newtonian fluid with no-slip hydrodynamic boundary conditions. rh is hydrodynamic radius, not diameter or necessarily a microscopy radius. Molecular-scale solvation, crowded media, nonspherical particles, and interfaces may violate the approximation. This is an estimate, not a measured diffusion coefficient.',
    [
      T(),
      num('eta', 'Dynamic viscosity', 1, 'viscosity', 'mPa·s', positive),
      num('radius', 'Hydrodynamic radius', 50, 'length', 'nm', positive)
    ],
    v => {
      const radiusSI = v.radius / 100,
        dSI = (kB * v.T) / (6 * Math.PI * v.eta * radiusSI);
      return pack(
        [
          row('DSI', 'Estimated diffusion coefficient', dSI, 'm²/s'),
          row('D', 'Estimated diffusion coefficient', dSI * 1e4, 'cm²/s'),
          row('Dum', 'Estimated diffusion coefficient', dSI * 1e12, 'µm²/s')
        ],
        radiusSI < 1e-9
          ? ['Sub-nanometre radius: continuum no-slip Stokes–Einstein may be inaccurate.']
          : []
      );
    },
    ['constants']
  );
  add(
    'collisions',
    'Particle arrivals & Poisson counts',
    'Transport & voltammetry',
    'Ideal disk collision rate, mean/variance, and counting probabilities.',
    ['19.3.1', '19.3.2'],
    'Ideal disk arrival rate: f = 4 Dparticle a Cnumber\nλ = f t; mean(N) = variance(N) = λ\nSD(N) = √λ; relative SD = 1/√λ\nP(N ≥ 1) = 1 − exp(−λ); P(N = k) = exp(−λ) λ^k/k!',
    'An ideal absorbing disk in an insulating plane, steady diffusion, constant bulk particle number concentration, independent arrivals, negligible blocking, and unit sticking/detection efficiency. Particle radius is small relative to the electrode. Real collisions may be correlated, convection-driven, missed, or repeated; equality of mean and variance alone does not establish a Poisson model.',
    [
      num('D', 'Particle diffusion coefficient', 1e-7, 'diffusion', 'cm²/s', positive),
      num('radius', 'Disk electrode radius', 5, 'length', 'µm', positive),
      num('CN', 'Particle number concentration', 1e6, 'particleconc', 'particles/mL', nonnegative),
      num('t', 'Counting interval', 100, 'time', 's', nonnegative),
      num('k', 'Count k for exact-count probability', 1, null, '', {
        min: 0,
        max: 10000,
        integer: true
      })
    ],
    v => {
      const f = 4 * v.D * v.radius * v.CN,
        lambda = f * v.t;
      fail(!Number.isFinite(lambda), 'Mean count is outside the supported numerical range.');
      let logfact = 0;
      for (let i = 2; i <= v.k; i++) logfact += Math.log(i);
      const pk =
        lambda === 0 ? (v.k === 0 ? 1 : 0) : Math.exp(-lambda + v.k * Math.log(lambda) - logfact);
      return pack([
        row('f', 'Ideal arrival rate', f, 's⁻¹'),
        row('lambda', 'Mean / variance of count', lambda),
        row('sd', 'Count standard deviation', Math.sqrt(lambda)),
        row(
          'relative',
          'Relative standard deviation',
          lambda > 0 ? 1 / Math.sqrt(lambda) : 'Undefined for zero expected counts'
        ),
        row('atleast', 'Probability of at least one arrival', -Math.expm1(-lambda)),
        row('exact', 'Probability of exactly k arrivals', pk)
      ]);
    }
  );
  add(
    'geometry',
    'Disk area & current density',
    'Charge & interfaces',
    'Convert disk diameter to geometric area and normalize a current.',
    ['1.1.5', '6.1.5'],
    'Adisk = π(d/2)²\nj = I/A\n1 cm² = 10⁻⁴ m²; 1 A/cm² = 10⁴ A/m²',
    'A flat circular disk with its lateral surface masked. Geometric area is not automatically electrochemically active or microscopic area. Roughness, porosity, cracks, and partial wetting can change the relevant area. Current sign is preserved.',
    [
      num('diameter', 'Disk diameter', 3, 'length', 'mm', positive),
      num('I', 'Signed current', 1, 'current', 'mA')
    ],
    v => {
      const a = Math.PI * (v.diameter / 2) ** 2,
        j = v.I / a;
      return pack([
        row('A', 'Geometric disk area', a, 'cm²'),
        row('Asi', 'Geometric disk area', a / 1e4, 'm²'),
        row('j', 'Signed current density', j, 'A/cm²'),
        row('jmA', 'Signed current density', j * 1000, 'mA/cm²'),
        row('jsi', 'Signed current density', j * 1e4, 'A/m²')
      ]);
    }
  );
  function defaults(id) {
    const s = specs.find(x => x.id === id);
    if (!s) throw Error('Unknown calculator.');
    return {
      values: Object.fromEntries(s.fields.map(f => [f.id, f.value])),
      units: Object.fromEntries(s.fields.filter(f => f.dimension).map(f => [f.id, f.unit]))
    };
  }
  function toCanonical(value, dimension, unit) {
    if (!dimension) return value;
    const u = U[dimension]?.[unit];
    if (!u) throw Error('Unknown unit: ' + unit);
    return value * u[0] + u[1];
  }
  function convert(value, dimension, from, to) {
    const u = U[dimension]?.[to];
    if (!u) throw Error('Unknown unit: ' + to);
    return (toCanonical(value, dimension, from) - u[1]) / u[0];
  }
  function evaluate(id, raw, units = {}) {
    const s = specs.find(x => x.id === id);
    if (!s) throw Error('Unknown calculator: ' + id);
    const v = {};
    for (const f of s.fields) {
      if (f.when && !f.when(raw)) continue;
      if (f.options) {
        const selected = String(raw[f.id] ?? '');
        if (!f.options.some(o => o[0] === selected))
          throw Error(f.label + ': choose a valid option.');
        v[f.id] = selected;
        continue;
      }
      const entered = raw[f.id];
      if (entered === undefined || entered === null || String(entered).trim() === '')
        throw Error(f.label + ': enter a number.');
      let n = Number(entered);
      if (!Number.isFinite(n)) throw Error(f.label + ': enter a finite number.');
      n = toCanonical(n, f.dimension, units[f.id] || f.unit);
      if (!Number.isFinite(n)) throw Error(f.label + ': converted value is too large.');
      if (f.min !== undefined && (f.exclusive ? n <= f.min : n < f.min))
        throw Error(
          f.label +
            ': must be ' +
            (f.exclusive ? 'greater than ' : 'at least ') +
            f.min +
            ' in canonical units.'
        );
      if (f.max !== undefined && (f.exclusive ? n >= f.max : n > f.max))
        throw Error(
          f.label + ': must be ' + (f.exclusive ? 'less than ' : 'at most ') + f.max + '.'
        );
      if (f.integer && !Number.isInteger(n)) throw Error(f.label + ': enter a whole number.');
      v[f.id] = n;
    }
    const out = s.calculate(v);
    out.canonicalInputs = v;
    return out;
  }
  const api = {
    constants: { NA, e, kB, F, R },
    units: U,
    external,
    specs,
    defaults,
    evaluate,
    convert,
    toCanonical,
    impedance
  };
  root.AtlasCalcEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
