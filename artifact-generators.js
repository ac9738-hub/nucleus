// In-process artifact generators for previewable student outputs.
// Functionality: builds HTML/SVG previews and JSON payloads for binary generators.
// Dependencies: artifact-store filename helpers; agent_artifacts/build.py for docx/pptx/latex.
const fs = require('fs')
const path = require('path')

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapPreviewDocument(title, body, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f8fc;
      --surface: #ffffff;
      --text: #1b2138;
      --muted: #5d6787;
      --border: #d8deef;
      --accent: #7567d8;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b1020;
        --surface: #121a33;
        --text: #edf0ff;
        --muted: #9aa5cf;
        --border: #2a355f;
        --accent: #9b8fff;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .artifact-shell {
      max-width: 960px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 12px 40px rgba(20, 28, 60, 0.08);
    }
    h1, h2, h3 { margin-top: 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 14px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: rgba(117, 103, 216, 0.08);
      font-weight: 600;
    }
    .chart-wrap, .graph-wrap {
      overflow: auto;
      margin-top: 12px;
    }
    svg { max-width: 100%; height: auto; display: block; }
    .caption { color: var(--muted); font-size: 13px; margin-top: 8px; }
  </style>
  ${extraHead}
</head>
<body>
  <div class="artifact-shell">
    ${body}
  </div>
</body>
</html>`
}

function generateTableArtifact(content = {}) {
  const headers = Array.isArray(content.headers) ? content.headers.map(String) : []
  const rows = Array.isArray(content.rows) ? content.rows : []
  const title = content.title || 'Table'
  const headerHtml = headers.length
    ? `<thead><tr>${headers.map(cell => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead>`
    : ''
  const bodyHtml = rows.map(row => {
    const cells = Array.isArray(row) ? row : []
    return `<tr>${cells.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
  }).join('')
  const html = wrapPreviewDocument(
    title,
    `<h1>${escapeHtml(title)}</h1>${content.caption ? `<p class="caption">${escapeHtml(content.caption)}</p>` : ''}<table>${headerHtml}<tbody>${bodyHtml}</tbody></table>`
  )
  return { previewHtml: html, downloadExt: 'html', mimeType: 'text/html' }
}

