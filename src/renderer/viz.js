let DATA = [];
let selectedAuthors = ['Philip K. Dick', 'John Scalzi', 'Brandon Sanderson', 'Terry Pratchett', 'Dakota Krout'];
let allAuthors = [];
let currentView = 'authorflow';

// Author flow state
let authorFlowEnabled = {}; // author -> bool
let authorFlowBuilt = false;

const SERIES_PALETTE = [
  '#f59e0b','#ef4444','#22c55e','#ec4899','#8b5cf6','#06b6d4','#f97316',
  '#84cc16','#14b8a6','#6366f1','#e879f9','#38bdf8','#fbbf24','#a3e635',
  '#fb923c','#34d399','#c084fc','#f87171','#a78bfa','#4ade80'
];
const NO_SERIES_COLOR = '#30363d';
const GENRE_PALETTE = [
  '#8b5cf6','#6366f1','#a78bfa','#f59e0b','#ef4444','#22c55e','#ec4899',
  '#14b8a6','#06b6d4','#84cc16','#f97316','#78716c','#e879f9','#fb923c',
  '#38bdf8','#a3e635','#fbbf24','#f87171','#34d399','#c084fc'
];

// Big distinct palette for many authors
const BIG_PALETTE = [
  '#f59e0b','#ef4444','#22c55e','#ec4899','#8b5cf6','#06b6d4','#f97316',
  '#84cc16','#14b8a6','#6366f1','#e879f9','#38bdf8','#fbbf24','#a3e635',
  '#fb923c','#34d399','#c084fc','#f87171','#a78bfa','#4ade80',
  '#facc15','#fb7185','#2dd4bf','#818cf8','#c084fc','#fca5a1',
  '#86efac','#7dd3fc','#fcd34d','#f9a8d4','#a5b4fc','#99f6e4',
  '#d8b4fe','#fed7aa','#bef264','#67e8f9','#fda4af','#c4b5fd',
  '#6ee7b7','#93c5fd','#fde68a','#f0abfc','#a7f3d0','#bae6fd',
  '#fef08a','#fbcfe8','#c7d2fe','#a5f3fc','#e9d5ff','#fdba74'
];

const tip = d3.select('#tooltip');
function showTip(evt, html) {
  tip.style('display','block').html(html)
    .style('left', Math.min(evt.pageX+12, window.innerWidth-340)+'px')
    .style('top', (evt.pageY-10)+'px');
}
function hideTip() { tip.style('display','none'); }

