/* Size Chart Checker: fit engine (no network, no dependencies).
   Works in the browser (window.FitEngine) and in Node (module.exports). */
(function (root) {
  "use strict";
  var CM_PER_IN = 2.54;

  // Measurement keys we understand. Order matters for matching (more specific first).
  var MEASURES = [
    { key: "underbust", re: /under\s*-?\s*bust|band/i, label: "Underbust" },
    { key: "chest", re: /bust|chest|pit\s*to\s*pit|p2p|width|breast/i, label: "Chest / bust" },
    { key: "waist", re: /waist/i, label: "Waist" },
    { key: "hips", re: /hip|seat/i, label: "Hips" },
    { key: "shoulder", re: /shoulder/i, label: "Shoulder" },
    { key: "sleeve", re: /sleeve|arm\s*length/i, label: "Sleeve" },
    { key: "inseam", re: /inseam|inside\s*leg|inner\s*leg/i, label: "Inseam" },
    { key: "thigh", re: /thigh/i, label: "Thigh" },
    { key: "neck", re: /neck|collar/i, label: "Neck" },
    { key: "length", re: /length|long/i, label: "Length" },
    { key: "height", re: /height|stature/i, label: "Height" }
  ];
  var CIRCUMFERENCE = { chest: 1, waist: 1, hips: 1, thigh: 1, neck: 1, underbust: 1 };
  var SIZE_HEADER_RE = /^(size|sizes|taille|talla|größe|groesse|tag|label|us|uk|eu|it|fr|jp|cn|int|international|asia|asian|alpha|letter|number)\b/i;
  var SIZE_LABEL_RE = /^(\d?x{0,4}[sml]|xxs|xs|s|m|l|xl|xxl|xxxl|\dxl|one\s*size|os|free\s*size|petite|\d{1,2}(\/\d{1,2})?|[a-z]{1,4}\s*\(\s*[\w\/\-\s]+\))$/i;

  function classifyHeader(h) {
    var s = String(h || "").trim();
    for (var i = 0; i < MEASURES.length; i++) if (MEASURES[i].re.test(s)) return MEASURES[i].key;
    return null;
  }
  function headerUnit(h) {
    var s = String(h || "").toLowerCase();
    if (/\bcm\b|centim/.test(s)) return "cm";
    if (/\bin\b|inch|"|″/.test(s)) return "in";
    return null;
  }
  function headerFlat(h) { return /flat|laid|half|pit\s*to\s*pit|p2p|width/i.test(String(h || "")); }

  // Parse "86-90", "86 ~ 90", "86–90", "34 1/2", "34.5", "86/90"; returns [min,max] or null.
  function parseValue(cell, group) {
    if (cell == null) return null;
    var s = String(cell).trim().replace(/,(\d)/g, ".$1").replace(/[″"]|cm|inch(es)?|in\b/gi, " ").trim();
    s = s.replace(/^[a-z][a-z\s:.]*?(?=\d)/i, "").trim(); // "To Fit 32-34", "Fits 86"
    s = s.replace(/\s*(-|–|—|~)\s*/g, "$1").replace(/\s+to\s+/gi, "-");
    // Two values in one cell ("32.7-34.7 83-88" = inches then cm): take the requested group.
    var groups = s.split(/\s+(?=\d)(?!\d+\/\d+$)/);
    if (groups.length === 2 && !/^\d+\/\d+$/.test(groups[1])) s = groups[Math.min(group || 0, 1)];
    if (!s || /^[-–—n\/a]+$/i.test(s)) return null;
    function num(t) {
      t = t.trim();
      var m = t.match(/^(\d+(?:\.\d+)?)\s+(\d+)\/(\d+)$/); // 34 1/2
      if (m) return parseFloat(m[1]) + parseInt(m[2], 10) / parseInt(m[3], 10);
      m = t.match(/^(\d+)\/(\d+)$/);
      if (m && parseInt(m[2], 10) <= 16 && parseInt(m[1], 10) < parseInt(m[2], 10)) return parseInt(m[1], 10) / parseInt(m[2], 10);
      m = t.match(/^\d+(?:\.\d+)?$/);
      return m ? parseFloat(t) : NaN;
    }
    var parts = s.split(/\s*(?:-|–|—|~|to|\/(?=\s*\d{2}))\s*/i).filter(function (p) { return p !== ""; });
    if (parts.length === 1) { var v = num(parts[0]); return isNaN(v) ? null : [v, v]; }
    if (parts.length === 2) {
      var a = num(parts[0]), b = num(parts[1]);
      if (isNaN(a) || isNaN(b)) return null;
      return a <= b ? [a, b] : [b, a];
    }
    return null;
  }

  function splitRows(text) {
    var lines = String(text || "").replace(/\r/g, "")
      .replace(/(\d)\s?([½¼¾⅓⅔⅛])/g, function (m, d, f) { return d + { "½": ".5", "¼": ".25", "¾": ".75", "⅓": ".33", "⅔": ".67", "⅛": ".125" }[f]; })
      .replace(/[½]/g, "0.5").split("\n")
      .map(function (l) { return l.replace(/^\s*\|/, "").replace(/\|\s*$/, ""); })
      .filter(function (l) { return l.trim() !== "" && !/^[\s|:\-–—+]+$/.test(l); });
    if (!lines.length) return [];
    var sep;
    if (lines.some(function (l) { return l.indexOf("\t") >= 0; })) sep = "TAB";
    else if (lines.some(function (l) { return l.indexOf("|") >= 0; })) sep = /\s*\|\s*/;
    else if (lines.every(function (l) { return (l.match(/;/g) || []).length >= 1; })) sep = /\s*;\s*/;
    else if ((function () { var k = lines.map(function (l) { return (l.match(/,/g) || []).length; }); return k[0] >= 1 && k.every(function (x) { return x === k[0]; }); })()) sep = /\s*,\s*/;
    else if (lines.some(function (l) { return /\S {2,}\S/.test(l); })) sep = / {2,}/;
    else sep = null;
    var rows = lines.map(function (l) {
      var cells = sep === "TAB" ? l.split("\t") : (sep ? l.trim().split(sep) : smartSpaceSplit(l.trim()));
      return cells.map(function (c) { return c.trim(); });
    });
    // Drop leading title rows ("CLOTHING - SINGLE SIZE") that have at most one non-empty cell.
    while (rows.length > 2 && rows[0].filter(function (c) { return c; }).length <= 1) rows.shift();
    return collapseUnitPairs(rows);
  }
  var UNIT_CELL = /^(cm|cms|in|ins|inch|inches|"|″)$/i;
  // Charts that give every size twice (CM | In | CM | In ...) under a units row: keep the cm columns.
  function collapseUnitPairs(rows) {
    for (var u = 1; u < Math.min(rows.length, 4); u++) {
      var ur = rows[u], units = ur.filter(function (c) { return c; });
      if (units.length < 2 || !units.every(function (c) { return UNIT_CELL.test(c); })) continue;
      var header = rows[u - 1], keepIdx = [], first = null;
      ur.forEach(function (c, j) { if (!c) return; var k = /^cm/i.test(c) ? "cm" : "in"; if (first === null) first = "cm"; if (k === first) keepIdx.push(j); });
      if (!keepIdx.length) keepIdx = ur.map(function (c, j) { return c ? j : -1; }).filter(function (j) { return j >= 0; });
      var hasCm = ur.some(function (c) { return /^cm/i.test(c); }), unitLabel = hasCm ? "cm" : "in";
      var newHeader = [header[0] || "Size"].concat(header.slice(1).filter(function (c) { return c !== ""; }));
      var body = rows.slice(u + 1).map(function (r) {
        var name = r[0] ? r[0] + " (" + unitLabel + ")" : r[0];
        return [name].concat(keepIdx.map(function (j) { return r[j] == null ? "" : r[j]; }));
      });
      return rows.slice(0, u - 1).concat([newHeader], body);
    }
    return rows;
  }
  // Single-space separated: keep ranges like "86 - 90" and units like "(cm)" together.
  function smartSpaceSplit(l) {
    var s = l.replace(/\s*([-–—~])\s*/g, "$1").replace(/\s+\(/g, "(");
    return s.split(/\s+/);
  }

  function looksLikeSizeLabel(c) { return SIZE_LABEL_RE.test(String(c).trim()) || /^[A-Za-z]{1,5}\d{0,2}$/.test(String(c).trim()); }
  function isNumericCell(c) { return parseValue(c) !== null; }

  // Detect sizes-across layout (first column = measurement names) and transpose to sizes-down.
  function maybeTranspose(rows) {
    if (rows.length < 2) return rows;
    var firstCol = rows.slice(1).map(function (r) { return r[0]; });
    var measureNames = firstCol.filter(function (c) { return classifyHeader(c); }).length;
    var headerSizes = rows[0].slice(1).filter(looksLikeSizeLabel).length;
    var headerMeasures = rows[0].slice(1).filter(function (c) { return classifyHeader(c); }).length;
    if (measureNames >= Math.max(1, firstCol.length - 1) && (headerSizes >= rows[0].length - 2 || headerMeasures === 0)) {
      var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
      var t = [];
      for (var c = 0; c < width; c++) t.push(rows.map(function (r) { return r[c] == null ? "" : r[c]; }));
      if (!t[0][0]) t[0][0] = "Size";
      return t;
    }
    return rows;
  }

  function guessUnit(key, vals) {
    var mids = vals.filter(Boolean).map(function (v) { return (v[0] + v[1]) / 2; });
    if (!mids.length) return null;
    var avg = mids.reduce(function (a, b) { return a + b; }, 0) / mids.length;
    var cutoff = { chest: 58, waist: 48, hips: 58, underbust: 50, shoulder: 25, sleeve: 40, inseam: 45, thigh: 35, neck: 25, length: 50, height: 100 }[key] || 50;
    return avg >= cutoff ? "cm" : "in";
  }

  /* parseChart(text, opts) -> { sizes:[{label, alt:{}, m:{key:[min,max] in cm}}], columns:[...], warnings:[], flatDetected:bool } */
  function parseChart(text, opts) {
    opts = opts || {};
    var warnings = [];
    var rows = maybeTranspose(splitRows(text));
    if (rows.length < 2) return { sizes: [], columns: [], warnings: ["Paste at least a header row and one size row."], flatDetected: false };
    // Find the header row: first row with >=1 measurement header.
    var hIdx = 0;
    for (var i = 0; i < Math.min(rows.length, 4); i++) {
      if (rows[i].some(function (c) { return classifyHeader(c); })) { hIdx = i; break; }
    }
    var header = rows[hIdx];
    var unitLineGlobal = rows.slice(0, hIdx).join(" ");
    var globalUnit = headerUnit(unitLineGlobal) || headerUnit(String(text).slice(0, 400).match(/\((cm|in|inch(?:es)?)\)|\b(cm|inches)\b/i) ? RegExp.lastMatch : "");
    var body = rows.slice(hIdx + 1);
    var columns = header.map(function (h, ci) {
      var key = classifyHeader(h);
      if (SIZE_HEADER_RE.test(String(h).trim()) && !key) key = null;
      return { index: ci, header: h, key: key, unit: headerUnit(h), flat: headerFlat(h) };
    });
    // Size label column: first non-measurement column, else column 0.
    var sizeCol = columns.filter(function (c) { return !c.key; })[0] || columns[0];
    var altCols = columns.filter(function (c) { return !c.key && c !== sizeCol; });
    var measureCols = columns.filter(function (c) { return c.key; });
    if (!measureCols.length) warnings.push("No measurement columns recognised. Headers should include words like Bust, Chest, Waist, Hips, Length.");
    // Duplicate keys (e.g. two "length" columns): keep the first, note it.
    var seen = {};
    measureCols = measureCols.filter(function (c) {
      if (seen[c.key]) { if (!headerUnit(c.header)) warnings.push('Ignored a second "' + c.header + '" column.'); return false; }
      seen[c.key] = 1; return true;
    });
    measureCols.forEach(function (c) {
      var hs = String(c.header).toLowerCase(), iIn = hs.search(/\bin\b|inch/), iCm = hs.search(/\bcm\b/), grp = 0;
      if (iIn >= 0 && iCm >= 0) { grp = iCm > iIn ? 1 : 0; c.unit = "cm"; }
      var vals = body.map(function (r) { return parseValue(r[c.index], grp); });
      var u = opts.unit && opts.unit !== "auto" ? opts.unit : (c.unit || globalUnit || guessUnit(c.key, vals));
      if (!c.unit && !globalUnit && (!opts.unit || opts.unit === "auto")) c.unitGuessed = true;
      c.unit = u;
      c.values = vals;
    });
    var sizes = [];
    body.forEach(function (r, ri) {
      var label = String(r[sizeCol.index] == null ? "" : r[sizeCol.index]).trim();
      if (!label) return;
      var m = {}, any = false;
      measureCols.forEach(function (c) {
        var v = c.values[ri];
        if (v) { var f = c.unit === "in" ? CM_PER_IN : 1; m[c.key] = [v[0] * f, v[1] * f]; any = true; }
      });
      if (!any) return;
      var alt = {};
      altCols.forEach(function (c) { if (r[c.index]) alt[c.header] = r[c.index]; });
      sizes.push({ label: label, alt: alt, m: m });
    });
    if (measureCols.some(function (c) { return c.unitGuessed; }))
      warnings.push("Units guessed as " + measureCols.map(function (c) { return c.unit; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join("/") + " from the numbers. Change the chart unit if that is wrong.");
    return {
      sizes: sizes,
      columns: measureCols.map(function (c) { return { key: c.key, header: c.header, unit: c.unit, flat: c.flat }; }),
      warnings: warnings,
      flatDetected: measureCols.some(function (c) { return c.flat && CIRCUMFERENCE[c.key]; })
    };
  }

  // Ease windows (cm) for garment-measurement charts: rules of thumb, not standards.
  var EASE = {
    chest: { snug: [2, 6], regular: [6, 12], relaxed: [12, 22] },
    waist: { snug: [0, 2], regular: [1, 5], relaxed: [4, 10] },
    hips: { snug: [2, 5], regular: [4, 9], relaxed: [8, 16] },
    thigh: { snug: [1, 4], regular: [3, 7], relaxed: [6, 12] },
    neck: { snug: [1, 2], regular: [1.5, 3], relaxed: [2.5, 4] },
    underbust: { snug: [0, 2], regular: [0, 4], relaxed: [2, 6] }
  };
  var STRETCH_SHIFT = 5; // stretch fabric: allow ~5 cm less ease (negative ease OK)

  var WEIGHTS = {
    top: { chest: 3, shoulder: 1.5, waist: 1, hips: 0.5, neck: 1, underbust: 2 },
    bottom: { waist: 3, hips: 3, thigh: 1, inseam: 0.5 },
    dress: { chest: 3, waist: 2.5, hips: 3, shoulder: 1 },
    auto: { chest: 3, waist: 2.5, hips: 2.5, shoulder: 1, thigh: 1, neck: 1, underbust: 2 }
  };

  /* evaluate(chart, me, opts)
     me: {chest, waist, hips, shoulder, thigh, neck, underbust, sleeve, inseam} in cm (numbers or empty)
     opts: { chartType: 'body'|'garment'|'flat', fit: 'snug'|'regular'|'relaxed', stretch: bool, category: 'top'|'bottom'|'dress'|'auto' } */
  function evaluate(chart, me, opts) {
    opts = opts || {};
    var type = opts.chartType || "body", fit = opts.fit || "regular", cat = opts.category || "auto";
    var w = WEIGHTS[cat] || WEIGHTS.auto;
    var keys = chart.columns.map(function (c) { return c.key; });
    var compared = keys.filter(function (k) { return me[k] > 0 && w[k]; });
    var info = keys.filter(function (k) { return me[k] > 0 && !w[k]; });
    var missingPrimary = Object.keys(w).filter(function (k) { return w[k] >= 2.5 && keys.indexOf(k) >= 0 && !(me[k] > 0); });

    var rows = chart.sizes.map(function (s, si) {
      var cells = {}, score = 0, tooSmall = false;
      keys.forEach(function (k) {
        var r = s.m[k]; if (!r || !(me[k] > 0)) return;
        var u = me[k], lo, hi, mode;
        if (type === "body" || !CIRCUMFERENCE[k]) {
          if (type !== "body" && !CIRCUMFERENCE[k]) {
            // Garment lengths (sleeve, inseam, shoulder, length): compare directly with tolerance.
            lo = r[0] - 1.5; hi = r[1] + 1.5; mode = "length";
          } else {
            lo = r[0]; hi = r[1]; mode = "body";
            if (lo === hi) { lo -= 1; hi += 1; } // single-number body charts: +/-1 cm tolerance
          }
          var d = u < lo ? lo - u : (u > hi ? -(u - hi) : 0); // d>0: garment bigger than you; d<0: smaller
          cells[k] = { status: d === 0 ? "fit" : (d > 0 ? "big" : "small"), by: Math.abs(d), mode: mode, chart: r };
        } else {
          var g = (type === "flat" ? 2 : 1) * (r[0] + r[1]) / 2;
          var win = (EASE[k] || EASE.chest)[fit].slice();
          if (opts.stretch) { win[0] -= STRETCH_SHIFT; win[1] -= STRETCH_SHIFT * 0.6; }
          var ease = g - u;
          var d2 = ease < win[0] ? -(win[0] - ease) : (ease > win[1] ? ease - win[1] : 0);
          cells[k] = { status: d2 === 0 ? "fit" : (d2 > 0 ? "big" : "small"), by: Math.abs(d2), mode: "ease", ease: ease, window: win, chart: [g, g] };
        }
        var c = cells[k];
        if (w[k]) {
          var pen = c.status === "small" ? c.by * 1.6 : c.by; // too small is worse: you can take in, not let out
          // tiny tie-break: prefer sizes where you sit near the middle of the range / ease window
          var lo2 = c.mode === "ease" ? c.window[0] : c.chart[0], hi2 = c.mode === "ease" ? c.window[1] : c.chart[1];
          var val = c.mode === "ease" ? c.ease : u;
          pen += 0.02 * Math.abs(val - (lo2 + hi2) / 2);
          score += pen * w[k];
          if (c.status === "small" && w[k] >= 2.5 && c.by > (opts.stretch ? 3 : 1.5)) tooSmall = true;
        }
      });
      return { index: si, label: s.label, alt: s.alt, cells: cells, score: score, tooSmallPrimary: tooSmall };
    });

    // Best size per measurement
    var perMeasure = {};
    compared.concat(info).forEach(function (k) {
      var best = null;
      rows.forEach(function (r) {
        var c = r.cells[k]; if (!c) return;
        var p = c.status === "small" ? c.by * 1.6 : c.by;
        if (!best || p < best.p - 1e-9) best = { p: p, label: r.label, index: r.index, status: c.status, by: c.by };
      });
      if (best) perMeasure[k] = best;
    });

    var ranked = rows.slice().filter(function (r) { return Object.keys(r.cells).length; }).sort(function (a, b) { return (a.tooSmallPrimary - b.tooSmallPrimary) || (a.score - b.score) || (b.index - a.index); });
    var rec = ranked[0] || null;
    var idxs = compared.filter(function (k) { return w[k] >= 2.5 && perMeasure[k]; }).map(function (k) { return perMeasure[k].index; });
    var spread = idxs.length ? Math.max.apply(null, idxs) - Math.min.apply(null, idxs) : 0;
    var confidence = "high", reasons = [];
    if (!compared.length) { confidence = "none"; reasons.push("Enter at least one measurement that this chart lists."); }
    else {
      if (missingPrimary.length) { confidence = "medium"; reasons.push("Add your " + missingPrimary.map(labelOf).join(" and ") + " for a firmer answer."); }
      if (spread === 1) { confidence = confidence === "high" ? "medium" : "low"; reasons.push("Your measurements point to neighbouring sizes."); }
      if (spread >= 2) { confidence = "low"; reasons.push("Your measurements are " + spread + " sizes apart on this chart. Expect tailoring, or look for a cut made for that shape."); }
      if (rec && rec.tooSmallPrimary) { confidence = "low"; reasons.push("Even the closest size is tight on a key measurement. Check if the brand has an extended range."); }
      if (rec && Object.keys(rec.cells).some(function (k) { return rec.cells[k].status === "big" && rec.cells[k].by > 6 && w[k] >= 2.5; }))
        reasons.push("Some measurements have a lot of extra room in this size.");
      if (chart.columns.some(function (c) { return c.unitGuessed; })) reasons.push("The chart unit was guessed.");
    }
    var runnerUp = ranked[1] && rec && Math.abs(ranked[1].index - rec.index) === 1 && ranked[1].score - rec.score < 2.5 ? ranked[1] : null;
    return { recommended: rec, runnerUp: runnerUp, rows: rows, perMeasure: perMeasure, confidence: confidence, reasons: reasons, compared: compared };
  }

  function labelOf(k) { for (var i = 0; i < MEASURES.length; i++) if (MEASURES[i].key === k) return MEASURES[i].label.toLowerCase(); return k; }

  var api = { parseChart: parseChart, evaluate: evaluate, parseValue: parseValue, classifyHeader: classifyHeader, labelOf: labelOf, MEASURES: MEASURES, EASE: EASE, CM_PER_IN: CM_PER_IN };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FitEngine = api;
})(this);
