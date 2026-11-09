/* Electrochemical Atlas — local, dependency-free PDF text/outline extractor.
 * The application package contains no publication data.  Everything returned by
 * this module is derived at runtime from the PDF the reader selects.  This
 * lightweight extractor handles the selectable-text/ToUnicode PDFs for which
 * Atlas is intended; it is not an OCR or a general PDF renderer.
 */
(root => {
  'use strict';
  const escRe = /[.*+?^${}()|[\]\\]/g;
  const slash = x => String(x || '').replace(escRe, '\\$&');
  function bytesToLatin1(bytes) {
    const parts = [];
    for (let i = 0; i < bytes.length; i += 16384)
      parts.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
    return parts.join('');
  }
  function utf16hex(hex) {
    const nums = [];
    for (let i = 0; i + 3 < hex.length; i += 4) nums.push(parseInt(hex.slice(i, i + 4), 16));
    return String.fromCharCode(...nums);
  }
  function literal(str) {
    let s = '';
    for (let i = 0; i < str.length; i++) {
      if (str[i] !== '\\') {
        s += str[i];
        continue;
      }
      let c = str[++i];
      if (c === undefined) break;
      if (/[0-7]/.test(c)) {
        let digits = c;
        for (let k = 0; k < 2 && /[0-7]/.test(str[i + 1] || ''); k++) digits += str[++i];
        s += String.fromCharCode(parseInt(digits, 8));
      } else if (c === 'n') s += '\n';
      else if (c === 'r') s += '\r';
      else if (c === 't') s += '\t';
      else if (c === 'b') s += '\b';
      else if (c === 'f') s += '\f';
      else if (c === '\r') {
        if (str[i + 1] === '\n') i++;
      } else if (c !== '\n') s += c;
    }
    if (s.charCodeAt(0) === 254 && s.charCodeAt(1) === 255) {
      let out = '';
      for (let i = 2; i + 1 < s.length; i += 2)
        out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
      return out;
    }
    return s;
  }
  function parseString(source, mark) {
    const at = source.indexOf(mark);
    if (at < 0) return '';
    let p = at + mark.length;
    while (/\s/.test(source[p] || '')) p++;
    if (source[p] === '<') {
      const end = source.indexOf('>', p);
      return utf16hex(source.slice(p + 1, end));
    }
    if (source[p] !== '(') return '';
    const start = ++p;
    let level = 1;
    for (; p < source.length; p++) {
      if (source[p] === '\\') {
        p++;
        continue;
      }
      if (source[p] === '(') level++;
      if (source[p] === ')' && --level === 0) break;
      // Count a parenthesis only if encountered; the decrement above is guarded.
      if (source[p] !== ')') level = level;
    }
    return literal(source.slice(start, p));
  }
  function safeString(source, mark) {
    const at = source.indexOf(mark);
    if (at < 0) return '';
    let p = at + mark.length;
    while (/\s/.test(source[p] || '')) p++;
    if (source[p] === '<') {
      let end = source.indexOf('>', p),
        hex = source.slice(p + 1, end);
      return hex.toUpperCase().startsWith('FEFF')
        ? utf16hex(hex.slice(4))
        : bytesToLatin1(Uint8Array.from(hex.match(/../g) || [], h => parseInt(h, 16)));
    }
    if (source[p] !== '(') return '';
    const start = ++p;
    let depth = 1;
    for (; p < source.length; p++) {
      if (source[p] === '\\') {
        p++;
        continue;
      }
      if (source[p] === '(') depth++;
      else if (source[p] === ')' && !--depth) break;
    }
    return literal(source.slice(start, p));
  }
  function parseRef(s, key) {
    const m = s.match(new RegExp('/' + slash(key) + '\\s+(\\d+)\\s+\\d+\\s+R'));
    return m ? +m[1] : 0;
  }
  function refList(s, key) {
    const re = new RegExp('/' + slash(key) + '\\s*\\[([\\s\\S]*?)\\]');
    const m = s.match(re);
    return m ? [...m[1].matchAll(/(\d+)\s+\d+\s+R/g)].map(x => +x[1]) : [];
  }
  async function inflate(rawBytes) {
    if (typeof DecompressionStream !== 'function')
      throw new Error(
        'This browser does not support the built-in decompression needed to read PDF text.'
      );
    const stream = new Blob([rawBytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  class PDFLite {
    constructor(file) {
      this.file = file;
      this.objects = new Map();
      this.fontMaps = new Map();
      this.pageObjects = [];
      this.pageRefs = new Map();
      this.labels = [];
      this.outline = [];
      this.buffer = null;
      this.source = '';
      this.metadata = {};
      this.progress = () => {};
      this.contentCache = new Map();
    }
    async init(onProgress) {
      this.progress = onProgress || (() => {});
      this.progress('Reading your PDF…', 0);
      this.buffer = new Uint8Array(await this.file.arrayBuffer());
      if (bytesToLatin1(this.buffer.subarray(0, 8)).indexOf('%PDF-') !== 0)
        throw new Error('The selected file is not a PDF.');
      this.source = bytesToLatin1(this.buffer);
      const rx = /(?:^|\r?\n)(\d+)\s+(\d+)\s+obj\b/g;
      let match;
      while ((match = rx.exec(this.source)) !== null) {
        const id = +match[1];
        const start = rx.lastIndex;
        const end = this.source.indexOf('endobj', start);
        if (end < 0) continue;
        const raw = this.source.slice(start, end);
        let streamAt = raw.search(/\bstream\r?\n/);
        let dict = streamAt < 0 ? raw : raw.slice(0, streamAt);
        const obj = { dict, raw: null, stream: null };
        if (streamAt >= 0) {
          const from = start + streamAt + raw.slice(streamAt).match(/^stream\r?\n/)[0].length;
          const to = this.source.indexOf('endstream', from);
          if (to > from) {
            const len = Number(dict.match(/\/Length\s+(\d+)/)?.[1] || 0);
            obj.stream = this.buffer.subarray(
              from,
              len > 0 && from + len <= to ? from + len : to - (this.buffer[to - 1] === 10 ? 1 : 0)
            );
          }
        }
        this.objects.set(id, obj);
      }
      this.progress('Reading PDF document structure…', 2);
      const streams = [...this.objects].filter(([id, o]) => /\/Type\s*\/ObjStm\b/.test(o.dict));
      let n = 0;
      for (const [id, o] of streams) {
        const str = bytesToLatin1(await this.stream(id));
        const N = Number(o.dict.match(/\/N\s+(\d+)/)?.[1] || 0),
          First = Number(o.dict.match(/\/First\s+(\d+)/)?.[1] || 0);
        const nums = (str.slice(0, First).match(/\d+/g) || []).map(Number);
        for (let k = 0; k < N; k++) {
          const oid = nums[2 * k],
            start = First + nums[2 * k + 1];
          const end = k + 1 < N ? First + nums[2 * (k + 1) + 1] : str.length;
          if (Number.isInteger(oid) && end >= start)
            this.objects.set(oid, { dict: str.slice(start, end).trim(), stream: null, raw: null });
        }
        n++;
        if (n % 7 === 0)
          this.progress(
            'Reading PDF document structure…',
            2 + Math.round((8 * n) / streams.length)
          );
      }
      let catalogId = 0;
      for (const [id, o] of this.objects)
        if (/\/Type\s*\/Catalog\b/.test(o.dict)) {
          catalogId = id;
          break;
        }
      if (!catalogId)
        throw new Error(
          'The PDF catalog could not be located. The file may be protected or unsupported.'
        );
      const catalog = this.get(catalogId);
      this.catalogId = catalogId;
      this.metadata = {
        title: safeString(this.get(parseRef(catalog, 'Info')), '/Title') || this.file.name,
        pageCount: 0
      };
      let rootPages = parseRef(catalog, 'Pages');
      const visited = new Set();
      const walk = (id, depth = 0) => {
        if (!id || depth > 10 || visited.has(id)) return;
        visited.add(id);
        const str = this.get(id);
        if (/\/Type\s*\/Page\b/.test(str) && !/\/Type\s*\/Pages\b/.test(str)) {
          this.pageRefs.set(id, this.pageObjects.length + 1);
          this.pageObjects.push(id);
          return;
        }
        for (const child of refList(str, 'Kids')) walk(child, depth + 1);
      };
      walk(rootPages);
      if (!this.pageObjects.length) throw new Error('The PDF page tree could not be read.');
      this.metadata.pageCount = this.pageObjects.length;
      this.labels = Array.from({ length: this.pageObjects.length }, (_, i) => String(i + 1));
      const pageLabels = catalog.match(/\/PageLabels\s*<<([\s\S]*?)>>/);
      if (pageLabels) {
        const nodes = refList(pageLabels[0], 'Kids');
        for (const node of nodes) {
          const pairs = [
            ...this.get(node).matchAll(/(\d+)\s*<<\s*\/P\s*(\([^)]*\)|<[\da-fA-F]+>)\s*>>/g)
          ];
          for (const pair of pairs)
            this.labels[+pair[1]] =
              pair[2][0] === '(' ? literal(pair[2].slice(1, -1)) : utf16hex(pair[2].slice(1, -1));
        }
      }
      const outlineRoot = parseRef(catalog, 'Outlines');
      const outlineParent = new Set();
      const traverse = (id, level = 1) => {
        for (let safety = 0; id && safety < 2000; safety++) {
          if (outlineParent.has(id)) return;
          outlineParent.add(id);
          const obj = this.get(id);
          const title = safeString(obj, '/Title').trim();
          const destId = Number(obj.match(/\/Dest\s*\[\s*(\d+)\s+\d+\s+R/)?.[1] || 0);
          let actionId = 0;
          if (!destId) {
            actionId = parseRef(obj, 'A');
          }
          const a = this.get(actionId);
          const actionDest = Number(a.match(/\/D\s*\[\s*(\d+)\s+\d+\s+R/)?.[1] || 0);
          const page = this.pageRefs.get(destId || actionDest) || 0;
          if (title && page) this.outline.push({ level, title, page, y: 0 });
          const first = parseRef(obj, 'First');
          if (first) traverse(first, level + 1);
          id = parseRef(obj, 'Next');
        }
      };
      traverse(parseRef(this.get(outlineRoot), 'First'));
      if (!this.outline.length)
        throw new Error(
          'This edition has no readable chapter bookmarks; Atlas needs its original PDF outline.'
        );
      // Static publication data is never loaded. The outline and page labels above come solely from the user's file.
      this.progress(
        'Detected ' + this.pageObjects.length + ' pages and ' + this.outline.length + ' bookmarks.',
        11
      );
      return this;
    }
    get(id) {
      return this.objects.get(Number(id))?.dict || '';
    }
    async stream(id) {
      const o = this.objects.get(Number(id));
      if (!o?.stream) return new Uint8Array();
      if (o.raw) return o.raw;
      try {
        o.raw = /\/FlateDecode\b/.test(o.dict) ? await inflate(o.stream) : o.stream;
      } catch (err) {
        throw new Error(
          `Cannot decompress PDF object ${id}: ${o.dict.slice(0, 130)}; bytes=${o.stream.length}; header=${[...o.stream.subarray(0, 6)]}: ${err.message}`
        );
      }
      return o.raw;
    }
    async fontMap(id) {
      id = Number(id);
      if (this.fontMaps.has(id)) return this.fontMaps.get(id);
      const font = this.get(id),
        unicodeRef = parseRef(font, 'ToUnicode');
      if (!unicodeRef) {
        const empty = { map: new Map(), length: 1, objectId: id };
        this.fontMaps.set(id, empty);
        return empty;
      }
      const cmap = bytesToLatin1(await this.stream(unicodeRef));
      const map = new Map();
      let length = 1;
      const codeSpace = cmap.match(/<([0-9a-fA-F]+)>\s*<[0-9a-fA-F]+>\s*endcodespacerange/);
      if (codeSpace) length = Math.max(1, codeSpace[1].length / 2);
      for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const m of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))
          map.set(parseInt(m[1], 16), utf16hex(m[2]));
      }
      for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const line of section[1].split(/\r?\n/)) {
          const m = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
          if (m) {
            const from = parseInt(m[1], 16),
              end = parseInt(m[2], 16),
              to = parseInt(m[3], 16);
            for (let v = from; v <= Math.min(from + 1000, end); v++)
              map.set(v, utf16hex((to + v - from).toString(16).padStart(m[3].length, '0')));
            continue;
          }
          const a = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/);
          if (a) {
            const from = parseInt(a[1], 16),
              arr = [...a[3].matchAll(/<([0-9a-fA-F]+)>/g)].map(k => utf16hex(k[1]));
            arr.forEach((val, i) => map.set(from + i, val));
          }
        }
      }
      const result = { map, length, objectId: id };
      this.fontMaps.set(id, result);
      return result;
    }
    async fontsForPage(pageId) {
      let resourceId = parseRef(this.get(pageId), 'Resources'),
        resources = resourceId ? this.get(resourceId) : this.get(pageId);
      if (!/\/Font\b/.test(resources)) resources = this.get(pageId);
      const fonts = {};
      const match = resources.match(/\/Font\s*<<([\s\S]*?)>>/);
      const source = match ? match[1] : resources;
      for (const m of source.matchAll(/\/(F\d+)\s+(\d+)\s+\d+\s+R/g))
        fonts[m[1]] = await this.fontMap(m[2]);
      return fonts;
    }
    decodeText(encoded, font) {
      const result = [];
      const len = font?.length || 1;
      for (let i = 0; i < encoded.length; i += len) {
        let value = 0;
        for (let k = 0; k < len; k++) value = value * 256 + (encoded.charCodeAt(i + k) || 0);
        result.push(font?.map.get(value) ?? String.fromCharCode(value <= 255 ? value : 32));
      }
      return result.join('');
    }
    async pageText(pageNo) {
      pageNo = Number(pageNo);
      if (this.contentCache.has(pageNo)) {
        const cached = this.contentCache.get(pageNo);
        return cached.text;
      }
      const pageId = this.pageObjects[pageNo - 1];
      if (!pageId) return '';
      const obj = this.get(pageId);
      const contents = refList(obj, 'Contents');
      if (!contents.length) {
        const one = parseRef(obj, 'Contents');
        if (one) {
          const target = this.get(one).trim();
          if (target.startsWith('['))
            contents.push(...[...target.matchAll(/(\d+)\s+\d+\s+R/g)].map(m => +m[1]));
          else contents.push(one);
        }
      }
      const fonts = await this.fontsForPage(pageId);
      let text = '';
      let stream = '';
      const blocks = [];
      for (const ref of contents) {
        const bytes = await this.stream(ref);
        if (!bytes.length) continue;
        stream += bytesToLatin1(bytes) + '\n';
      }
      {
        // Extract text-show operators in reading order, ignoring drawing/image operations.
        for (const block of stream.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
          let currentFont = fonts.F3 || { map: new Map(), length: 1 },
            currentFontKey = 'F3',
            line = '';
          const runs = [];
          const append = t => {
            line += t;
            if (runs.length && runs[runs.length - 1].font === currentFontKey)
              runs[runs.length - 1].text += t;
            else runs.push({ font: currentFontKey, text: t });
          };
          const tokens = block[1].matchAll(
            /\/(F\d+)\s+(?:[-+\d.]+)\s+Tf|\[([\s\S]*?)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj|<([0-9a-fA-F]+)>\s*Tj|(?:-?[\d.]+\s+){5}-?[\d.]+\s+Tm|(?:-?[\d.]+\s+){2}(?:TD|Td)|(?<![a-zA-Z])T\*/g
          );
          for (const t of tokens) {
            if (t[1]) {
              currentFont = fonts[t[1]] || currentFont;
              currentFontKey = t[1];
              continue;
            }
            if (!t[2] && t[3] === undefined && !t[4]) {
              if (line && !line.endsWith('\n')) append('\n');
              continue;
            }
            if (t[2] !== undefined) {
              const chunks = t[2].matchAll(
                /\(((?:\\.|[^\\)])*)\)|<([0-9a-fA-F]+)>|(-?\d+(?:\.\d+)?)/g
              );
              for (const chunk of chunks) {
                if (chunk[1] !== undefined) append(this.decodeText(literal(chunk[1]), currentFont));
                else if (chunk[2]) {
                  const raw = bytesToLatin1(
                    Uint8Array.from(chunk[2].match(/../g) || [], p => parseInt(p, 16))
                  );
                  append(this.decodeText(raw, currentFont));
                } else if (+chunk[3] < -130 && line && !/\s$/.test(line)) append(' ');
              }
            } else if (t[3] !== undefined) append(this.decodeText(literal(t[3]), currentFont));
            else if (t[4]) {
              const raw = bytesToLatin1(
                Uint8Array.from(t[4].match(/../g) || [], p => parseInt(p, 16))
              );
              append(this.decodeText(raw, currentFont));
            }
          }
          line = line
            .replace(/[ \t]+/g, ' ')
            .replace(/\n[ \t]+/g, '\n')
            .trim();
          if (line) {
            text += line + '\n';
            blocks.push({ text: line, runs });
          }
        }
      }
      // Equation numbers are often independent PDF text-show operations. Unlike
      // prose mentions, these form a dependable source anchor for their equation.
      const equationAnchors = [];
      let anchorX = 0,
        anchorY = 0;
      const marks = stream.matchAll(
        /(?:[-+]?\d+(?:\.\d+)?\s+){5}[-+]?\d+(?:\.\d+)?\s+Tm|\((?:\\.|[^\\)])*\)\s*Tj/g
      );
      for (const mark of marks) {
        const token = mark[0];
        if (/\bTm$/.test(token)) {
          const n = token.match(/[-+]?\d+(?:\.\d+)?/g);
          if (n && n.length === 6) {
            anchorX = +n[4];
            anchorY = +n[5];
          }
        } else {
          const lit = token.match(/^\(((?:\\.|[^\\)])*)\)\s*Tj/);
          if (!lit) continue;
          const value = literal(lit[1]);
          const hit = value.match(/^\(((?:\d{1,2}|[A-C])\.\d{1,2}\.\d{1,3}[a-z]?(?:,[a-z])?)\)$/);
          if (hit)
            equationAnchors.push({ label: hit[1], pdf_page: pageNo, x: anchorX, y: anchorY });
        }
      }
      // Some PDFs use font subset ligatures and hard line breaks.
      text = text.replace(
        /[\uFB00-\uFB06]/g,
        c => ({ ﬀ: 'ff', ﬁ: 'fi', ﬂ: 'fl', ﬃ: 'ffi', ﬄ: 'ffl', ﬅ: 'st', ﬆ: 'st' })[c] || c
      );
      if (this.contentCache.size >= 18)
        this.contentCache.delete(this.contentCache.keys().next().value);
      this.contentCache.set(pageNo, { text, blocks, equationAnchors });
      return text;
    }
    async pageBlocks(pageNo) {
      if (!this.contentCache.has(Number(pageNo))) await this.pageText(pageNo);
      return this.contentCache.get(Number(pageNo)).blocks;
    }
    // Optional table-column metadata. The normal text index keeps its original
    // reading order; only callers that need column boundaries pay for this pass.
    // Coordinates are bottom-left PDF points for untransformed horizontal text.
    // Unsupported font metrics or graphics transforms yield null positions.
    async pageTextPositions(pageNo) {
      const pageId = this.pageObjects[Number(pageNo) - 1];
      if (!pageId) return [];
      const object = this.get(pageId);
      const contents = refList(object, 'Contents');
      if (!contents.length) {
        const reference = parseRef(object, 'Contents');
        if (reference) {
          const target = this.get(reference).trim();
          if (target.startsWith('['))
            contents.push(...[...target.matchAll(/(\d+)\s+\d+\s+R/g)].map(match => +match[1]));
          else contents.push(reference);
        }
      }
      const fonts = await this.fontsForPage(pageId);
      const metrics = new Map();
      for (const font of Object.values(fonts)) {
        const dictionary = this.get(font.objectId);
        const widthsReference = parseRef(dictionary, 'Widths');
        const widths = widthsReference
          ? this.get(widthsReference)
          : dictionary.match(/\/Widths\s*\[([^\]]*)\]/)?.[1] || '';
        metrics.set(font, {
          first: Number(dictionary.match(/\/FirstChar\s+(\d+)/)?.[1] || 0),
          widths: (widths.match(/[-+]?\d+(?:\.\d+)?/g) || []).map(Number),
          name: dictionary.match(/\/BaseFont\s*\/([^\s/<>()\[\]]+)/)?.[1] || ''
        });
      }
      let stream = '';
      for (const reference of contents)
        stream += bytesToLatin1(await this.stream(reference)) + '\n';
      const lines = [];
      const ligatures = { ﬀ: 'ff', ﬁ: 'fi', ﬂ: 'fl', ﬃ: 'ffi', ﬄ: 'ffl', ﬅ: 'st', ﬆ: 'st' };
      // BT resets the text matrices, not the font or spacing parameters.
      let fontKey = '',
        font,
        fontSize = 0,
        characterSpace = 0,
        wordSpace = 0,
        horizontalScale = 1,
        leading = 0,
        rise = 0,
        transformed = false,
        previousEnd = 0;
      const graphicsStack = [];
      for (const block of stream.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
        // The source tables have identity graphics transforms. Track q/Q so
        // transformed drawing rules outside a text object do not invalidate it;
        // a transform that reaches text is deliberately not guessed through.
        const prefix = stream.slice(previousEnd, block.index);
        const graphics = prefix.matchAll(
          /\((?:\\.|[^\\)])*\)|<[^>]*>|\/[A-Za-z0-9]+|(?:[-+\d.]+\s+){5}[-+\d.]+\s+cm|(?<!\S)[qQ](?!\S)/g
        );
        for (const match of graphics) {
          const token = match[0];
          if (token === 'q')
            graphicsStack.push({
              fontKey,
              font,
              fontSize,
              characterSpace,
              wordSpace,
              horizontalScale,
              leading,
              rise,
              transformed
            });
          else if (token === 'Q') {
            const saved = graphicsStack.pop();
            if (saved)
              ({
                fontKey,
                font,
                fontSize,
                characterSpace,
                wordSpace,
                horizontalScale,
                leading,
                rise,
                transformed
              } = saved);
            else transformed = true;
          } else if (/\scm$/.test(token)) {
            const values = token.slice(0, -3).trim().split(/\s+/).map(Number);
            transformed ||= values.some((value, i) => value !== [1, 0, 0, 1, 0, 0][i]);
          }
        }
        previousEnd = block.index + block[0].length;
        let matrix = [1, 0, 0, 1, 0, 0],
          lineMatrix = [...matrix],
          positioned = true,
          line = { text: '', fragments: [] };
        const finishLine = () => {
          line.text = line.text.replace(/[ \t]+/g, ' ').trim();
          if (line.text) lines.push(line);
          line = { text: '', fragments: [] };
        };
        const moveLine = (x, y) => {
          lineMatrix[4] += x * lineMatrix[0] + y * lineMatrix[2];
          lineMatrix[5] += x * lineMatrix[1] + y * lineMatrix[3];
          matrix = [...lineMatrix];
          positioned = true;
        };
        const show = encoded => {
          const metric = metrics.get(font);
          const codeLength = font?.length || 1;
          for (let i = 0; i < encoded.length; i += codeLength) {
            let code = 0;
            for (let k = 0; k < codeLength; k++)
              code = code * 256 + (encoded.charCodeAt(i + k) || 0);
            const width = metric?.widths[code - metric.first];
            if (!Number.isFinite(width)) positioned = false;
            const text = this.decodeText(encoded.slice(i, i + codeLength), font).replace(
              /[\uFB00-\uFB06]/g,
              c => ligatures[c]
            );
            line.text += text;
            // Keep individual glyph origins: a PDF can cross table columns
            // inside one string by setting a very large character spacing.
            line.fragments.push({
              text,
              x:
                positioned && !transformed && matrix[1] === 0 && matrix[2] === 0
                  ? matrix[4] + rise * matrix[2]
                  : null,
              y:
                positioned && !transformed && matrix[1] === 0 && matrix[2] === 0
                  ? matrix[5] + rise * matrix[3]
                  : null,
              width: ((width || 0) * fontSize * horizontalScale * matrix[0]) / 1000,
              size: Math.abs(matrix[3] * fontSize),
              font: fontKey,
              fontName: metric?.name || '',
              bold: /Bold|Semibold|Demi/.test(metric?.name || ''),
              italic: /(?:-It$|Italic|Oblique)/.test(metric?.name || ''),
              scriptFont: /Script/.test(metric?.name || ''),
              overbar: false
            });
            const advance =
              (((width || 0) * fontSize) / 1000 + characterSpace + (code === 32 ? wordSpace : 0)) *
              horizontalScale;
            matrix[4] += advance * matrix[0];
            matrix[5] += advance * matrix[1];
          }
        };
        const tokens = block[1].matchAll(
          /\/(F\d+)\s+([-+\d.]+)\s+Tf|\[([\s\S]*?)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj|<([0-9a-fA-F]+)>\s*Tj|((?:[-+\d.]+\s+){5}[-+\d.]+)\s+Tm|([-+\d.]+)\s+([-+\d.]+)\s+(TD|Td)|([-+\d.]+)\s+(Tc|Tw|Tz|TL|Ts)|(?<![a-zA-Z])T\*/g
        );
        for (const token of tokens) {
          if (token[1]) {
            fontKey = token[1];
            font = fonts[fontKey];
            fontSize = Number(token[2]);
          } else if (token[3] !== undefined) {
            for (const chunk of token[3].matchAll(
              /\(((?:\\.|[^\\)])*)\)|<([0-9a-fA-F]+)>|([-+]?\d*\.?\d+)/g
            )) {
              if (chunk[1] !== undefined) show(literal(chunk[1]));
              else if (chunk[2])
                show(
                  bytesToLatin1(
                    Uint8Array.from(chunk[2].match(/../g) || [], value => parseInt(value, 16))
                  )
                );
              else {
                const adjustment = Number(chunk[3]);
                if (adjustment < -130 && line.text && !/\s$/.test(line.text)) line.text += ' ';
                const advance = (-adjustment * fontSize * horizontalScale) / 1000;
                matrix[4] += advance * matrix[0];
                matrix[5] += advance * matrix[1];
              }
            }
          } else if (token[4] !== undefined) show(literal(token[4]));
          else if (token[5])
            show(
              bytesToLatin1(
                Uint8Array.from(token[5].match(/../g) || [], value => parseInt(value, 16))
              )
            );
          else if (token[6]) {
            finishLine();
            matrix = token[6].trim().split(/\s+/).map(Number);
            lineMatrix = [...matrix];
            positioned = true;
          } else if (token[9]) {
            finishLine();
            if (token[9] === 'TD') leading = -Number(token[8]);
            moveLine(Number(token[7]), Number(token[8]));
          } else if (token[11]) {
            const value = Number(token[10]);
            if (token[11] === 'Tc') characterSpace = value;
            else if (token[11] === 'Tw') wordSpace = value;
            else if (token[11] === 'Tz') horizontalScale = value / 100;
            else if (token[11] === 'TL') leading = value;
            else rise = value;
          } else {
            finishLine();
            moveLine(0, -leading);
          }
        }
        finishLine();
      }
      // Some source accents are short stroked rules rather than text glyphs.
      // Recognize only isolated, translated, horizontal paths whose geometry
      // fits one letter. Long table rules and fractions with a numerator above
      // the stroke are not overbars. Other drawing constructions stay unknown.
      const glyphs = lines.flatMap(line => line.fragments);
      const number = '([-+]?\\d*\\.?\\d+)';
      const rule = new RegExp(
        '\\bq\\s+1\\s+0\\s+0\\s+1\\s+' +
          number +
          '\\s+' +
          number +
          '\\s+cm\\s+' +
          number +
          '\\s+' +
          number +
          '\\s+m\\s+' +
          number +
          '\\s+' +
          number +
          '\\s+l\\s+S\\s+Q\\b',
        'g'
      );
      for (const match of stream.matchAll(rule)) {
        const [tx, ty, x0, y0, x1, y1] = match.slice(1).map(Number);
        if (Math.abs(y0 - y1) > 0.05 || x1 <= x0 || x1 - x0 > 40) continue;
        const left = tx + x0,
          right = tx + x1,
          y = ty + y0;
        for (const glyph of glyphs) {
          if (
            !Number.isFinite(glyph.x) ||
            !Number.isFinite(glyph.y) ||
            !/^\p{L}$/u.test(glyph.text) ||
            glyph.size <= 0
          )
            continue;
          const gap = y - glyph.y;
          if (
            gap < glyph.size * 0.45 ||
            gap > glyph.size * 1.1 ||
            Math.abs(left - glyph.x) > glyph.size * 0.15 ||
            Math.abs(right - glyph.x - glyph.width) > glyph.size * 0.2
          )
            continue;
          const numerator = glyphs.some(
            other =>
              other !== glyph &&
              other.y > y &&
              other.y - y < glyph.size * 0.75 &&
              Math.min(other.x + other.width, right) - Math.max(other.x, left) >
                Math.min(other.width, right - left) * 0.5
          );
          if (!numerator) glyph.overbar = true;
        }
      }
      return lines;
    }
    async pageEquationAnchors(pageNo) {
      if (!this.contentCache.has(Number(pageNo))) await this.pageText(pageNo);
      return this.contentCache.get(Number(pageNo)).equationAnchors;
    }
    // Native PDF viewer displays original graphics, figures, pages and clickable original annotations.
    release() {
      this.source = '';
      this.buffer = null;
      this.objects.clear();
      this.contentCache.clear();
    }
  }
  root.AtlasPDFCore = { PDFLite };
  if (typeof module !== 'undefined' && module.exports) module.exports = { PDFLite };
})(typeof window !== 'undefined' ? window : globalThis);