function primaryGenre(g) {
  if (!g) return 'Other';
  return g.split(',')[0].trim() || 'Other';
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function getSeriesColorMap(books) {
  const seriesNames = [...new Set(books.filter(b=>b.series).map(b=>b.series))];
  const map = {};
  seriesNames.forEach((s,i) => { map[s] = SERIES_PALETTE[i % SERIES_PALETTE.length]; });
  return map;
}

function progressLabel(d) {
  if (d.is_finished) return '<span style="color:#3fb950">✓ Finished</span>';
  const p = d.percent_complete || 0;
  if (p === 0) return '<span style="color:#6e7681">Not started</span>';
  return `<span style="color:#f59e0b">In progress · ${Math.round(p)}%</span>`;
}

// Dot opacity: finished books show at full opacity, unstarted/in-progress are dimmer.
function bookOpacity(d, base = 0.9) {
  if (d.is_finished) return base;
  const p = d.percent_complete || 0;
  if (p === 0) return base * 0.35;       // never started
  return base * 0.6;                      // partially started
}

function bookTipHTML(d) {
  return `<div class="tt">${esc(d.title)}</div>`
    + `<div class="ta">${esc(d.authors)}</div>`
    + (d.series ? `<div class="ts">${esc(d.series)}${d.series_seq ? ' #'+d.series_seq : ''}</div>` : '')
    + `<div class="td">${d.date} · ${Math.round(d.runtime_min/60)}h · ${progressLabel(d)}</div>`;
}

// ═══════════════════════════════════════════
// AUTHOR FLOW (streamgraph for authors)
// ═══════════════════════════════════════════

// Determine primary genre per author (most frequent)
function getAuthorPrimaryGenre(author) {
  const gc = {};
  DATA.filter(b => b.authors.split(',').map(a=>a.trim()).includes(author))
    .forEach(b => { gc[b.genre] = (gc[b.genre]||0)+1; });
  let best = 'Other', bestC = 0;
  for (const [g,c] of Object.entries(gc)) { if (c > bestC) { best = g; bestC = c; } }
  return best;
}

let authorGenreCache = {};
let genreAuthorMap = {}; // genre -> [{name, count}]
let authorColorMap = {};

function buildAuthorFlowData() {
  if (authorFlowBuilt) return;

  // Count per author
  const ac = {};
  DATA.forEach(b => b.authors.split(',').forEach(a => { a=a.trim(); if(a) ac[a]=(ac[a]||0)+1; }));

  // Primary genre per author
  const allA = Object.keys(ac);
  allA.forEach(a => { authorGenreCache[a] = getAuthorPrimaryGenre(a); });

  // Group by genre
  genreAuthorMap = {};
  allA.forEach(a => {
    const g = authorGenreCache[a];
    if (!genreAuthorMap[g]) genreAuthorMap[g] = [];
    genreAuthorMap[g].push({ name: a, count: ac[a] });
  });
  // Sort authors within each genre by count desc
  for (const g of Object.keys(genreAuthorMap)) {
    genreAuthorMap[g].sort((a,b) => b.count - a.count);
  }

  // Default: enable top 20 authors
  const top20 = Object.entries(ac).sort((a,b)=>b[1]-a[1]).slice(0,20).map(e=>e[0]);
  allA.forEach(a => { authorFlowEnabled[a] = top20.includes(a); });

  // Assign colors to all authors (stable)
  const sorted = Object.entries(ac).sort((a,b)=>b[1]-a[1]);
  sorted.forEach(([a], i) => { authorColorMap[a] = BIG_PALETTE[i % BIG_PALETTE.length]; });

  authorFlowBuilt = true;
}

function buildSidebar() {
  const container = document.getElementById('sidebar-genres');
  container.innerHTML = '';

  // Sort genres by total books
  const genreTotals = {};
  for (const [g, authors] of Object.entries(genreAuthorMap)) {
    genreTotals[g] = authors.reduce((s,a) => s + a.count, 0);
  }
  const sortedGenres = Object.keys(genreAuthorMap).sort((a,b) => genreTotals[b] - genreTotals[a]);

  // Genre colors (reuse palette)
  const genreColors = {};
  sortedGenres.forEach((g,i) => { genreColors[g] = GENRE_PALETTE[i % GENRE_PALETTE.length]; });

  sortedGenres.forEach(genre => {
    const authors = genreAuthorMap[genre];
    const grp = document.createElement('div');
    grp.className = 'genre-group';
    grp.dataset.genre = genre;

    // Check if all/some/none enabled
    const enabledCount = authors.filter(a => authorFlowEnabled[a.name]).length;
    const allEnabled = enabledCount === authors.length;
    const someEnabled = enabledCount > 0 && !allEnabled;

    const header = document.createElement('div');
    header.className = 'genre-header';
    header.innerHTML = `
      <span class="arrow">▼</span>
      <input type="checkbox" class="genre-cb" ${allEnabled ? 'checked' : ''} ${someEnabled ? 'indeterminate' : ''}>
      <span class="genre-swatch" style="background:${genreColors[genre]}"></span>
      <span class="genre-name">${esc(genre)}</span>
      <span class="genre-count">${authors.length}</span>
    `;
    if (someEnabled) header.querySelector('.genre-cb').indeterminate = true;

    const authorList = document.createElement('div');
    authorList.className = 'genre-authors';

    authors.forEach(a => {
      const item = document.createElement('div');
      item.className = 'author-item';
      item.dataset.author = a.name;
      item.innerHTML = `
        <input type="checkbox" class="author-cb" ${authorFlowEnabled[a.name] ? 'checked' : ''}>
        <span class="author-swatch" style="background:${authorColorMap[a.name]}"></span>
        <span class="author-name">${esc(a.name)}</span>
        <span class="author-count">${a.count}</span>
      `;
      const cb = item.querySelector('.author-cb');
      cb.addEventListener('change', () => {
        authorFlowEnabled[a.name] = cb.checked;
        updateGenreCheckbox(grp);
        renderAuthorFlow();
      });
      item.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
      authorList.appendChild(item);
    });

    // Genre checkbox toggles all authors in group
    const genreCb = header.querySelector('.genre-cb');
    genreCb.addEventListener('change', () => {
      const checked = genreCb.checked;
      genreCb.indeterminate = false;
      authors.forEach(a => {
        authorFlowEnabled[a.name] = checked;
      });
      authorList.querySelectorAll('.author-cb').forEach(cb => cb.checked = checked);
      renderAuthorFlow();
    });

    // Collapse/expand
    const arrow = header.querySelector('.arrow');
    header.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const collapsed = authorList.classList.toggle('collapsed');
      arrow.classList.toggle('collapsed', collapsed);
    });

    // Start collapsed
    authorList.classList.add('collapsed');
    arrow.classList.add('collapsed');

    grp.appendChild(header);
    grp.appendChild(authorList);
    container.appendChild(grp);
  });

  // Sidebar filter
  document.getElementById('sidebar-filter').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    container.querySelectorAll('.genre-group').forEach(grp => {
      const items = grp.querySelectorAll('.author-item');
      let anyVisible = false;
      items.forEach(item => {
        const match = !q || item.dataset.author.toLowerCase().includes(q);
        item.style.display = match ? '' : 'none';
        if (match) anyVisible = true;
      });
      grp.style.display = anyVisible ? '' : 'none';
      // Auto-expand when filtering
      if (q && anyVisible) {
        grp.querySelector('.genre-authors').classList.remove('collapsed');
        grp.querySelector('.arrow').classList.remove('collapsed');
      }
    });
  });

  // Quick buttons
  document.getElementById('btn-top20').onclick = () => setTopN(20);
  document.getElementById('btn-top50').onclick = () => setTopN(50);
  document.getElementById('btn-all').onclick = () => setAll(true);
  document.getElementById('btn-none').onclick = () => setAll(false);
}

