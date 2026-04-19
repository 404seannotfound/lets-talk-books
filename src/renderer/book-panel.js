// Shared book panel rendering — used by genre-flow, author-flow, series-timeline, etc.
// Expects a <div id="book-panel" class="book-panel"></div> somewhere in the page.

(function () {
  const PANEL_ID = 'book-panel';

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function audibleUrl(asin) {
    return asin ? `https://www.audible.com/pd/${asin}` : null;
  }
  function amazonUrl(asin) {
    return asin ? `https://www.amazon.com/dp/${asin}` : null;
  }
  function searchUrl(title, author) {
    const q = encodeURIComponent(`${title} ${author || ''}`.trim());
    return `https://www.audible.com/search?keywords=${q}`;
  }

  function progressBadge(b) {
    if (b.is_finished) return '<span class="book-progress finished">✓ Finished</span>';
    const p = b.percent_complete || 0;
    if (p > 0) return `<span class="book-progress partial">${Math.round(p)}%</span>`;
    return '<span class="book-progress unread">Not started</span>';
  }

  function groupLabel(date) {
    if (!date) return 'Unknown';
    return date.slice(0, 7); // YYYY-MM
  }

  function bookRow(b) {
    const cover = b.cover
      ? `<img class="book-cover" src="${escHtml(b.cover)}" alt="" loading="lazy">`
      : `<div class="book-cover"></div>`;
    const seriesStr = b.series
      ? `<span class="sep">·</span><span class="series">${escHtml(b.series)}${b.series_seq ? ' #' + b.series_seq : ''}</span>`
      : '';
    const hours = b.runtime_min ? `<span class="sep">·</span>${Math.round(b.runtime_min / 60)}h` : '';
    const date = b.date ? `<span class="sep">·</span>${b.date}` : '';

    const links = [];
    if (b.asin) {
      links.push(`<a class="audible" href="${audibleUrl(b.asin)}" target="_blank" rel="noopener">Audible &rarr;</a>`);
      links.push(`<a class="amazon" href="${amazonUrl(b.asin)}" target="_blank" rel="noopener">Amazon</a>`);
    } else {
      links.push(`<a href="${searchUrl(b.title, b.authors)}" target="_blank" rel="noopener">Search Audible &rarr;</a>`);
    }

    return `
      <div class="book-item">
        ${cover}
        <div class="book-info">
          <div class="title">${escHtml(b.title)}</div>
          <div class="author">${escHtml(b.authors)}</div>
          <div class="sub">
            ${progressBadge(b)}${date}${hours}${seriesStr}
          </div>
          <div class="book-links">${links.join('')}</div>
        </div>
      </div>
    `;
  }

  /**
   * Show a list of books in the panel.
   * @param {Array} books - array of book objects
   * @param {String} title - panel heading
   * @param {String} swatchColor - optional color swatch next to title
   * @param {Object} opts - { groupBy: 'month'|'none', maxCount }
   */
  window.showBookPanel = function (books, title, swatchColor, opts = {}) {
    const { groupBy = 'month', maxCount = 5000, containerId = PANEL_ID, sortDesc = false } = opts;
    const panel = document.getElementById(containerId);
    if (!panel) return;

    const showing = books.slice(0, maxCount);
    const swatch = swatchColor ? `<span class="swatch" style="background:${swatchColor}"></span>` : '';
    let html = `
      <div class="panel-header">
        <button class="close" title="Close">×</button>
        <div class="title">${swatch}${escHtml(title)}</div>
        <div class="meta">${books.length} book${books.length === 1 ? '' : 's'}${books.length > maxCount ? ` · showing first ${maxCount}` : ''}</div>
      </div>
    `;

    if (!showing.length) {
      html += '<div class="panel-empty"><div class="panel-empty-emoji">📭</div><div>No books in this selection.</div></div>';
    } else if (groupBy === 'month') {
      // Group by YYYY-MM
      const groups = {};
      showing.forEach(b => {
        const g = groupLabel(b.date);
        if (!groups[g]) groups[g] = [];
        groups[g].push(b);
      });
      const sortedGroups = Object.keys(groups).sort();
      if (sortDesc) sortedGroups.reverse();
      sortedGroups.forEach(g => {
        html += `<div class="panel-group">${escHtml(g)} · ${groups[g].length} book${groups[g].length === 1 ? '' : 's'}</div>`;
        html += groups[g].map(bookRow).join('');
      });
    } else {
      html += showing.map(bookRow).join('');
    }

    panel.innerHTML = html;
    const closeBtn = panel.querySelector('.close');
    if (closeBtn) closeBtn.onclick = () => resetBookPanel(containerId);
    panel.scrollTop = 0;
  };

  window.resetBookPanel = function (containerId = PANEL_ID) {
    const panel = document.getElementById(containerId);
    if (!panel) return;
    panel.innerHTML = `
      <div class="panel-empty">
        <div class="panel-empty-emoji">📚</div>
        <div>Click a stream or search to see the books.</div>
      </div>
    `;
  };
})();