function generateChartArtifact(content = {}) {
  const chartType = String(content.chart_type || content.chartType || 'bar').toLowerCase()
  const labels = Array.isArray(content.labels) ? content.labels.map(String) : []
  const datasets = Array.isArray(content.datasets) ? content.datasets : []
  const title = content.title || 'Chart'
  const width = 720
  const height = 360
  const padding = 48
  const palette = ['#7567d8', '#378add', '#1d9e75', '#d85a30', '#d4537e', '#c58d35']

  function barChartSvg() {
    const dataset = datasets[0] || { values: [] }
    const values = Array.isArray(dataset.values) ? dataset.values.map(Number) : []
    const max = Math.max(1, ...values, 0)
    const barWidth = labels.length ? (width - padding * 2) / labels.length : 0
    const bars = values.map((value, index) => {
      const barHeight = ((value / max) * (height - padding * 2)) || 0
      const x = padding + index * barWidth + barWidth * 0.15
      const y = height - padding - barHeight
      const w = barWidth * 0.7
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${palette[index % palette.length]}" rx="4"></rect>
        <text x="${(x + w / 2).toFixed(1)}" y="${(height - padding + 18).toFixed(1)}" text-anchor="middle" font-size="12" fill="currentColor">${escapeHtml(labels[index] || '')}</text>`
    }).join('')
    return `<svg viewBox="0 0 ${width} ${height + 24}" width="${width}" height="${height + 24}" role="img" aria-label="${escapeHtml(title)}">${bars}</svg>`
  }

  function lineChartSvg() {
    const dataset = datasets[0] || { values: [] }
    const values = Array.isArray(dataset.values) ? dataset.values.map(Number) : []
    const max = Math.max(1, ...values, 0)
    const stepX = labels.length > 1 ? (width - padding * 2) / (labels.length - 1) : 0
    const points = values.map((value, index) => {
      const x = padding + index * stepX
      const y = height - padding - ((value / max) * (height - padding * 2))
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    const labelsSvg = labels.map((label, index) => {
      const x = padding + index * stepX
      return `<text x="${x.toFixed(1)}" y="${(height - padding + 18).toFixed(1)}" text-anchor="middle" font-size="12" fill="currentColor">${escapeHtml(label)}</text>`
    }).join('')
    return `<svg viewBox="0 0 ${width} ${height + 24}" width="${width}" height="${height + 24}" role="img" aria-label="${escapeHtml(title)}"><polyline fill="none" stroke="${palette[0]}" stroke-width="3" points="${points}"></polyline>${labelsSvg}</svg>`
  }

  function pieChartSvg() {
    const dataset = datasets[0] || { values: [] }
    const values = Array.isArray(dataset.values) ? dataset.values.map(Number) : []
    const total = values.reduce((sum, value) => sum + value, 0) || 1
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) / 2 - padding
    let angle = -Math.PI / 2
    const slices = values.map((value, index) => {
      const slice = (value / total) * Math.PI * 2
      const x1 = cx + radius * Math.cos(angle)
      const y1 = cy + radius * Math.sin(angle)
      angle += slice
      const x2 = cx + radius * Math.cos(angle)
      const y2 = cy + radius * Math.sin(angle)
      const large = slice > Math.PI ? 1 : 0
      return `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${palette[index % palette.length]}"></path>`
    }).join('')
    const legend = labels.map((label, index) => `<text x="16" y="${(24 + index * 18).toFixed(1)}" font-size="12" fill="currentColor">${escapeHtml(label)} (${values[index] ?? 0})</text>`).join('')
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(title)}">${slices}${legend}</svg>`
  }

  let svg = barChartSvg()
  if (chartType === 'line') svg = lineChartSvg()
  if (chartType === 'pie') svg = pieChartSvg()

  const html = wrapPreviewDocument(
    title,
    `<h1>${escapeHtml(title)}</h1>${content.caption ? `<p class="caption">${escapeHtml(content.caption)}</p>` : ''}<div class="chart-wrap">${svg}</div>`
  )
  return { previewHtml: html, downloadExt: 'html', mimeType: 'text/html', payload: content }
}

function generateGraphArtifact(content = {}) {
  const nodes = Array.isArray(content.nodes) ? content.nodes : []
  const edges = Array.isArray(content.edges) ? content.edges : []
  const title = content.title || 'Graph'
  const width = 760
  const height = 420
  const positions = new Map()
  const radius = Math.min(width, height) * 0.34
  const cx = width / 2
  const cy = height / 2
  nodes.forEach((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2
    positions.set(String(node.id), {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      label: node.label || node.id || ''
    })
  })
  const edgeSvg = edges.map(edge => {
    const from = positions.get(String(edge.from))
    const to = positions.get(String(edge.to))
    if (!from || !to) return ''
    return `<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="#8a97c8" stroke-width="2"></line>`
  }).join('')
  const nodeSvg = [...positions.entries()].map(([id, pos]) => {
    return `<g>
      <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="22" fill="#7567d8"></circle>
      <text x="${pos.x.toFixed(1)}" y="${(pos.y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#ffffff">${escapeHtml(String(pos.label).slice(0, 10))}</text>
      <title>${escapeHtml(id)}</title>
    </g>`
  }).join('')
  const html = wrapPreviewDocument(
    title,
    `<h1>${escapeHtml(title)}</h1>${content.caption ? `<p class="caption">${escapeHtml(content.caption)}</p>` : ''}<div class="graph-wrap"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(title)}">${edgeSvg}${nodeSvg}</svg></div>`
  )
  return { previewHtml: html, downloadExt: 'html', mimeType: 'text/html', payload: content }
}

function generateHtmlArtifact(content = {}) {
  const title = content.title || 'Document'
  const body = content.html || content.body || '<p>Empty artifact.</p>'
  const extraHead = content.css ? `<style>${content.css}</style>` : ''
  const html = wrapPreviewDocument(title, body, extraHead)
  return { previewHtml: html, downloadExt: 'html', mimeType: 'text/html' }
}