function setTopN(n) {
  const ac = {};
  DATA.forEach(b => b.authors.split(',').forEach(a => { a=a.trim(); if(a) ac[a]=(ac[a]||0)+1; }));
  const topN = new Set(Object.entries(ac).sort((a,b)=>b[1]-a[1]).slice(0,n).map(e=>e[0]));
  for (const a of Object.keys(authorFlowEnabled)) {
    authorFlowEnabled[a] = topN.has(a);
  }
  syncSidebarCheckboxes();
  renderAuthorFlow();
}

function setAll(val) {
  for (const a of Object.keys(authorFlowEnabled)) authorFlowEnabled[a] = val;
  syncSidebarCheckboxes();
  renderAuthorFlow();
}

function syncSidebarCheckboxes() {
  document.querySelectorAll('.author-item').forEach(item => {
    const a = item.dataset.author;
    item.querySelector('.author-cb').checked = !!authorFlowEnabled[a];
  });
  document.querySelectorAll('.genre-group').forEach(grp => updateGenreCheckbox(grp));
}

function updateGenreCheckbox(grp) {
  const cbs = grp.querySelectorAll('.author-cb');
  const checked = [...cbs].filter(c => c.checked).length;
  const gcb = grp.querySelector('.genre-cb');
  gcb.checked = checked === cbs.length;
  gcb.indeterminate = checked > 0 && checked < cbs.length;
}

