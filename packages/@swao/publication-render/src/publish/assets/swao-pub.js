/**
 * SWAO Publication Engine -- Client-side JavaScript
 * Design 041 §7.5
 * No module imports. Works from file://.
 */
(function(w, d) {
  'use strict';

  // ── Internal helpers ──────────────────────────────────────────────────────

  var SEV_ORDER = {critical:0,high:1,medium:2,low:3,informational:4,positive:5};
  var RAG_ORDER = {fail:0,partial:1,pass:2,'not-assessed':3};
  var STATUS_ORDER = {open:0,in_progress:1,resolved:2,closed:3};

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function capitalise(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function stripHtml(s) {
    var v = (s || '').toString();
    var prev;
    do { prev = v; v = v.replace(/<[^>]+>/g, ''); } while (v !== prev);
    return v;
  }

  function substTemplate(tmpl, row) {
    // {{#if field}}...{{/if}} -- conditional block (omit when field is falsy or empty)
    // Loop until stable to handle nested {{#if}} blocks (#1297: non-greedy regex
    // matches innermost block first; each pass peels one nesting level)
    var r = tmpl || '';
    var prev;
    do {
      prev = r;
      r = r.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, function(_, f, content) {
        var val = row[f];
        return (val != null && val !== '' && val !== false) ? content : '';
      });
    } while (r !== prev);
    // {{{field}}} -- raw HTML (no escaping; caller must pre-escape user data)
    r = r.replace(/\{\{\{(\w+)\}\}\}/g, function(_, f) {
      return row[f] != null ? String(row[f]) : '';
    });
    // {{field}} -- HTML-escaped value
    return r.replace(/\{\{(\w+)\}\}/g, function(_, f) {
      return esc(row[f] != null ? row[f] : '');
    });
  }

  // ── Built-in renderers ────────────────────────────────────────────────────

  function spanC(cls, content) { return '<span class="' + cls + '">' + content + '</span>'; }

  var BUILT_IN_RENDERERS = {
    'severity-badge': function(val) { var v = (val||'').toLowerCase(); return spanC('badge badge-' + v, esc(capitalise(v))); },
    'rag-status': function(val) { var v = (val||'').toLowerCase(); return spanC('rag rag-' + v, esc(capitalise(v))); },
    'status-chip': function(val) {
      var v = (val||'').toLowerCase();
      var lbl = ({open:'Open',in_progress:'In Progress',resolved:'Resolved',closed:'Closed'})[v] || capitalise(v);
      return spanC('status-chip status-' + v, esc(lbl));
    },
    'outcome-icon': function(val) {
      var v = (val||'').toLowerCase();
      var icons = {positive:'✓ Positive',negative:'✗ Negative',informational:'ℹ Info'};
      return icons[v] ? '<span>' + esc(icons[v]) + '</span>' : esc(val);
    },
    'migration-phase': function(val) { return spanC('phase-chip phase-' + slugify(val||''), esc(val||'')); },
    'tag-chips': function(val) {
      if (!val) return '';
      return (val+'').split(',').map(function(t) {
        var tag = t.trim();
        return tag ? spanC('badge badge-tag', esc(tag)) : '';
      }).filter(Boolean).join(' ');
    },
    'effort-size': function(val) { return spanC('badge badge-neutral', esc(val)); },
    'delta-trend': function(val) {
      var n = parseFloat(val);
      if (!isNaN(n) && n > 0) return '<span style="color:green">+' + esc(val) + '</span>';
      if (!isNaN(n) && n < 0) return '<span style="color:red">' + esc(val) + '</span>';
      return '<span>' + esc(val) + '</span>';
    },
    // #1296: signal ID cell with hover tooltip (uses row.severity/outcome/full_derivation)
    'signal-id-cell': function(val, row) {
      if (!val) return '';
      var id = esc(val);
      var sev = esc((row && row.severity) || '');
      var out = esc((row && row.outcome) || '');
      var deriv = esc(((row && row.full_derivation) || '').slice(0, 120));
      return '<span data-signal-id="' + id + '" data-signal-severity="' + sev +
        '" data-signal-outcome="' + out + '" data-signal-derivation="' + deriv +
        '" class="inline-ref inline-ref-signal inline-ref-active pub-pointer"' +
        ' onclick="event.stopPropagation();window.swaoNavigateToSignal&&window.swaoNavigateToSignal(\'' + id + '\');">' +
        id + '</span>';
    },
    // Landing-zone verdict chip (used in lzr-catalog-findings sortable table).
    // #1589: row.sovereignty_active (added by renderLzrCatalogFindings) switches
    // SUPPORTED label from "Sovereign" to "Available" when no sovereignty gate was active.
    'lz-verdict': function(val, row) {
      var sovereigntyActive = !row || row.sovereignty_active !== false;
      var verdictMap = {
        'SOVEREIGNTY_GAP':          {l:'Sov. Gap',      r:'fail'},
        'SOVEREIGNTY_BLOCKED':      {l:'Sov. Blocked',  r:'fail'},
        'NOT_AVAILABLE_IN_REGION':  {l:'Unavailable',   r:'fail'},
        'AVAILABILITY_NOT_ENABLED': {l:'Not Enabled',   r:'partial'},
        'VERSION_MISMATCH':         {l:'Ver. Mismatch', r:'partial'},
        'CAPABILITY_MISSING':       {l:'Cap. Missing',  r:'partial'},
        'SUPPORTED':                {l: sovereigntyActive ? 'Sovereign' : 'Available', r:'pass'}
      };
      var m = verdictMap[val] || {l: esc(val||'Unknown'), r:'fail'};
      return spanC('rag rag-' + m.r + ' pub-text-xs-nowrap', m.l);
    }
  };

  // ── Core: initSwaoTable ───────────────────────────────────────────────────

  w.initSwaoTable = function(config) {
    var container = d.getElementById(config.id + '-container');
    if (!container) return;

    // Resolve column defaults
    var columns = (config.columns || []).map(function(col) {
      return {
        id: col.id,
        label: col.label,
        field: col.field,
        type: col.type || 'text',
        sortable: col.sortable !== false,
        filterable: col.filterable || false,
        filterType: col.filterType || 'chips',
        filterValues: col.filterValues || [],
        render: col.render || null,
        exportable: col.exportable !== false,
        piiField: col.piiField || false,
        width: col.width || null,
        align: col.align || 'left',
        visible: true
      };
    });

    var pagination = config.pagination || null;
    var pageSize = pagination ? (pagination.pageSize || 20) : 0;
    var pageSizeOptions = pagination ? (pagination.pageSizeOptions || [10, 20, 50, 'All']) : [];

    var state = {
      sortField: config.defaultSort && config.defaultSort[0] ? config.defaultSort[0].field : null,
      sortDir: config.defaultSort && config.defaultSort[0] ? config.defaultSort[0].dir : 'asc',
      filters: config.defaultFilter ? JSON.parse(JSON.stringify(config.defaultFilter)) : {},
      search: '',
      rows: (config.rows || []).map(function(r, i) { return Object.assign({ _idx: i }, r); }),
      page: 1,
      pageSize: pageSize
    };

    // Load persisted column visibility
    var colsKey = 'swao-cols-' + config.id;
    var densityKey = 'swao-density-' + config.id;
    try {
      var storedCols = localStorage.getItem(colsKey);
      if (storedCols) {
        var vis = JSON.parse(storedCols);
        columns.forEach(function(col) {
          if (col.id in vis) col.visible = vis[col.id];
        });
      }
    } catch (_) {}

    var currentDensity = config.density || 'normal';
    try {
      var storedDensity = localStorage.getItem(densityKey);
      if (storedDensity) currentDensity = storedDensity;
    } catch (_) {}

    function ord(map, v) { return map[v] != null ? map[v] : 99; }
    function compareVal(a, b, field) {
      var av = (a[field] != null ? a[field] : '').toString().toLowerCase();
      var bv = (b[field] != null ? b[field] : '').toString().toLowerCase();
      var orderMap = field === 'severity' ? SEV_ORDER : field === 'status' ? STATUS_ORDER : field === 'rag_status' ? RAG_ORDER : null;
      if (orderMap) return ord(orderMap, av) - ord(orderMap, bv);
      var na = parseFloat(av), nb = parseFloat(bv);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return av.localeCompare(bv);
    }

    function getSortedFiltered() {
      var rows = state.rows.slice();

      // Apply chip/value filters
      var filterKeys = Object.keys(state.filters);
      for (var fi = 0; fi < filterKeys.length; fi++) {
        var key = filterKeys[fi];
        var active = state.filters[key];
        if (!active || active.length === 0) continue;
        rows = rows.filter(function(r) {
          var val = (r[key] != null ? r[key] : '').toString().toLowerCase();
          return active.some(function(f) { return f.toLowerCase() === val; });
        });
      }

      // Apply text search
      if (state.search) {
        var q = state.search.toLowerCase();
        rows = rows.filter(function(r) {
          return columns.some(function(col) {
            var val = (r[col.field] != null ? r[col.field] : '').toString().toLowerCase();
            return val.indexOf(q) !== -1;
          });
        });
      }

      // Sort
      if (state.sortField) {
        var sf = state.sortField;
        var sd = state.sortDir;
        rows.sort(function(a, b) {
          var cmp = compareVal(a, b, sf);
          return sd === 'asc' ? cmp : -cmp;
        });
      }

      return rows;
    }

    function getVisibleColumns() {
      return columns.filter(function(c) { return c.visible; });
    }

    function renderCell(col, row) {
      var val = row[col.field];
      if (col.render && BUILT_IN_RENDERERS[col.render]) {
        return BUILT_IN_RENDERERS[col.render](val, row);
      }
      if (col.type === 'html') return val != null ? val.toString() : '';
      return esc(val);
    }

    function buildGroupedRows(rows) {
      if (!config.groupBy) return rows;
      var gm = {}, go = [];
      rows.forEach(function(r) {
        var v = (r[config.groupBy] != null ? r[config.groupBy] : '').toString();
        if (!gm[v]) { gm[v] = []; go.push(v); } gm[v].push(r);
      });
      var out = [];
      go.forEach(function(v) { out.push({ _isGroupHeader: 1, _groupLabel: v }); gm[v].forEach(function(r) { out.push(r); }); });
      return out;
    }

    function render() {
      var allRows = getSortedFiltered();
      var totalFiltered = allRows.length;

      // Pagination slice
      var pagedRows;
      if (state.pageSize > 0) {
        var start = (state.page - 1) * state.pageSize;
        pagedRows = allRows.slice(start, start + state.pageSize);
      } else {
        pagedRows = allRows;
      }

      var visibleCols = getVisibleColumns();
      var colSpan = visibleCols.length + (config.expandTemplate ? 1 : 0);

      var countEl = d.getElementById(config.id + '-count');
      if (countEl) {
        if (state.pageSize > 0) {
          var from = totalFiltered === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
          var to = Math.min(state.page * state.pageSize, totalFiltered);
          countEl.textContent = from + '-' + to + ' of ' + totalFiltered + ' rows';
        } else {
          countEl.textContent = totalFiltered + ' of ' + state.rows.length + ' rows';
        }
      }

      var tbody = d.getElementById(config.id + '-tbody');
      if (!tbody) return;

      // Build tbody HTML in one pass then assign
      var rows_html = [];
      var grouped = buildGroupedRows(pagedRows);
      grouped.forEach(function(item) {
        if (item._isGroupHeader) {
          rows_html.push('<tr class="swao-group-header"><td colspan="' + colSpan + '">' + esc(item._groupLabel) + '</td></tr>');
          return;
        }
        var row = item;
        var autoExp = row._autoExpand ? ' aria-expanded="true" style="transform:rotate(90deg)"' : ' aria-expanded="false"';
        var cells = config.expandTemplate ? '<td class="expand-cell"><button class="expand-btn" aria-label="Expand row details"' + autoExp + '>›</button></td>' : '';
        visibleCols.forEach(function(col) {
          var align = col.align !== 'left' ? ' style="text-align:' + col.align + '"' : '';
          cells += '<td data-col-id="' + esc(col.id) + '"' + align + '>' + renderCell(col, row) + '</td>';
        });
        // Add id attribute for deep linking (#signal-INV-01, #control-GDPR_Art_5_1_a, etc.)
        var rowAnchor = '';
        if (config.rowIdField && row[config.rowIdField]) {
          var prefix = config.rowIdPrefix || '';
          rowAnchor = ' id="' + esc(prefix + row[config.rowIdField]) + '"';
        }
        rows_html.push('<tr class="swao-row"' + rowAnchor + ' data-row-idx="' + row._idx + '">' + cells + '</tr>');
        if (config.expandTemplate) {
          var detailDisplay = row._autoExpand ? '' : 'display:none';
          var detailHide = row._autoExpand ? '' : ' hidden';
          rows_html.push('<tr class="row-detail"' + detailHide + ' style="' + detailDisplay + '"><td colspan="' + colSpan + '">' + substTemplate(config.expandTemplate, row) + '</td></tr>');
        }
      });
      tbody.innerHTML = rows_html.join('');

      updateFilterChipStates();
      updateSortHeaders();
      updatePaginationControls(totalFiltered);
    }

    function updateFilterChipStates() {
      container.querySelectorAll('.filter-chip[data-filter-key]').forEach(function(c) {
        var on = !!(state.filters[c.getAttribute('data-filter-key')] || []).includes(c.getAttribute('data-filter-val'));
        c.classList.toggle('active', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function updateSortHeaders() {
      container.querySelectorAll('th.sortable[data-sort-field]').forEach(function(th) {
        th.setAttribute('aria-sort', th.getAttribute('data-sort-field') === state.sortField ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      });
    }

    function updatePaginationControls(total) {
      if (!state.pageSize) return;
      var tp = Math.ceil(total / state.pageSize) || 1;
      var pb = d.getElementById(config.id + '-pg-prev'), nb = d.getElementById(config.id + '-pg-next');
      if (pb) pb.disabled = state.page <= 1;
      if (nb) nb.disabled = state.page >= tp;
    }

    function buildColsPickerDropdown() {
      // min-width sized to the longest German column label (e.g. "Spätester Zieldatum")
      var h = '<div class="cols-picker-dropdown" id="' + config.id + '-cols-dropdown" style="display:none;position:absolute;right:0;z-index:100;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:8px 12px;box-shadow:var(--shadow-md);min-width:220px;white-space:nowrap;">';
      columns.forEach(function(c) {
        h += '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;"><input type="checkbox" class="col-vis-cb" data-col-id="' + esc(c.id) + '"' + (c.visible ? ' checked' : '') + '> ' + esc(c.label) + '</label>';
      });
      return h + '</div>';
    }

    function buildHTML() {
      var vc = getVisibleColumns(), id = config.id, h = '';

      // Controls bar
      h += '<div class="swao-table-controls">';
      if (config.searchable !== false) {
        h += '<input class="swao-table-controls__search" type="search" placeholder="Search…" id="' + id + '-search">';
      }
      columns.forEach(function(col) {
        if (!col.filterable || col.filterType !== 'chips' || !col.filterValues.length) return;
        var hdrI18n = col.labelI18nKey ? ' data-i18n-key="' + esc(col.labelI18nKey) + '"' : '';
        h += '<span class="filter-group"><span' + hdrI18n + '>' + esc(col.label) + ':</span>';
        col.filterValues.forEach(function(fv) {
          var lbl = typeof fv === 'object' ? fv.label : fv, val = typeof fv === 'object' ? fv.val : fv;
          var chipI18n = col.filterValueI18nPrefix ? ' data-i18n-key="' + esc(col.filterValueI18nPrefix + '.' + val) + '"' : '';
          h += '<button class="filter-chip" data-filter-key="' + esc(col.field) + '" data-filter-val="' + esc(val) + '" aria-pressed="false"' + chipI18n + '>' + esc(lbl) + '</button>';
        });
        h += '</span>';
      });
      if (config.exportCsv !== false) h += '<button class="btn-export" id="' + id + '-export">Export CSV</button>';
      h += '<button class="btn-density">Density</button>';
      h += '<div style="position:relative;display:inline-block"><button class="btn-cols-picker" aria-label="Column visibility">⚙</button>' + buildColsPickerDropdown() + '</div>';
      h += '</div>';

      // Meta row
      h += '<div class="swao-table-meta"><span id="' + id + '-count" aria-live="polite"></span>';
      if (pagination) {
        h += '<button id="' + id + '-pg-prev">&lsaquo;</button><button id="' + id + '-pg-next">&rsaquo;</button>';
        h += '<select id="' + id + '-pg-size">';
        pageSizeOptions.forEach(function(o) {
          var v = o === 'All' ? '0' : o, s = (v == state.pageSize) ? ' selected' : '';
          h += '<option value="' + v + '"' + s + '>' + o + '</option>';
        });
        h += '</select>';
      }
      h += '</div>';

      // Table
      h += '<div class="swao-table-outer"><table class="swao-table" id="' + id + '" data-density="' + esc(currentDensity) + '"><thead><tr>';
      if (config.expandTemplate) { h += '<th style="width:36px"></th>'; }
      vc.forEach(function(col) {
        h += '<th data-col-id="' + esc(col.id) + '"';
        if (col.width) h += ' style="width:' + esc(col.width) + '"';
        if (col.sortable) h += ' class="sortable" data-sort-field="' + esc(col.field) + '" tabindex="0" aria-sort="none"';
        h += '>' + esc(col.label) + '</th>';
      });
      h += '</tr></thead><tbody id="' + id + '-tbody"></tbody></table></div>';
      container.innerHTML = h;
    }

    function rebuildTable() {
      buildHTML();
      // Do not re-wire events: delegated handlers on container still work
      render();
    }

    function wireEvents() {
      // Search (delegated via input event on container)
      container.addEventListener('input', function(e) {
        if (e.target && e.target.classList.contains('swao-table-controls__search')) {
          state.search = e.target.value;
          state.page = 1;
          render();
        }
      });

      // All delegated click handlers on container (chips, sort, expand)
      container.addEventListener('click', function(e) {
        // Filter chips
        var chip = e.target.closest('.filter-chip[data-filter-key]');
        if (chip) {
          var key = chip.getAttribute('data-filter-key');
          var val = chip.getAttribute('data-filter-val');
          if (!state.filters[key]) state.filters[key] = [];
          var idx = state.filters[key].indexOf(val);
          if (idx === -1) { state.filters[key].push(val); } else { state.filters[key].splice(idx, 1); }
          state.page = 1; render();
          if (config.urlHash !== false) updateUrlHash(config.id, state.filters);
          return;
        }
        // Sort headers
        var th = e.target.closest('th.sortable[data-sort-field]');
        if (th) {
          var field = th.getAttribute('data-sort-field');
          if (state.sortField === field) { state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; }
          else { state.sortField = field; state.sortDir = 'asc'; }
          state.page = 1; render(); return;
        }
        // Expand buttons
        if (config.expandTemplate) {
          var btn = e.target.closest('.expand-btn');
          if (btn) {
            var expanded = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
            btn.style.transform = expanded ? '' : 'rotate(90deg)';
            var detailTr = btn.closest('tr').nextElementSibling;
            if (detailTr && detailTr.classList.contains('row-detail')) {
              if (expanded) { detailTr.style.display = 'none'; detailTr.setAttribute('hidden', ''); }
              else {
                detailTr.style.display = ''; detailTr.removeAttribute('hidden');
                // Post-process signal cross-reference spans into clickable links
                detailTr.querySelectorAll('[data-signal-xref]').forEach(function(span) {
                  var sigId = span.getAttribute('data-signal-xref');
                  if (sigId) {
                    span.innerHTML = '<a href="#signal-' + esc(sigId) + '" data-signal-id="' + esc(sigId) + '" title="Signal: ' + esc(sigId) + '" style="color:var(--brand-accent);text-decoration:underline;cursor:pointer;" onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal(\'' + esc(sigId) + '\');return false;">View ' + esc(sigId) + '</a>';
                  } else {
                    span.innerHTML = '<span style="color:var(--text-secondary);font-style:italic;">none</span>';
                  }
                });
              }
            }
          }
        }
      });
      container.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          var th = e.target.closest('th.sortable[data-sort-field]');
          if (th) { e.preventDefault(); th.click(); }
        }
      });

      // CSV Export (delegated)
      container.addEventListener('click', function(e) {
        if (e.target && e.target.classList.contains('btn-export')) {
          var visible = getSortedFiltered();
          var exportCols = columns.filter(function(c) { return c.exportable && !c.piiField; });
          var headers = exportCols.map(function(c) { return '"' + c.label.replace(/"/g, '""') + '"'; }).join(',');
          var rowsCsv = visible.map(function(row) {
            return exportCols.map(function(col) {
              var val = stripHtml((row[col.field] != null ? row[col.field] : '').toString());
              return '"' + val.replace(/"/g, '""') + '"';
            }).join(',');
          });
          var csv = [headers].concat(rowsCsv).join('\n');
          try {
            // UTF-8 BOM (﻿) ensures Excel opens German/special chars correctly
            var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
            var url = URL.createObjectURL(blob);
            var a = d.createElement('a');
            a.href = url; a.download = config.id + '-export.csv'; a.click();
            URL.revokeObjectURL(url);
          } catch (_) { console.log('CSV Export:\n' + csv); }
        }
        // Cols picker toggle
        if (e.target && e.target.classList.contains('btn-cols-picker')) {
          e.stopPropagation();
          var dd = container.querySelector('.cols-picker-dropdown');
          if (dd) dd.style.display = dd.style.display === 'none' ? '' : 'none';
        }
        // Density toggle
        if (e.target && e.target.classList.contains('btn-density')) {
          var cyc = { compact: 'normal', normal: 'comfortable', comfortable: 'compact' };
          currentDensity = cyc[currentDensity] || 'normal';
          try { localStorage.setItem(densityKey, currentDensity); } catch (_) {}
          var tbl = d.getElementById(config.id);
          if (tbl) tbl.setAttribute('data-density', currentDensity);
        }
        // Pagination prev/next
        if (pagination) {
          if (e.target && e.target.id === config.id + '-pg-prev' && state.page > 1) { state.page--; render(); }
          if (e.target && e.target.id === config.id + '-pg-next') {
            var total = getSortedFiltered().length;
            var totalPages = state.pageSize > 0 ? Math.ceil(total / state.pageSize) : 1;
            if (state.page < totalPages) { state.page++; render(); }
          }
        }
      });
      // Col visibility change
      container.addEventListener('change', function(e) {
        var cb = e.target.closest('.col-vis-cb');
        if (cb) {
          var colId = cb.getAttribute('data-col-id');
          var col = columns.find(function(c) { return c.id === colId; });
          if (!col) return;
          col.visible = cb.checked;
          var vis = {}; columns.forEach(function(c) { vis[c.id] = c.visible; });
          try { localStorage.setItem(colsKey, JSON.stringify(vis)); } catch (_) {}
          rebuildTable(); return;
        }
        // Page size change
        if (pagination && e.target && e.target.id === config.id + '-pg-size') {
          state.pageSize = parseInt(e.target.value, 10) || 0; state.page = 1; render();
        }
      });
      // Close cols picker on outside click
      d.addEventListener('click', function(e) {
        var dd = container.querySelector('.cols-picker-dropdown');
        var btn = container.querySelector('.btn-cols-picker');
        if (dd && btn && !btn.contains(e.target) && !dd.contains(e.target)) {
          dd.style.display = 'none';
        }
      });
    }

    // Load filter from URL hash
    if (config.urlHash !== false) {
      var hashParam = getHashParam(config.id + '-filter');
      if (hashParam) {
        try {
          var parsed = JSON.parse(decodeURIComponent(hashParam));
          Object.assign(state.filters, parsed);
        } catch (_) {}
      }
    }

    buildHTML();
    wireEvents();
    render();
  };

  // ── URL hash helpers ──────────────────────────────────────────────────────

  function updateUrlHash(tableId, filters) {
    var active = {}, pk = tableId + '-filter';
    Object.keys(filters).forEach(function(k) { if (filters[k] && filters[k].length) active[k] = filters[k]; });
    try {
      var parts = (location.hash.replace('#', '') || '').split('&').filter(function(p) { return p && p.indexOf(pk + '=') !== 0; });
      if (Object.keys(active).length) parts.push(pk + '=' + encodeURIComponent(JSON.stringify(active)));
      history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
    } catch (_) {}
  }

  function getHashParam(key) {
    try {
      var parts = location.hash.replace('#', '').split('&');
      for (var i = 0; i < parts.length; i++) {
        var eq = parts[i].indexOf('=');
        if (eq > -1 && parts[i].slice(0, eq) === key) return parts[i].slice(eq + 1);
      }
    } catch (_) {}
    return null;
  }

  // ── Shared utilities ──────────────────────────────────────────────────────

  function escapeHtmlGlobal(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = d.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
    d.body.appendChild(ta); ta.select();
    try { d.execCommand('copy'); } catch (_) {}
    d.body.removeChild(ta);
  }

  function showCopyTooltip(anchor, msg) {
    var t = d.getElementById('swao-copy-tooltip');
    if (!t) { t = d.createElement('div'); t.id = 'swao-copy-tooltip'; t.className = 'copy-tooltip'; d.body.appendChild(t); }
    var r = anchor.getBoundingClientRect();
    t.style.top = (r.top - 36 + w.scrollY) + 'px'; t.style.left = r.left + 'px';
    t.textContent = msg; t.classList.add('visible');
    clearTimeout(t._ht); t._ht = setTimeout(function() { t.classList.remove('visible'); }, 2000);
  }

  function initCopyLinks() {
    d.addEventListener('click', function(e) {
      var btn = e.target.closest('.copy-link[data-target-id]');
      if (!btn) return;
      copyToClipboard(location.href.split('#')[0] + '#' + btn.getAttribute('data-target-id'));
      showCopyTooltip(btn, 'Copied!');
    });
  }

  function initDeepLinkAnchors() {
    d.querySelectorAll('h2[id], h3[id], h4[id]').forEach(function(h) {
      var a = d.createElement('a');
      a.className = 'anchor-link'; a.href = '#' + h.id; a.textContent = '#';
      a.addEventListener('click', function(e) {
        e.preventDefault();
        copyToClipboard(location.href.split('#')[0] + '#' + h.id);
        showCopyTooltip(a, 'Copied!');
      });
      h.appendChild(a);
    });
  }

  function initGlossaryPopovers() {
    var dlg = d.getElementById('swao-glossary-dialog');
    if (!dlg) {
      dlg = d.createElement('div'); dlg.id = 'swao-glossary-dialog';
      dlg.className = 'glossary-popover'; dlg.style.cssText = 'position:fixed;display:none;pointer-events:none;';
      d.body.appendChild(dlg);
    }
    var hideTimer;
    function showPopover(term) {
      clearTimeout(hideTimer);
      dlg.innerHTML = '<b>' + escapeHtmlGlobal(term.textContent) + '</b><br><span style="color:var(--text-secondary);font-size:0.8rem;">' + escapeHtmlGlobal(term.getAttribute('data-def')) + '</span>';
      var r = term.getBoundingClientRect();
      var top = r.bottom + 8;
      var left = Math.min(r.left, w.innerWidth - 340);
      if (top + 120 > w.innerHeight) top = r.top - 130;
      dlg.style.cssText = 'position:fixed;display:block;pointer-events:none;top:' + top + 'px;left:' + left + 'px;';
    }
    // Show on hover (mouseenter on document, delegated)
    d.addEventListener('mouseover', function(e) {
      var term = e.target.closest ? e.target.closest('abbr.swao-term[data-def]') : null;
      if (term) { showPopover(term); return; }
      hideTimer = setTimeout(function() { dlg.style.display = 'none'; }, 200);
    });
    d.addEventListener('keydown', function(e) { if (e.key === 'Escape') dlg.style.display = 'none'; });
  }

  function initDarkModeToggle() {
    var btn = d.getElementById('dark-mode-toggle');
    if (!btn) return;
    function applyTheme(t) { d.documentElement.setAttribute('data-theme', t); btn.textContent = t === 'dark' ? 'Light' : 'Dark'; btn.title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'; }
    try { var s = localStorage.getItem('swao-theme'); if (s) applyTheme(s); } catch (_) {}
    btn.addEventListener('click', function() {
      var next = d.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next); try { localStorage.setItem('swao-theme', next); } catch (_) {}
    });
  }

  function initPrintHelper() {
    var exp = [];
    w.addEventListener('beforeprint', function() {
      exp = [];
      d.querySelectorAll('details').forEach(function(x) { if (!x.open) { exp.push(x); x.open = true; } });
      d.querySelectorAll('.row-detail').forEach(function(r) { r.style.display = ''; r.removeAttribute('hidden'); });
    });
    w.addEventListener('afterprint', function() {
      exp.forEach(function(x) { x.open = false; }); exp = [];
      d.querySelectorAll('.row-detail').forEach(function(r) {
        if (!r.previousElementSibling || !r.previousElementSibling.querySelector('.expand-btn[aria-expanded="true"]')) {
          r.style.display = 'none'; r.setAttribute('hidden', '');
        }
      });
    });
  }

  // ── i18n language switcher (#0435) ────────────────────────────────────────

  function applyI18n(lang) {
    var el = d.getElementById('swao-i18n');
    if (!el) return;
    try {
      var bundle = JSON.parse(el.textContent || '{}');
      var labels = bundle[lang] || {};
      // Flatten nested object to dot-notation keys
      var flat = {};
      function flatten(obj, prefix) {
        Object.keys(obj).forEach(function(k) {
          var key = prefix ? prefix + '.' + k : k;
          if (obj[k] && typeof obj[k] === 'object') flatten(obj[k], key);
          else flat[key] = String(obj[k]);
        });
      }
      flatten(labels, '');
      // Apply to all data-i18n-key elements; substitute {count} from data-i18n-count
      d.querySelectorAll('[data-i18n-key]').forEach(function(el2) {
        var key = el2.getAttribute('data-i18n-key');
        if (!flat[key]) return;
        var val = flat[key];
        var cnt = el2.getAttribute('data-i18n-count');
        if (cnt !== null) val = val.replace(/\{count\}/g, cnt);
        el2.textContent = val;
      });
      d.documentElement.setAttribute('lang', lang);
      d.documentElement.setAttribute('data-lang', lang);
      // Rebuild sidebar nav labels after i18n so section names update.
      // Use data-i18n-key on H2 (resolved via flat bundle) to get clean translated label;
      // fall back to stripping the '#' appended by initDeepLinkAnchors from textContent.
      var sidebarNav = d.getElementById('swao-sidebar-nav');
      if (sidebarNav) {
        var main2 = d.getElementById('main-content');
        if (main2) {
          var html2 = '';
          main2.querySelectorAll('section[id]').forEach(function(sec) {
            var id = sec.getAttribute('id');
            if (!id) return;
            if (sec.getAttribute('data-sidebar-exclude') === 'true') return;
            var h2 = sec.querySelector('h2');
            var label = id;
            if (h2) {
              var key2 = h2.getAttribute('data-i18n-key');
              if (key2 && flat[key2]) {
                label = flat[key2]; // prefer translated i18n string (no # appended)
              } else {
                // Strip trailing '#' appended by initDeepLinkAnchors
                label = (h2.textContent || '').replace(/\s*#\s*$/, '').trim() || id;
              }
            }
            html2 += '<li><a href="#' + esc(id) + '">' + esc(label) + '</a></li>';
          });
          sidebarNav.innerHTML = html2;
        }
      }
      // Update switcher button states
      d.querySelectorAll('.swao-lang-btn[data-lang]').forEach(function(btn) {
        btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === lang ? 'true' : 'false');
      });
    } catch (_) {}
  }

  function initLangSwitcher() {
    // Support both legacy buttons (.swao-lang-btn) and new <select id="lang-select">
    d.querySelectorAll('.swao-lang-btn[data-lang]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var lang = btn.getAttribute('data-lang');
        applyI18n(lang);
        try { localStorage.setItem('swao-lang', lang); } catch (_) {}
        // Sync select if present
        var sel = d.getElementById('lang-select');
        if (sel) sel.value = lang;
      });
    });
    var langSelect = d.getElementById('lang-select');
    if (langSelect) {
      langSelect.addEventListener('change', function() {
        applyI18n(langSelect.value);
        try { localStorage.setItem('swao-lang', langSelect.value); } catch (_) {}
      });
    }
    // Restore saved language
    try {
      var saved = localStorage.getItem('swao-lang');
      if (saved) {
        applyI18n(saved);
        if (langSelect) langSelect.value = saved;
      }
    } catch (_) {}
  }

  // ── Hash navigation (#0434) ────────────────────────────────────────────────

  function initHashNavigation() {
    function handleHash() {
      var hash = location.hash.replace('#', '');
      if (!hash) return;

      // #filter=GDPR,high -- pre-filter signal table
      if (hash.startsWith('filter=')) {
        var tags = hash.slice(7).split(',').filter(Boolean);
        // Set filter on initSwaoTable instances via stored state (available as global)
        // Tags are comma-separated; trigger click on matching filter chips
        setTimeout(function() {
          tags.forEach(function(tag) {
            var chip = d.querySelector('.filter-chip[data-filter-val="' + tag + '"]');
            if (chip) chip.click();
          });
        }, 300);
        return;
      }

      // #signal-INV-05 -- navigate to signals section and filter to that signal
      if (/^signal-[A-Z]/.test(hash)) {
        var sigId = hash.replace(/^signal-/, '');
        if (w.swaoNavigateToSignal) { w.swaoNavigateToSignal(sigId); return; }
      }

      // #compliance?regime=GDPR&control=Art.5 -- filter compliance table and scroll to control
      if (hash.startsWith('compliance?')) {
        var compParams = {};
        hash.slice(11).split('&').forEach(function(p) { var kv = p.split('='); if (kv[0]) compParams[kv[0]] = decodeURIComponent(kv[1] || ''); });
        var regime = compParams['regime'], ctrlId = compParams['control'];
        if (regime && w.swaoFilterByFramework) { w.swaoFilterByFramework(regime); }
        if (ctrlId) { setTimeout(function() { var el = d.getElementById('ctrl-' + ctrlId.toLowerCase().replace(/[^a-z0-9]+/g, '-')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 600); }
        return;
      }

      // #history?run=RUN-ID&id=SIGNAL-ID -- navigate to resolved signal in run history
      if (hash.startsWith('history?')) {
        var histParams = {};
        hash.slice(8).split('&').forEach(function(p) { var kv = p.split('='); if (kv[0]) histParams[kv[0]] = decodeURIComponent(kv[1] || ''); });
        var runId = histParams['run'], hSigId = histParams['id'];
        if (w.swaoNavigateToResolvedSignal) { w.swaoNavigateToResolvedSignal(hSigId || '', runId || ''); return; }
      }

      // other anchor -- scroll and expand
      var el = d.getElementById(hash);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Expand enclosing <details> if collapsed
      var details = el.closest('details');
      if (details && !details.open) details.open = true;
      // Expand row-detail if this is a signal row
      var expandBtn = el.querySelector('.expand-btn[aria-expanded="false"]');
      if (expandBtn) expandBtn.click();
    }

    // Run on load and on hash change
    if (d.readyState === 'loading') {
      d.addEventListener('DOMContentLoaded', handleHash);
    } else {
      setTimeout(handleHash, 100);
    }
    w.addEventListener('hashchange', handleHash);
  }

  // ── Scroll utilities (shared by sidebar, top nav, search) ─────────────────

  function fixedOverlayHeight() {
    var band = d.querySelector('.band-top');
    var header = d.querySelector('.site-header');
    var breadcrumb = d.querySelector('.breadcrumb-bar');
    return (band ? band.offsetHeight : 28)
         + (header ? header.offsetHeight : 56)
         + (breadcrumb ? breadcrumb.offsetHeight : 36)
         + 12;
  }

  function scrollToSection(id) {
    var el = d.getElementById(id);
    if (!el) return;
    var targetY = el.getBoundingClientRect().top + w.scrollY - fixedOverlayHeight();
    w.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
  }

  // Expose for inline onclick use
  w.swaoScrollTo = scrollToSection;

  // Navigate to a specific signal: filter the Signals table to show only that signal,
  // then scroll to and highlight the row. URL hash is also set for bookmarking.
  w.swaoNavigateToSignal = function(signalId) {
    scrollToSection('signal-list');
    setTimeout(function() {
      // Step 1: filter the table so only this signal is visible
      var search = d.querySelector('#signals-search');
      if (search) {
        search.value = signalId;
        search.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      }
      // Step 2: after filter debounce (50ms), scroll to and highlight the row
      setTimeout(function() {
        var anchor = d.getElementById('signal-' + signalId);
        if (anchor) {
          try { location.hash = 'signal-' + signalId; } catch(e) {}
          anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Expand the row detail
          var tr = anchor.closest ? anchor.closest('tr.swao-row') : null;
          if (tr) {
            var btn = tr.querySelector('.expand-btn[aria-expanded="false"]');
            if (btn) btn.click();
          }
          // Brief highlight
          anchor.style.outline = '2px solid var(--brand-accent)';
          anchor.style.outlineOffset = '-2px';
          setTimeout(function() { anchor.style.outline = ''; anchor.style.outlineOffset = ''; }, 2000);
        }
      }, 100);
    }, 350);
  };

  // Highlight multiple signals at once in the signal list (option B multi-signal UX).
  // idsStr: comma-separated signal IDs e.g. "INV-01,SYNTH-03"
  w.swaoHighlightSignals = function(idsStr) {
    var ids = (idsStr || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    if (!ids.length) return;
    // Clear search so all rows are visible.
    var search = d.querySelector('#signals-search');
    if (search && search.value) {
      search.value = '';
      search.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }
    scrollToSection('signal-list');
    setTimeout(function() {
      var firstAnchor = null;
      ids.forEach(function(id) {
        var anchor = d.getElementById('signal-' + id);
        if (!anchor) return;
        var row = anchor.closest ? anchor.closest('tr.swao-row') : null;
        if (!firstAnchor) firstAnchor = anchor;
        if (row) {
          row.style.outline = '2px solid var(--brand-accent)';
          row.style.outlineOffset = '-2px';
          var btn = row.querySelector('.expand-btn[aria-expanded="false"]');
          if (btn) btn.click();
          setTimeout(function() { row.style.outline = ''; row.style.outlineOffset = ''; }, 3000);
        }
      });
      if (firstAnchor) {
        firstAnchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try { location.hash = 'signal-' + ids[0]; } catch(e) {}
      }
    }, 400);
  };

  // Filter compliance table by framework when tile is clicked.
  w.swaoFilterByFramework = function(fwId) {
    scrollToSection('compliance-regime');
    setTimeout(function() {
      var container = d.getElementById('compliance-regime');
      var chip = container
        ? container.querySelector('.filter-chip[data-filter-key=framework][data-filter-val="' + fwId + '"]')
        : d.querySelector('.filter-chip[data-filter-key=framework][data-filter-val="' + fwId + '"]');
      if (chip && chip.getAttribute('aria-pressed') !== 'true') chip.click();
    }, 400);
  };

  // Generic deep-link navigator: scrolls to section, filters table, sets URL hash, highlights row.
  // anchorId = doc.id from search index (e.g. ctrl-gdpr-art-5-1-a)
  // filterLabel = human-readable label for the search filter input
  function navigateToItem(section, searchSelector, anchorId, filterLabel) {
    scrollToSection(section);
    setTimeout(function() {
      var search = d.querySelector(searchSelector);
      if (search && filterLabel) {
        search.value = filterLabel;
        search.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      setTimeout(function() {
        var el = d.getElementById(anchorId);
        if (el) {
          try { location.hash = anchorId; } catch(e) {}
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.outline = '2px solid var(--brand-accent)';
          el.style.outlineOffset = '-2px';
          setTimeout(function() { el.style.outline = ''; el.style.outlineOffset = ''; }, 2000);
          var tr = el.closest ? el.closest('tr.swao-row') : null;
          if (tr) { var btn = tr.querySelector('.expand-btn[aria-expanded="false"]'); if (btn) btn.click(); }
        }
      }, 100);
    }, 350);
  }

  w.swaoNavigateToControl = function(anchorId, label) {
    navigateToItem('controls', '#controls-search', anchorId, label);
  };
  w.swaoNavigateToRisk = function(anchorId, label) {
    navigateToItem('risk-register', '#risks-search', anchorId, label);
  };
  w.swaoNavigateToEvidence = function(anchorId, label) {
    navigateToItem('evidence-gallery', '#evidence-search', anchorId, label);
  };

  // Filter controls table by framework when N-controls link is clicked.
  w.swaoFilterControls = function(fwId) {
    scrollToSection('controls');
    setTimeout(function() {
      var container = d.getElementById('controls');
      var chip = container
        ? container.querySelector('.filter-chip[data-filter-key=framework][data-filter-val="' + fwId + '"]')
        : d.querySelector('.filter-chip[data-filter-key=framework][data-filter-val="' + fwId + '"]');
      if (chip && chip.getAttribute('aria-pressed') !== 'true') chip.click();
    }, 400);
  };

  // Navigate to a resolved signal in the run-history table (#0701)
  w.swaoNavigateToResolvedSignal = function(signalId, runId) {
    scrollToSection('run-history');
    setTimeout(function() {
      if (runId) {
        var rowEl = d.getElementById('history-run-' + runId);
        if (rowEl) {
          try { location.hash = 'history-run-' + runId; } catch(e) {}
          rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var btn = rowEl.querySelector ? rowEl.querySelector('.expand-btn[aria-expanded="false"]') : null;
          if (btn) btn.click();
          rowEl.style.outline = '2px solid var(--colour-positive)';
          rowEl.style.outlineOffset = '-2px';
          setTimeout(function() { rowEl.style.outline = ''; rowEl.style.outlineOffset = ''; }, 2000);
          return;
        }
      }
      // Fallback: just highlight the section
      var sec = d.getElementById('run-history');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      void signalId;
    }, 400);
  };

  // ── Chip tooltip (global, singleton) -- #0698 #0701 #0703 ─────────────────

  function initChipTooltips() {
    var tip = d.createElement('div');
    tip.className = 'chip-tooltip';
    tip.style.cssText = 'position:fixed;pointer-events:none;z-index:4000;display:none;';
    d.body.appendChild(tip);

    var hoverTimer = null;
    var DELAY = 200;

    function showTip(el, x, y) {
      var sid = el.getAttribute('data-signal-id');
      var sev = el.getAttribute('data-signal-severity') || '';
      var out = el.getAttribute('data-signal-outcome') || '';
      var run = el.getAttribute('data-signal-run') || '';
      var deriv = el.getAttribute('data-signal-derivation') || '';
      var regime = el.getAttribute('data-regime') || '';
      var ctrlId = el.getAttribute('data-control-id') || '';
      var ctrlTitle = el.getAttribute('data-control-title') || '';
      var ctrlOut = el.getAttribute('data-control-outcome') || '';

      var article = el.getAttribute('data-control-article') || '';
      var html = '';
      if (sid && run) {
        html = '<strong>' + esc(sid) + '</strong><br><span style="font-size:0.78rem;color:var(--text-secondary);">Resolved -- click to view in history</span>';
      } else if (sid && sev) {
        html = '<strong>' + esc(sid) + '</strong><br><span style="font-size:0.78rem;">' + esc(sev) + (out ? ' / ' + esc(out) : '') + '</span>';
        if (deriv) {
          html += '<br><span style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-top:3px;max-width:260px;white-space:normal;">' + esc(deriv) + '</span>';
        }
      } else if (ctrlId) {
        // #0508: show title + regime/outcome + requirement text excerpt
        html = '<strong>' + esc(ctrlId) + '</strong>' +
          (ctrlTitle ? '<br><span style="font-size:0.78rem;">' + esc(ctrlTitle) + '</span>' : '') +
          (regime ? '<br><span style="font-size:0.75rem;color:var(--text-secondary);">' + esc(regime) + (ctrlOut ? ' - ' + esc(ctrlOut) : '') + '</span>' : '') +
          (article ? '<br><span style="font-size:0.73rem;color:var(--text-secondary);display:block;margin-top:3px;max-width:280px;white-space:normal;font-style:italic;">' + esc(article) + '</span>' : '');
      }
      if (!html) return;

      tip.innerHTML = html;
      tip.style.display = 'block';

      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var vw = w.innerWidth, vh = w.innerHeight;
      var left = Math.min(x + 12, vw - tw - 8);
      var top = y - th - 8;
      if (top < 4) top = y + 20;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      tip.classList.add('visible');
    }

    function hideTip() {
      tip.style.display = 'none';
      tip.classList.remove('visible');
    }

    d.addEventListener('mouseover', function(ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-signal-id],[data-control-id]') : null;
      if (!el) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function() { showTip(el, ev.clientX, ev.clientY); }, DELAY);
    });

    d.addEventListener('mouseout', function(ev) {
      var to = ev.relatedTarget;
      if (to && to.closest && to.closest('[data-signal-id],[data-control-id]')) return;
      clearTimeout(hoverTimer);
      hideTip();
    });

    d.addEventListener('mousemove', function(ev) {
      if (tip.style.display === 'none') return;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var vw = w.innerWidth, vh = w.innerHeight;
      var left = Math.min(ev.clientX + 12, vw - tw - 8);
      var top = ev.clientY - th - 8;
      if (top < 4) top = ev.clientY + 20;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    });
  }

  // ── Sidebar navigation (Mode A single-file, spec §2.4 + #0456) ────────────

  function initSidebar() {
    var nav = d.getElementById('swao-sidebar-nav');
    if (!nav) return;

    // Walk all <section id="..."> elements inside main-content and build links
    var main = d.getElementById('main-content');
    if (!main) return;

    var sections = main.querySelectorAll('section[id]');
    var items = [];
    sections.forEach(function(sec) {
      var id = sec.getAttribute('id');
      if (!id) return;
      if (sec.getAttribute('data-sidebar-exclude') === 'true') return;
      // Use the h2 text as the link label, falling back to the id
      var h2 = sec.querySelector('h2');
      var label = h2 ? (h2.textContent || '').replace(/\s*#\s*$/, '').trim() : id.replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      items.push({ id: id, label: label });
    });

    if (!items.length) return;

    // Build sub-item map: parentId -> [{id, label}] from [data-sidebar-sub-of][id] elements.
    var subItems = {};
    main.querySelectorAll('[data-sidebar-sub-of][id]').forEach(function(el) {
      var parentId = el.getAttribute('data-sidebar-sub-of');
      var subId = el.getAttribute('id');
      if (!parentId || !subId) return;
      var nameEl = el.querySelector('.lz-provider-name') || el.querySelector('summary');
      var subLabel = nameEl ? (nameEl.textContent || '').trim() : subId;
      if (!subItems[parentId]) subItems[parentId] = [];
      subItems[parentId].push({ id: subId, label: subLabel });
    });

    var html = '';
    items.forEach(function(item) {
      var subs = subItems[item.id];
      if (subs && subs.length) {
        html += '<li><a href="#' + esc(item.id) + '">' + esc(item.label) + '</a>';
        html += '<ul class="sidebar__sub-nav">';
        subs.forEach(function(sub) {
          html += '<li><a href="#' + esc(sub.id) + '" class="sidebar__sub-item">' + esc(sub.label) + '</a></li>';
        });
        html += '</ul></li>';
      } else {
        html += '<li><a href="#' + esc(item.id) + '">' + esc(item.label) + '</a></li>';
      }
    });
    nav.innerHTML = html;

    // Scroll threshold for updateActive
    function scrollThreshold() { return fixedOverlayHeight(); }

    // Set active on a specific section id immediately (e.g. after click)
    function setActive(id) {
      nav.querySelectorAll('a').forEach(function(a) {
        a.classList.toggle('active', a.getAttribute('href') === '#' + id);
      });
    }

    // Scroll lock: prevent scroll listener from overriding click-set active
    // during the smooth-scroll animation (typically completes within 500ms).
    var scrollLocked = false;
    function lockScroll() {
      scrollLocked = true;
      setTimeout(function() { scrollLocked = false; }, 600);
    }

    // Highlight current section based on scroll position.
    var topNav = d.querySelector('.site-header__nav');
    function updateActive() {
      if (scrollLocked) return;
      var threshold = scrollThreshold();
      var current = '';
      items.forEach(function(item) {
        var el = d.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= threshold) current = item.id;
      });
      if (current) {
        setActive(current);
        // Also update top nav active state
        if (topNav) {
          topNav.querySelectorAll('a[href]').forEach(function(a) {
            var href = a.getAttribute('href');
            a.classList.toggle('active', href === '#' + current);
          });
        }
      }
    }

    // On sidebar click: JS scroll to section + set active + lock scroll
    nav.addEventListener('click', function(e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      e.preventDefault(); // use JS scroll instead of browser anchor scroll
      var id = a.getAttribute('href').replace('#', '');
      setActive(id);
      lockScroll();
      scrollToSection(id);
      // Sync top nav
      if (topNav) {
        topNav.querySelectorAll('a[href]').forEach(function(link) {
          link.classList.toggle('active', link.getAttribute('href') === '#' + id);
        });
      }
    });

    // On top nav click: JS scroll + set active + lock scroll
    if (topNav) {
      topNav.addEventListener('click', function(e) {
        var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
        if (!a) return;
        e.preventDefault();
        topNav.querySelectorAll('a').forEach(function(link) { link.classList.remove('active'); });
        a.classList.add('active');
        lockScroll();
        var id = a.getAttribute('href').replace('#', '');
        setActive(id);
        scrollToSection(id);
      });
    }

    w.addEventListener('scroll', updateActive, { passive: true });
    updateActive();
  }

  // ── Global search (#0465 sprint-050) ─────────────────────────────────────

  function initGlobalSearch() {
    var input = d.getElementById('swao-global-search');
    var overlay = d.getElementById('swao-search-overlay');
    var closeBtn = d.getElementById('swao-search-close');
    var resultsEl = d.getElementById('swao-search-results');
    var countEl = d.getElementById('swao-search-count');
    var queryLabel = d.getElementById('swao-search-query-label');
    if (!input || !overlay) return;

    // Load search docs from embedded JSON
    function getSearchDocs() {
      var el = d.getElementById('swao-search-index');
      if (!el) return [];
      try { return JSON.parse(el.textContent || '[]'); } catch(_) { return []; }
    }

    function highlight(text, query) {
      if (!query) return esc(text);
      var re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      return esc(text).replace(re, '<mark>$1</mark>');
    }

    function doSearch(query) {
      var q = (query || '').trim().toLowerCase();
      if (!q) { overlay.style.display = 'none'; return; }

      var docs = getSearchDocs();
      var results = docs.filter(function(doc) {
        return doc.body && doc.body.toLowerCase().includes(q);
      }).slice(0, 80);

      // Group by type. #1384: any doc type without its own render group falls
      // back to 'other' AT GROUPING TIME -- previously types absent from
      // GROUP_ORDER (lzr-region, lzr-check) matched the query but were never
      // rendered, so the overlay showed a result count with zero rows.
      var GROUP_ORDER = ['signal', 'risk', 'control', 'evidence', 'lzr-region', 'lzr-check', 'section', 'other'];
      var GROUP_LABELS = { signal: 'Signals', risk: 'Risks', control: 'Compliance Controls', evidence: 'Evidence', 'lzr-region': 'Landing Zone Regions', 'lzr-check': 'Landing Zone Checks', section: 'Page Content', other: 'Other' };
      var groups = {};
      results.forEach(function(doc) {
        var t = (doc.type && GROUP_ORDER.indexOf(doc.type) !== -1) ? doc.type : 'other';
        if (!groups[t]) groups[t] = [];
        groups[t].push(doc);
      });

      var html = '';
      if (results.length === 0) {
        html = '<div class="search-no-results"><p>No results for <strong>' + esc(query) + '</strong></p><p style="font-size:0.85rem;margin-top:0.5rem;">Try a signal ID (e.g. INV-05), risk category, or keyword.</p></div>';
      } else {
        GROUP_ORDER.forEach(function(type) {
          var group = groups[type];
          if (!group || !group.length) return;
          html += '<div class="search-group"><h3>' + GROUP_LABELS[type] + ' (' + group.length + ')</h3>';
          group.forEach(function(doc) {
            // Map doc type to the actual HTML section id. #1384: lzr docs
            // resolve to whichever LZ section this publication actually
            // rendered (lz-catalog profile: lzr-catalog-header; application
            // profile: lzr-summary).
            var lzSection = d.getElementById('lzr-catalog-header') ? 'lzr-catalog-header'
              : d.getElementById('lzr-summary') ? 'lzr-summary' : '';
            var sectionMap = {signal:'signal-list', control:'controls', risk:'risk-register', evidence:'evidence-gallery', 'lzr-region': lzSection, 'lzr-check': lzSection};
            var href = doc.anchor ? '#' + doc.anchor : '#' + (sectionMap[doc.type] || (doc.type + '-register'));
            var excerpt = (doc.body || '').substring(0, 160);
            // Navigate handler: close overlay and navigate to the specific item
            var navFn = "document.getElementById('swao-search-overlay').style.display='none';";
            // Use single-quoted JS strings -- onclick attr uses double quotes so
            // JSON.stringify (which produces "..." double quotes) would break the attribute.
            // Escape backslashes first, then single quotes (CodeQL js/incomplete-sanitization).
            var safeLabel = (doc.label || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            if (doc.type === 'signal' && doc.label) {
              navFn += "window.swaoNavigateToSignal&&window.swaoNavigateToSignal('" + safeLabel + "');";
            } else if (doc.type === 'control' && doc.label) {
              // doc.id = ctrl.anchor (e.g. ctrl-gdpr-art-5-1-a); doc.label = ctrl.id (GDPR_Art_5_1_a)
              navFn += "window.swaoNavigateToControl&&window.swaoNavigateToControl('" + doc.id + "','" + safeLabel + "');";
            } else if (doc.type === 'risk') {
              navFn += "window.swaoNavigateToRisk&&window.swaoNavigateToRisk('" + doc.id + "','" + safeLabel + "');";
            } else if (doc.type === 'evidence') {
              // doc.id = evidence-ev-evd-... ; doc.label = ev.title
              navFn += "window.swaoNavigateToEvidence&&window.swaoNavigateToEvidence('" + doc.id + "','" + safeLabel + "');";
            } else if (doc.type === 'lzr-region' || doc.type === 'lzr-check') {
              // #1384: lzr docs carry id but no anchor; scroll to the rendered LZ section.
              navFn += 'window.swaoScrollTo&&window.swaoScrollTo("' + lzSection + '");';
            } else {
              navFn += 'window.swaoScrollTo&&window.swaoScrollTo("' + (doc.anchor || '') + '");';
            }
            html += '<div class="search-result">'
              + '<a href="' + esc(href) + '" onclick="event.preventDefault();' + navFn + 'return false;" style="cursor:pointer;">'
              + highlight(doc.label || doc.anchor || '', query)
              + (doc.sev ? ' <span class="badge badge-' + esc(doc.sev.toLowerCase()) + '">' + esc(doc.sev) + '</span>' : '')
              + '</a>'
              + '<span class="search-result__excerpt">' + highlight(excerpt, query) + '</span>'
              + '</div>';
          });
          html += '</div>';
        });
      }

      resultsEl.innerHTML = html;
      if (countEl) countEl.textContent = results.length + ' result(s)';
      if (queryLabel) queryLabel.textContent = 'Results for: "' + query + '"';
      overlay.style.display = 'flex'; // must be flex to support sticky header row
      overlay.scrollTop = 0;

      // Re-attach click handlers for result links to close overlay + JS scroll
      overlay.querySelectorAll('a[href^="#"]').forEach(function(a) {
        a.addEventListener('click', function(e) {
          e.preventDefault();
          overlay.style.display = 'none';
          var id = a.getAttribute('href').replace('#', '');
          setTimeout(function() { scrollToSection(id); }, 80);
        });
      });
      // For external (non-anchor) result links, just close overlay
      overlay.querySelectorAll('a:not([href^="#"])').forEach(function(a) {
        a.addEventListener('click', function() { overlay.style.display = 'none'; });
      });
    }

    var searchTimer = null;
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(input.value); }
      if (e.key === 'Escape') { overlay.style.display = 'none'; input.value = ''; }
    });
    input.addEventListener('input', function() {
      clearTimeout(searchTimer);
      if (!input.value.trim()) { overlay.style.display = 'none'; return; }
      searchTimer = setTimeout(function() { doSearch(input.value); }, 350);
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        overlay.style.display = 'none';
        input.value = '';
        input.focus();
      });
    }

    // Close on Escape from overlay
    overlay.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { overlay.style.display = 'none'; input.focus(); }
    });
  }

  // ── Hamburger menu (mobile responsive) ──────────────────────────────────

  function initHamburger() {
    var btn = d.getElementById('nav-hamburger');
    var nav = d.getElementById('site-nav') || d.querySelector('.site-header__nav');
    if (!btn || !nav) return;
    btn.addEventListener('click', function() {
      var open = nav.classList.toggle('nav-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Close nav when a nav link is clicked (mobile UX)
    nav.addEventListener('click', function(e) {
      if (e.target && e.target.tagName === 'A') {
        nav.classList.remove('nav-open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  // LLM Assessment matrix expand/collapse (#1478)
  function initLlmExpandCollapse() {
    document.querySelectorAll('.llm-expand-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var target = btn.getAttribute('data-target');
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        document.querySelectorAll('[data-parent="' + target + '"]').forEach(function(row) {
          row.style.display = expanded ? 'none' : '';
        });
      });
    });
  }

  d.addEventListener('DOMContentLoaded', function() {
    initSidebar(); // must run before initDeepLinkAnchors appends '#' to h2 text
    initDeepLinkAnchors();
    initCopyLinks();
    initGlossaryPopovers();
    initDarkModeToggle();
    initPrintHelper();
    initLangSwitcher();
    initHashNavigation();
    initGlobalSearch();
    initHamburger();
    initChipTooltips();
    initLlmExpandCollapse();
  });

})(window, document);