function generateLatexPreviewArtifact(content = {}) {
  const title = content.title || 'LaTeX document'
  const source = String(content.source || content.latex || '').trim()
  const escaped = escapeHtml(source)
  const html = wrapPreviewDocument(
    title,
    `<h1>${escapeHtml(title)}</h1>
     <p class="caption">Preview shows rendered math where possible; download the .tex source to compile locally.</p>
     <pre style="white-space:pre-wrap;overflow:auto;background:rgba(127,136,180,0.08);padding:16px;border-radius:10px;border:1px solid var(--border);">${escaped}</pre>`,
    `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
     <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
     <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
     <script>
       document.addEventListener('DOMContentLoaded', () => {
         if (window.renderMathInElement) {
           window.renderMathInElement(document.body, {
             delimiters: [
               { left: '$$', right: '$$', display: true },
               { left: '$', right: '$', display: false },
               { left: '\\\\(', right: '\\\\)', display: false },
               { left: '\\\\[', right: '\\\\]', display: true }
             ]
           });
         }
       });
     </script>`
  )
  return {
    previewHtml: html,
    downloadExt: 'tex',
    mimeType: 'application/x-tex',
    payload: { source }
  }
}

function writePreviewFile(dir, filename, html) {
  const previewPath = path.join(dir, filename)
  fs.writeFileSync(previewPath, html, 'utf8')
  return previewPath
}