function renderAuthorFlow() {
  const container = d3.select('#authorflow-chart');
  container.selectAll('*').remove();

  const enabledAuthors = Object.entries(authorFlowEnabled).filter(([,v])=>v).map(([k])=>k);
  if (!enabledAuthors.length) {
    container.append('div').style('color','#8b949e').style('padding','40px').text('Select authors in the sidebar.');
    return;
  }

  const margin = {top: 20, right: 30, bottom: 40, left: 20};
  const width = Math.max(700, window.innerWidth - 380);
  const height = Math.max(400, Math.min(700, 300 + enabledAuthors.length * 4));

  const svg = container.append('svg').attr('width', width).attr('height', height);

  // Aggregate by quarter per author
  const quarters = {};
  DATA.forEach(b => {
    const q = `${b.year}-Q${Math.ceil(b.month/3)}`;
    if (!quarters[q]) quarters[q] = { quarter: q };
    b.authors.split(',').forEach(a => {
      a = a.trim();
      if (a && authorFlowEnabled[a]) {
        quarters[q][a] = (quarters[q][a] || 0) + 1;
      }
    });
  });

  const qData = Object.values(quarters).sort((a,b) => a.quarter.localeCompare(b.quarter));

  // Sort authors: most books first for better stacking
  const authorTotals = {};
  enabledAuthors.forEach(a => { authorTotals[a] = DATA.filter(b=>b.authors.split(',').map(x=>x.trim()).includes(a)).length; });
  const keys = enabledAuthors.sort((a,b) => authorTotals[b] - authorTotals[a]);

  keys.forEach(k => qData.forEach(q => { if (!q[k]) q[k] = 0; }));

  const parseQ = d => { const [y,q] = d.quarter.split('-Q'); return new Date(+y, (+q-1)*3, 1); };

  const x = d3.scaleTime().domain(d3.extent(qData, parseQ)).range([margin.left, width-margin.right]);
  const stack = d3.stack().keys(keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut);
  const series = stack(qData);
  const yScale = d3.scaleLinear()
    .domain([d3.min(series, s=>d3.min(s,d=>d[0])), d3.max(series, s=>d3.max(s,d=>d[1]))])
    .range([height-margin.bottom, margin.top]);

  const area = d3.area()
    .x((_,i) => x(parseQ(qData[i])))
    .y0(d => yScale(d[0]))
    .y1(d => yScale(d[1]))
    .curve(d3.curveBasis);

  const paths = svg.selectAll('.stream').data(series).enter()
    .append('path').attr('class','stream').attr('d', area)
    .attr('fill', d => authorColorMap[d.key] || '#58a6ff')
    .attr('opacity', 0.85)
    .attr('stroke', '#0d1117').attr('stroke-width', 0.3)
    .on('mouseover', function(evt, d) {
      paths.attr('opacity', 0.08);
      d3.select(this).attr('opacity', 1);
      const count = authorTotals[d.key];
      const genre = authorGenreCache[d.key] || '';
      showTip(evt, `<div class="tt">${esc(d.key)}</div><div class="td">${count} books · ${genre}</div>`);
    })
    .on('mousemove', evt => tip.style('left',(evt.pageX+12)+'px').style('top',(evt.pageY-10)+'px'))
    .on('mouseout', () => { paths.attr('opacity', 0.85); hideTip(); });

  // X axis
  svg.append('g').attr('class','axis').attr('transform',`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x).ticks(d3.timeYear.every(2)).tickFormat(d3.timeFormat('%Y')));

  // Labels on streams for larger ones
  series.forEach(s => {
    const total = authorTotals[s.key];
    if (total < 8) return; // only label significant authors
    // Find the point with max thickness
    let maxThick = 0, maxI = 0;
    s.forEach((d,i) => {
      const thick = d[1] - d[0];
      if (thick > maxThick) { maxThick = thick; maxI = i; }
    });
    if (maxThick < 0.5) return;
    const midY = yScale((s[maxI][0] + s[maxI][1]) / 2);
    const midX = x(parseQ(qData[maxI]));
    svg.append('text')
      .attr('x', midX).attr('y', midY)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', '#fff').attr('font-size', 9).attr('opacity', 0.7)
      .attr('pointer-events', 'none')
      .text(s.key.length > 18 ? s.key.slice(0,16)+'…' : s.key);
  });
}

// ═══════════════════════════════════════════
// EXISTING VIEWS (Author Timeline, Series, Genre Flow, Author Dots)
// ═══════════════════════════════════════════

function renderAuthorTimeline() {
  const container = d3.select('#author-timeline');
  container.selectAll('*').remove();
  if (!selectedAuthors.length) {
    container.append('div').style('color','#8b949e').style('padding','40px').text('Add authors above to see their reading timeline.');
    return;
  }
  const margin = {top:20,right:30,bottom:40,left:180};
  const width = Math.max(900, window.innerWidth-100);
  const rowH = 60;
  const height = margin.top+margin.bottom+selectedAuthors.length*rowH;
  const svg = container.append('svg').attr('width',width).attr('height',height);
  const allDates = DATA.map(b=>new Date(b.date));
  const x = d3.scaleTime().domain([d3.min(allDates),d3.max(allDates)]).range([margin.left,width-margin.right]);
  const y = d3.scaleBand().domain(selectedAuthors).range([margin.top,height-margin.bottom]).padding(0.15);
  svg.append('g').attr('class','grid').attr('transform',`translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).ticks(d3.timeYear.every(2)).tickSize(-(height-margin.top-margin.bottom)).tickFormat(''));
  svg.append('g').attr('class','axis').attr('transform',`translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).ticks(d3.timeYear.every(2)).tickFormat(d3.timeFormat('%Y')));

  selectedAuthors.forEach((author, ai) => {
    const books = DATA.filter(b=>b.authors.split(',').map(a=>a.trim()).includes(author)).sort((a,b)=>a.date.localeCompare(b.date));
    const seriesColors = getSeriesColorMap(books);
    const bandY = y(author), bandH = y.bandwidth();
    svg.append('rect').attr('x',margin.left).attr('y',bandY).attr('width',width-margin.left-margin.right).attr('height',bandH).attr('fill',ai%2===0?'#0d1117':'#111620').attr('rx',3);
    svg.append('text').attr('x',margin.left-8).attr('y',bandY+bandH/2).attr('text-anchor','end').attr('dominant-baseline','middle').attr('fill','#c9d1d9').attr('font-size',12).attr('font-weight',600).text(`${author} (${books.length})`);
    if (books.length > 1) svg.append('line').attr('x1',x(new Date(books[0].date))).attr('x2',x(new Date(books[books.length-1].date))).attr('y1',bandY+bandH/2).attr('y2',bandY+bandH/2).attr('stroke','#21262d').attr('stroke-width',1);
    const sg = {};
    books.forEach(b => { if(b.series){if(!sg[b.series])sg[b.series]=[];sg[b.series].push(b);} });
    Object.entries(sg).forEach(([sName,sBooks]) => {
      if(sBooks.length>=2){const sorted=sBooks.sort((a,b)=>a.date.localeCompare(b.date));svg.append('line').attr('x1',x(new Date(sorted[0].date))).attr('x2',x(new Date(sorted[sorted.length-1].date))).attr('y1',bandY+bandH/2).attr('y2',bandY+bandH/2).attr('stroke',seriesColors[sName]).attr('stroke-opacity',0.35).attr('stroke-width',3);}
      if(sBooks.length>=3){const md=sBooks[Math.floor(sBooks.length/2)].date;svg.append('text').attr('class','series-label').attr('x',x(new Date(md))).attr('y',bandY+bandH/2-10).attr('text-anchor','middle').attr('fill',seriesColors[sName]).attr('font-size',9).attr('opacity',0.7).text(sName.length>20?sName.slice(0,18)+'…':sName);}
    });
    svg.selectAll(null).data(books).enter().append('circle').attr('class','author-dot')
      .attr('cx',d=>x(new Date(d.date))).attr('cy',bandY+bandH/2)
      .attr('r',5)
      .attr('fill',d=>d.is_finished ? (d.series?seriesColors[d.series]:NO_SERIES_COLOR) : 'none')
      .attr('stroke',d=>d.series?seriesColors[d.series]:'#8b949e')
      .attr('stroke-width', d => d.is_finished ? 1 : 1.5)
      .attr('opacity', d => bookOpacity(d, d.series?0.95:0.7))
      .on('mouseover',(evt,d)=>showTip(evt,bookTipHTML(d))).on('mouseout',hideTip);
  });
}

function renderSeriesTimeline() {
  const container = d3.select('#series-timeline');
  container.selectAll('*').remove();
  const minBooks = +document.getElementById('series-min').value;
  const sortBy = document.getElementById('series-sort').value;
  const seriesMap = {};
  DATA.forEach(b => { if(!b.series) return; if(!seriesMap[b.series])seriesMap[b.series]=[]; seriesMap[b.series].push(b); });
  let seriesList = Object.entries(seriesMap).filter(([,books])=>books.length>=minBooks).map(([name,books])=>{
    books.sort((a,b)=>a.date.localeCompare(b.date));
    const start=new Date(books[0].date),end=new Date(books[books.length-1].date);
    return{name,books,start,end,spanDays:(end-start)/(1000*60*60*24),count:books.length};
  });
  if(sortBy==='count')seriesList.sort((a,b)=>b.count-a.count);
  else if(sortBy==='start')seriesList.sort((a,b)=>a.start-b.start);
  else seriesList.sort((a,b)=>b.spanDays-a.spanDays);
  seriesList=seriesList.slice(0,60);
  const margin={top:20,right:30,bottom:40,left:260};
  const width=Math.max(900,window.innerWidth-100);
  const rowH=24;
  const height=margin.top+margin.bottom+seriesList.length*rowH;
  const svg=container.append('svg').attr('width',width).attr('height',height);
  const allDates=DATA.map(b=>new Date(b.date));
  const x=d3.scaleTime().domain([d3.min(allDates),d3.max(allDates)]).range([margin.left,width-margin.right]);
  const y=d3.scaleBand().domain(seriesList.map(s=>s.name)).range([margin.top,height-margin.bottom]).padding(0.25);
  svg.append('g').attr('class','grid').attr('transform',`translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).ticks(d3.timeYear.every(2)).tickSize(-(height-margin.top-margin.bottom)).tickFormat(''));
  svg.append('g').attr('class','axis').attr('transform',`translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).ticks(d3.timeYear.every(2)).tickFormat(d3.timeFormat('%Y')));
  seriesList.forEach((s,i)=>{
    const color=SERIES_PALETTE[i%SERIES_PALETTE.length];
    const bandY=y(s.name),bandH=y.bandwidth();
    svg.append('rect').attr('x',margin.left).attr('y',bandY).attr('width',width-margin.left-margin.right).attr('height',bandH).attr('fill',i%2===0?'#0d1117':'#111620').attr('rx',2);
    const label=s.name.length>30?s.name.slice(0,28)+'…':s.name;
    svg.append('text').attr('x',margin.left-6).attr('y',bandY+bandH/2).attr('text-anchor','end').attr('dominant-baseline','middle').attr('fill',color).attr('font-size',11).text(`${label} (${s.count})`);
    if(s.books.length>1)svg.append('line').attr('x1',x(s.start)).attr('x2',x(s.end)).attr('y1',bandY+bandH/2).attr('y2',bandY+bandH/2).attr('stroke',color).attr('stroke-opacity',0.3).attr('stroke-width',3);
    svg.selectAll(null).data(s.books).enter().append('circle').attr('class','author-dot')
      .attr('cx',d=>x(new Date(d.date))).attr('cy',bandY+bandH/2).attr('r',4)
      .attr('fill', d => d.is_finished ? color : 'none')
      .attr('stroke', color).attr('stroke-width', d => d.is_finished ? 0 : 1.5)
      .attr('opacity', d => bookOpacity(d, 0.9))
      .on('mouseover',(evt,d)=>showTip(evt,bookTipHTML(d))).on('mouseout',hideTip);
  });
}

function renderStreamChart() {
  const container = d3.select('#stream-chart');
  container.selectAll('*').remove();
  const margin={top:20,right:30,bottom:40,left:60};
  const width=Math.max(900,window.innerWidth-100);
  const height=500;
  const svg=container.append('svg').attr('width',width).attr('height',height);
  const genreCounts={};
  DATA.forEach(b=>{genreCounts[b.genre]=(genreCounts[b.genre]||0)+1;});
  const genres=Object.entries(genreCounts).sort((a,b)=>b[1]-a[1]).slice(0,12).map(e=>e[0]);
  const genreSet=new Set(genres);
  const quarters={};
  DATA.forEach(b=>{const q=`${b.year}-Q${Math.ceil(b.month/3)}`;if(!quarters[q])quarters[q]={quarter:q};const g=genreSet.has(b.genre)?b.genre:'Other';quarters[q][g]=(quarters[q][g]||0)+1;});
  const keys=[...genres,'Other'];
  const qData=Object.values(quarters).sort((a,b)=>a.quarter.localeCompare(b.quarter));
  keys.forEach(k=>qData.forEach(q=>{if(!q[k])q[k]=0;}));
  const parseQ=d=>{const[y,q]=d.quarter.split('-Q');return new Date(+y,(+q-1)*3,1);};
  const x=d3.scaleTime().domain(d3.extent(qData,parseQ)).range([margin.left,width-margin.right]);
  const stack=d3.stack().keys(keys).offset(d3.stackOffsetWiggle);
  const series=stack(qData);
  const yS=d3.scaleLinear().domain([d3.min(series,s=>d3.min(s,d=>d[0])),d3.max(series,s=>d3.max(s,d=>d[1]))]).range([height-margin.bottom,margin.top]);
  const colorScale=d3.scaleOrdinal().domain(keys).range([...GENRE_PALETTE.slice(0,genres.length),'#30363d']);
  const area=d3.area().x((_,i)=>x(parseQ(qData[i]))).y0(d=>yS(d[0])).y1(d=>yS(d[1])).curve(d3.curveBasis);
  const paths=svg.selectAll('.stream').data(series).enter().append('path').attr('class','stream').attr('d',area).attr('fill',d=>colorScale(d.key)).attr('opacity',0.85).attr('stroke','#0d1117').attr('stroke-width',0.5)
    .on('mouseover',function(evt,d){paths.attr('opacity',0.12);d3.select(this).attr('opacity',1);showTip(evt,`<div class="tt">${d.key}</div><div class="td">${DATA.filter(b=>b.genre===d.key||(d.key==='Other'&&!genreSet.has(b.genre))).length} books</div>`);})
    .on('mousemove',evt=>tip.style('left',(evt.pageX+12)+'px').style('top',(evt.pageY-10)+'px'))
    .on('mouseout',function(){const hl=document.getElementById('genre-highlight').value;paths.attr('opacity',hl?(d=>d.key===hl?1:0.1):0.85);hideTip();});
  svg.append('g').attr('class','axis').attr('transform',`translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).ticks(d3.timeYear.every(2)).tickFormat(d3.timeFormat('%Y')));
  const legend=d3.select('#genre-legend');legend.selectAll('*').remove();
  keys.forEach(k=>{const item=legend.append('div').attr('class','legend-item').on('click',()=>{document.getElementById('genre-highlight').value=k;paths.attr('opacity',d=>d.key===k?1:0.1);});item.append('div').attr('class','legend-swatch').style('background',colorScale(k));item.append('span').text(k);});
  const sel=document.getElementById('genre-highlight');sel.innerHTML='<option value="">All genres</option>';keys.forEach(k=>sel.innerHTML+=`<option value="${esc(k)}">${k}</option>`);
  sel.onchange=()=>{const v=sel.value;paths.attr('opacity',v?(d=>d.key===v?1:0.1):0.85);};
}

function renderAuthorDots() {
  const container = d3.select('#authordots-chart');
  container.selectAll('*').remove();
  const authorCounts={};
  DATA.forEach(b=>b.authors.split(',').forEach(a=>{a=a.trim();if(a)authorCounts[a]=(authorCounts[a]||0)+1;}));
  const top=Object.entries(authorCounts).sort((a,b)=>b[1]-a[1]).slice(0,40).map(e=>e[0]);
  const margin={top:20,right:30,bottom:40,left:180};
  const width=Math.max(900,window.innerWidth-100);
  const rowH=24;
  const height=margin.top+margin.bottom+top.length*rowH;
  const svg=container.append('svg').attr('width',width).attr('height',height);
  const allDates=DATA.map(b=>new Date(b.date));
  const x=d3.scaleTime().domain([d3.min(allDates),d3.max(allDates)]).range([margin.left,width-margin.right]);
  const y=d3.scaleBand().domain(top).range([margin.top,height-margin.bottom]).padding(0.2);
  svg.append('g').attr('class','grid').attr('transform',`translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).ticks(d3.timeYear.every(2)).tickSize(-(height-margin.top-margin.bottom)).tickFormat(''));
  svg.append('g').attr('class','axis').attr('transform',`translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).ticks(d3.timeYear.every(2)).tickFormat(d3.timeFormat('%Y')));
  top.forEach((author,i)=>{
    const books=DATA.filter(b=>b.authors.split(',').map(a=>a.trim()).includes(author)).sort((a,b)=>a.date.localeCompare(b.date));
    const seriesColors=getSeriesColorMap(books);
    const bandY=y(author),bandH=y.bandwidth();
    svg.append('text').attr('x',margin.left-6).attr('y',bandY+bandH/2).attr('text-anchor','end').attr('dominant-baseline','middle').attr('fill','#8b949e').attr('font-size',11).text(author);
    svg.selectAll(null).data(books).enter().append('circle').attr('class','author-dot')
      .attr('cx',d=>x(new Date(d.date))).attr('cy',bandY+bandH/2).attr('r',3.5)
      .attr('fill', d => d.is_finished ? (d.series?seriesColors[d.series]:NO_SERIES_COLOR) : 'none')
      .attr('stroke', d => d.series?seriesColors[d.series]:NO_SERIES_COLOR)
      .attr('stroke-width', d => d.is_finished ? 0 : 1.2)
      .attr('opacity', d => bookOpacity(d, d.series?0.9:0.5))
      .on('mouseover',(evt,d)=>showTip(evt,bookTipHTML(d))).on('mouseout',hideTip);
  });
}