function generateFlashcardArtifact(content = {}) {
  const {
    buildDeckPayload,
    exportAnkiTsv,
    exportQuizletCsv
  } = require('./artifact-graph-flashcards')

  const deck = buildDeckPayload(content)
  const title = content.title || deck.title || 'Flashcards'
  const cardsJson = JSON.stringify(deck.cards || []).replace(/</g, '\\u003c')
  const deckMeta = JSON.stringify(deck.meta || {}).replace(/</g, '\\u003c')

  const body = `
    <header class="fc-header">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="caption" id="fc-caption">${deck.cards.length} cards · ${escapeHtml(deck.courseId || 'Course deck')}</p>
      </div>
      <div class="fc-header-actions">
        <label class="fc-select-wrap">
          <span>Deck</span>
          <select id="fc-deck-filter" aria-label="Filter deck">
            <option value="">All decks</option>
            ${(deck.decks || []).map(item => `<option value="${escapeHtml(item.label)}">${escapeHtml(item.label)} (${item.count})</option>`).join('')}
          </select>
        </label>
        <button type="button" class="fc-btn fc-btn-ghost" id="fc-shuffle">Shuffle</button>
      </div>
    </header>

    <div class="fc-progress" aria-hidden="true">
      <div class="fc-progress-fill" id="fc-progress"></div>
    </div>
    <p class="fc-stats" id="fc-stats">Card 1 of ${deck.cards.length}</p>

    <div class="fc-stage" id="fc-stage">
      <button type="button" class="fc-card" id="fc-card" aria-live="polite">
        <span class="fc-card-label" id="fc-side-label">Term</span>
        <span class="fc-card-text" id="fc-card-text">${deck.cards.length ? escapeHtml(deck.cards[0].front) : 'No cards yet.'}</span>
        <span class="fc-card-hint" id="fc-card-hint"></span>
        <span class="fc-card-source" id="fc-card-source"></span>
      </button>
    </div>

    <div class="fc-actions" id="fc-actions">
      <button type="button" class="fc-btn fc-btn-secondary" id="fc-prev" aria-label="Previous card">←</button>
      <button type="button" class="fc-btn fc-btn-primary" id="fc-flip">Show answer <kbd>Space</kbd></button>
      <button type="button" class="fc-btn fc-btn-secondary" id="fc-next" aria-label="Next card">→</button>
    </div>

    <div class="fc-grade-row" id="fc-grade-row" hidden>
      <button type="button" class="fc-btn fc-btn-bad" id="fc-learning">Still learning <kbd>2</kbd></button>
      <button type="button" class="fc-btn fc-btn-good" id="fc-know">Know it <kbd>1</kbd></button>
    </div>

    <p class="fc-footnote">Inspired by spaced-review apps — cards are grounded in your Canvas graph (concepts, details, examples, problems, learning blocks). Download the deck for Anki/Quizlet import.</p>
  `

  const extraHead = `
    <style>
      .fc-header { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap; }
      .fc-header-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      .fc-select-wrap { display:flex; flex-direction:column; gap:4px; font-size:11px; color:var(--muted); }
      .fc-select-wrap select { border:1px solid var(--border); border-radius:8px; padding:6px 10px; background:var(--surface); color:var(--text); }
      .fc-progress { height:6px; background:rgba(127,136,180,0.15); border-radius:999px; overflow:hidden; margin:12px 0 8px; }
      .fc-progress-fill { height:100%; width:0%; background:linear-gradient(90deg,#7567d8,#378add); transition:width .2s ease; }
      .fc-stats { font-size:12px; color:var(--muted); margin:0 0 12px; }
      .fc-stage { perspective:1200px; min-height:260px; display:flex; align-items:center; justify-content:center; }
      .fc-card {
        width:min(100%, 640px); min-height:220px; border:1px solid var(--border); border-radius:18px;
        background:linear-gradient(180deg, rgba(117,103,216,0.08), rgba(117,103,216,0.02));
        box-shadow:0 16px 40px rgba(20,28,60,0.08); padding:28px 24px; text-align:center;
        cursor:pointer; transition:transform .35s ease, box-shadow .2s ease; position:relative;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
      }
      .fc-card.is-flipped { transform: rotateY(180deg); }
      .fc-card-label { font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:700; }
      .fc-card-text { font-size:22px; line-height:1.35; font-weight:650; max-width:100%; word-break:break-word; }
      .fc-card-hint { font-size:13px; color:var(--muted); }
      .fc-card-source { font-size:11px; color:var(--muted); margin-top:4px; }
      .fc-actions, .fc-grade-row { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:16px; }
      .fc-btn { border:1px solid var(--border); border-radius:999px; padding:10px 16px; font-size:13px; font-weight:600; cursor:pointer; background:var(--surface); color:var(--text); }
      .fc-btn-primary { background:#7567d8; border-color:#7567d8; color:#fff; }
      .fc-btn-secondary { background:transparent; }
      .fc-btn-ghost { background:rgba(127,136,180,0.08); }
      .fc-btn-good { background:#1d9e75; border-color:#1d9e75; color:#fff; }
      .fc-btn-bad { background:#d4537e; border-color:#d4537e; color:#fff; }
      .fc-btn kbd { font-size:10px; opacity:.75; margin-left:6px; }
      .fc-footnote { font-size:12px; color:var(--muted); margin-top:18px; }
      .fc-done { text-align:center; padding:32px 12px; }
      .fc-done h2 { margin-bottom:8px; }
    </style>
    <script>
      document.addEventListener('DOMContentLoaded', () => {
        const ALL_CARDS = ${cardsJson};
        const META = ${deckMeta};
        let queue = ALL_CARDS.slice();
        let index = 0;
        let flipped = false;
        let know = 0;
        let learning = 0;

        const cardEl = document.getElementById('fc-card');
        const cardText = document.getElementById('fc-card-text');
        const cardHint = document.getElementById('fc-card-hint');
        const cardSource = document.getElementById('fc-card-source');
        const sideLabel = document.getElementById('fc-side-label');
        const stats = document.getElementById('fc-stats');
        const progress = document.getElementById('fc-progress');
        const flipBtn = document.getElementById('fc-flip');
        const gradeRow = document.getElementById('fc-grade-row');
        const deckFilter = document.getElementById('fc-deck-filter');
        const stage = document.getElementById('fc-stage');

        function current() { return queue[index] || null; }

        function sourceLine(card) {
          if (!card || !card.graph) return '';
          const g = card.graph;
          const bits = [g.nodeType, g.conceptId, g.nodeRef].filter(Boolean);
          return bits.join(' · ');
        }

        function render() {
          const card = current();
          if (!card) {
            stage.innerHTML = '<div class="fc-done"><h2>Session complete</h2><p>Know it: ' + know + ' · Still learning: ' + learning + '</p></div>';
            document.getElementById('fc-actions').hidden = true;
            gradeRow.hidden = true;
            stats.textContent = 'Finished';
            progress.style.width = '100%';
            return;
          }
          flipped = false;
          cardEl.classList.remove('is-flipped');
          sideLabel.textContent = 'Term';
          cardText.textContent = card.front || '';
          cardHint.textContent = card.hint || '';
          cardSource.textContent = sourceLine(card);
          flipBtn.textContent = 'Show answer';
          gradeRow.hidden = true;
          stats.textContent = 'Card ' + (index + 1) + ' of ' + queue.length + ' · Know ' + know + ' · Learning ' + learning;
          progress.style.width = queue.length ? (((index) / queue.length) * 100).toFixed(1) + '%' : '0%';
        }

        function flip() {
          const card = current();
          if (!card) return;
          flipped = !flipped;
          cardEl.classList.toggle('is-flipped', flipped);
          if (flipped) {
            sideLabel.textContent = 'Definition';
            cardText.textContent = card.back || '';
            flipBtn.textContent = 'Show term';
            gradeRow.hidden = false;
          } else {
            sideLabel.textContent = 'Term';
            cardText.textContent = card.front || '';
            flipBtn.textContent = 'Show answer';
            gradeRow.hidden = true;
          }
        }

        function grade(kind) {
          if (kind === 'know') know += 1; else learning += 1;
          index += 1;
          render();
        }

        function shuffleArray(list) {
          for (let i = list.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
          }
          return list;
        }

        cardEl.addEventListener('click', flip);
        flipBtn.addEventListener('click', flip);
        document.getElementById('fc-prev').addEventListener('click', () => { if (index > 0) { index -= 1; render(); } });
        document.getElementById('fc-next').addEventListener('click', () => { if (index < queue.length - 1) { index += 1; render(); } });
        document.getElementById('fc-know').addEventListener('click', () => grade('know'));
        document.getElementById('fc-learning').addEventListener('click', () => grade('learning'));
        document.getElementById('fc-shuffle').addEventListener('click', () => {
          queue = shuffleArray(queue.slice());
          index = 0;
          know = 0;
          learning = 0;
          render();
        });
        deckFilter.addEventListener('change', () => {
          const value = deckFilter.value;
          queue = value ? ALL_CARDS.filter(card => card.deck === value) : ALL_CARDS.slice();
          index = 0;
          know = 0;
          learning = 0;
          render();
        });
        document.addEventListener('keydown', (event) => {
          if (event.target && ['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)) return;
          if (event.code === 'Space') { event.preventDefault(); flip(); }
          if (event.key === '1') grade('know');
          if (event.key === '2') grade('learning');
          if (event.key === 'ArrowRight') { if (index < queue.length - 1) { index += 1; render(); } }
          if (event.key === 'ArrowLeft') { if (index > 0) { index -= 1; render(); } }
        });
        render();
      });
    </script>
  `

  const html = wrapPreviewDocument(title, body, extraHead)
  return {
    previewHtml: html,
    downloadExt: 'json',
    mimeType: 'application/json',
    payload: deck,
    exports: {
      ankiTsv: exportAnkiTsv(deck.cards),
      quizletCsv: exportQuizletCsv(deck.cards)
    }
  }
}

function generateInProcessArtifact(type, content) {
  switch (type) {
    case 'table':
      return generateTableArtifact(content)
    case 'chart':
      return generateChartArtifact(content)
    case 'graph':
      return generateGraphArtifact(content)
    case 'html':
      return generateHtmlArtifact(content)
    case 'latex':
      return generateLatexPreviewArtifact(content)
    case 'flashcards':
      return generateFlashcardArtifact(content)
    default:
      throw new Error(`No in-process generator for type: ${type}`)
  }
}

module.exports = {
  escapeHtml,
  wrapPreviewDocument,
  generateTableArtifact,
  generateChartArtifact,
  generateGraphArtifact,
  generateHtmlArtifact,
  generateLatexPreviewArtifact,
  generateFlashcardArtifact,
  generateInProcessArtifact,
  writePreviewFile
}