// ─── Author search (for Author Timeline view) ───
function renderAuthorChips() {
  const el = document.getElementById('selected-authors');
  el.innerHTML = '';
  selectedAuthors.forEach(a => {
    const chip = document.createElement('span');
    chip.className = 'author-chip'; chip.textContent = a+' ×';
    chip.onclick = () => { selectedAuthors=selectedAuthors.filter(x=>x!==a); renderAuthorChips(); renderAuthorTimeline(); };
    el.appendChild(chip);
  });
}
const searchInput = document.getElementById('author-search');
const searchResults = document.getElementById('author-search-results');
searchInput.addEventListener('input', () => {
  const q=searchInput.value.toLowerCase();
  if(q.length<2){searchResults.style.display='none';return;}
  const matches=allAuthors.filter(a=>a.toLowerCase().includes(q)&&!selectedAuthors.includes(a)).slice(0,10);
  if(!matches.length){searchResults.style.display='none';return;}
  searchResults.innerHTML='';searchResults.style.display='block';
  const rect=searchInput.getBoundingClientRect();
  searchResults.style.left=rect.left+'px';searchResults.style.top=(rect.bottom+2)+'px';searchResults.style.width=Math.max(rect.width,250)+'px';
  matches.forEach(a=>{const count=DATA.filter(b=>b.authors.split(',').map(x=>x.trim()).includes(a)).length;const div=document.createElement('div');div.textContent=`${a} (${count} books)`;div.onclick=()=>{selectedAuthors.push(a);searchInput.value='';searchResults.style.display='none';renderAuthorChips();renderAuthorTimeline();};searchResults.appendChild(div);});
});
document.addEventListener('click',e=>{if(!searchResults.contains(e.target)&&e.target!==searchInput)searchResults.style.display='none';});

// ─── View switching ───
const views = ['authorflow','stream','authors','series','authordots'];
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    views.forEach(v => { document.getElementById('view-'+v).style.display = v===currentView ? 'block' : 'none'; });
    document.getElementById('author-controls').style.display = currentView==='authors' ? 'flex' : 'none';
    document.getElementById('genre-controls').style.display = currentView==='stream' ? 'flex' : 'none';
    document.getElementById('series-controls').style.display = currentView==='series' ? 'flex' : 'none';
    render();
  });
});

document.getElementById('series-min').onchange = () => { if(currentView==='series') renderSeriesTimeline(); };
document.getElementById('series-sort').onchange = () => { if(currentView==='series') renderSeriesTimeline(); };

function render() {
  if (currentView==='authorflow') renderAuthorFlow();
  else if (currentView==='stream') renderStreamChart();
  else if (currentView==='authors') renderAuthorTimeline();
  else if (currentView==='series') renderSeriesTimeline();
  else if (currentView==='authordots') renderAuthorDots();
}

function initViz(data) {
  DATA = data;
  DATA.forEach(b => { b.genre = primaryGenre(b.genres || b.genre); });

  // Reset state (in case of refresh)
  authorFlowEnabled = {};
  authorFlowBuilt = false;
  authorGenreCache = {};
  genreAuthorMap = {};
  authorColorMap = {};

  document.getElementById('s-books').textContent = DATA.length.toLocaleString();
  document.getElementById('s-hours').textContent = Math.round(DATA.reduce((s,b)=>s+b.runtime_min,0)/60).toLocaleString();
  const authSet = new Set();
  DATA.forEach(b=>b.authors.split(',').forEach(a=>{a=a.trim();if(a)authSet.add(a);}));
  document.getElementById('s-authors').textContent = authSet.size.toLocaleString();
  document.getElementById('s-series').textContent = new Set(DATA.filter(b=>b.series).map(b=>b.series)).size;

  // Dynamic subtitle
  const dates = DATA.map(b=>b.date).sort();
  if (dates.length) {
    const first = dates[0].slice(0,7);
    const last = dates[dates.length-1].slice(0,7);
    const subEl = document.getElementById('viz-sub');
    if (subEl) subEl.textContent = `${first} to ${last}`;
  }

  const ac = {};
  DATA.forEach(b=>b.authors.split(',').forEach(a=>{a=a.trim();if(a)ac[a]=(ac[a]||0)+1;}));
  allAuthors = Object.entries(ac).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);

  // Use top 5 authors as default selection instead of hardcoded
  selectedAuthors = allAuthors.slice(0, 5);

  buildAuthorFlowData();
  buildSidebar();
  renderAuthorChips();
  render();
}

window.initViz = initViz;
window.addEventListener('resize', () => { if (DATA.length) render(); });
