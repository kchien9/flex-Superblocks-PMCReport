/**
 * Wraps an array of slide objects (html + js) into a full HTML document
 * with the proper Flask-style deck shell: scaled viewport, slide-by-slide
 * navigation, stat toggles, fullscreen present mode, and per-slide hide buttons.
 */

interface SlideData {
  key: string;
  html: string;
  js: string;
}

interface WrapOptions {
  defaultHiddenSlides?: number[];
  pdfFilename?: string;
}

export function wrapSlidesHtml(slides: SlideData[], options?: WrapOptions): string {
  const n = slides.length;
  const slideHtmlParts = slides.map((s) => s.html).join("\n");
  const slideJsParts = slides.map((s) => s.js).filter(Boolean).join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2"></script>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<title>Deck</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Lexend', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1a1625;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
  }
  .deck-viewport {
    position: absolute;
    inset: 0;
    bottom: 48px;
    overflow: hidden;
  }
  .deck {
    width: 1280px;
    height: 720px;
    position: absolute;
  }
  .slide {
    width: 1280px;
    height: 720px;
    padding: 40px 64px 48px;
    display: none;
    position: relative;
    font-family: 'Lexend', sans-serif;
    overflow: hidden;
    flex-direction: column;
    justify-content: flex-start;
  }
  .slide.active { display: flex; }
  .slide > * { max-width: 100%; }
  .slide-label { font-size: 11px; font-weight: 600; color: #8D70EE; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 8px; }
  .slide-title { font-size: 34px; font-weight: 700; color: #1D1D1D; line-height: 1.15; letter-spacing: -0.02em; }
  .slide-subtitle { font-size: 13px; color: #a09cb0; margin-top: 8px; line-height: 1.5; }
  .slide-header { margin-bottom: 20px; }
  .chart-wrap { position: relative; flex: 1; min-height: 200px; }

  /* Peer column toggle buttons */
  .peer-col-toggle {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px; border-radius: 5px;
    border: 1px solid #e5e7eb; background: rgba(255,255,255,0.9);
    color: #6b7280; font-size: 9px; font-weight: 600; cursor: pointer;
    font-family: 'Lexend', sans-serif; letter-spacing: 0.03em; transition: all 0.12s;
  }
  .peer-col-toggle:hover { background: #f9f5ff; color: #6A3DB8; border-color: #6A3DB8; }
  .peer-col-toggle.is-active { border-color: #6A3DB8; background: #f3f0ff; color: #6A3DB8; }

  /* Per-slide hide button */
  .slide-hide-btn {
    position: absolute; top: 10px; right: 10px; z-index: 50;
    padding: 4px 10px; border-radius: 5px;
    border: 1px solid #e5e7eb;
    background: rgba(255,255,255,0.92);
    color: #9ca3af; font-size: 10px; font-weight: 600; cursor: pointer;
    font-family: 'Lexend', sans-serif; letter-spacing: 0.04em;
    backdrop-filter: blur(4px); transition: all 0.12s;
  }
  .slide-hide-btn:hover { background: #f9f5ff; color: #6A3DB8; border-color: #6A3DB8; }
  .slide-hide-btn.is-hidden { background: #fee2e2; color: #dc5050; border-color: #fca5a5; }
  .slide.slide-excluded { opacity: 0.35; outline: 2px solid #dc5050; }
  :fullscreen .slide-hide-btn, :-webkit-full-screen .slide-hide-btn { display: none !important; }
  :fullscreen .slide.slide-excluded, :-webkit-full-screen .slide.slide-excluded { opacity: 1; outline: none; }
  :fullscreen .presenter-control, :-webkit-full-screen .presenter-control { display: none !important; }

  /* Footer control bar */
  .footer-bar {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    height: 48px;
    background: #0f0b1a;
    border-top: 1px solid rgba(255,255,255,0.06);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 20px;
    gap: 10px;
    z-index: 100;
  }
  :fullscreen .footer-bar, :-webkit-full-screen .footer-bar { display: none; }
  .action-btn {
    display: flex; align-items: center; gap: 5px;
    padding: 5px 10px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #9896a4; font-family: 'Lexend', sans-serif;
    font-size: 11px; cursor: pointer; transition: all 0.15s;
    white-space: nowrap;
  }
  .action-btn:hover { background: rgba(255,255,255,0.14); color: #fff; border-color: rgba(255,255,255,0.28); }
  .action-btn.is-active { background: #6A3DB8; color: #fff; border-color: #6A3DB8; }
  .stat-toggle-bar { display: flex; gap: 4px; }
  .slide-counter { font-size: 12px; color: #9896a4; margin-left: 4px; }
  .flex-wordmark { font-size: 22px; font-weight: 800; letter-spacing: -0.04em; color: #6A3DB8; line-height: 1; margin-left: 8px; }
  .separator { width: 1px; height: 20px; background: rgba(255,255,255,0.1); margin: 0 4px; }

  @media print {
    body { background: #fff; }
    .deck-viewport, .deck { position: static !important; transform: none !important; width: auto !important; height: auto !important; }
    .slide { display: flex !important; position: relative !important; transform: none !important; width: 100% !important; height: auto !important; min-height: 720px; page-break-after: always; }
    .footer-bar { display: none; }
  }
</style>
</head>
<body>
  <div class="deck-viewport" id="deckViewport">
    <div class="deck" id="deck">
      ${slideHtmlParts}
    </div>
  </div>

  <div class="footer-bar">
    <div class="presenter-control stat-toggle-bar" id="statToggleBar">
      <button class="action-btn stat-toggle-btn is-active" data-mode="median" onclick="flexSetStatMode('median')">Median</button>
      <button class="action-btn stat-toggle-btn" data-mode="avg" onclick="flexSetStatMode('avg')">Average</button>
      <button class="action-btn stat-toggle-btn" data-mode="top" onclick="flexSetStatMode('top')">Top 25%</button>
    </div>
    <div class="separator"></div>
    <button class="action-btn" id="fsBtn" onclick="toggleFs()">&#x26F6; Present</button>
    <span class="slide-counter" id="counter">1 / ${n}</span>
    <span class="flex-wordmark">flex</span>
  </div>

  <script>
    Chart.register(ChartDataLabels);
    var current = 1;
    var total = ${n};

    // ── Stat mode toggle ──
    if (!window.flexSetStatMode) {
      window.flexStatMode = 'median';
      window.flexSetStatMode = function(mode) {
        window.flexStatMode = mode;
        document.querySelectorAll('.stat-toggle-value').forEach(function(el) {
          if (el.dataset[mode] !== undefined) el.textContent = el.dataset[mode];
        });
        document.querySelectorAll('.stat-toggle-label').forEach(function(el) {
          var key = mode + 'Label';
          if (el.dataset[key] !== undefined) el.textContent = el.dataset[key];
        });
        document.querySelectorAll('.stat-toggle-btn').forEach(function(btn) {
          btn.classList.toggle('is-active', btn.dataset.mode === mode);
        });
        document.querySelectorAll('.stat-toggle-group').forEach(function(el) {
          el.style.display = (el.dataset.mode === mode) ? '' : 'none';
        });
      };
    }

    // ── Slide hide/show system ──
    var HIDE_KEY = '${options?.pdfFilename ? "flex_hidden_" + options.pdfFilename.replace(/'/g, "") : ""}';
    var DEFAULT_HIDDEN_SLIDES = ${JSON.stringify(options?.defaultHiddenSlides || [])};
    var _storedHidden = HIDE_KEY ? localStorage.getItem(HIDE_KEY) : null;
    var hiddenSlides = new Set(_storedHidden !== null ? JSON.parse(_storedHidden) : DEFAULT_HIDDEN_SLIDES);
    function saveHidden() { if (HIDE_KEY) localStorage.setItem(HIDE_KEY, JSON.stringify([...hiddenSlides])); }
    if (_storedHidden === null && DEFAULT_HIDDEN_SLIDES.length && HIDE_KEY) saveHidden();
    function visibleSlides() {
      var v = [];
      for (var i = 1; i <= total; i++) if (!hiddenSlides.has(i)) v.push(i);
      return v;
    }
    function updateCounter() {
      var hidden = hiddenSlides.size;
      document.getElementById('counter').textContent = current + ' / ' + total + (hidden ? ' \\u00B7 ' + hidden + ' hidden' : '');
    }
    function toggleHide(n) {
      if (hiddenSlides.has(n)) {
        hiddenSlides.delete(n);
      } else {
        hiddenSlides.add(n);
        if (current === n) {
          var vis = visibleSlides();
          if (vis.length > 0) showSlide(vis.reduce(function(a, b) { return Math.abs(b - n) < Math.abs(a - n) ? b : a; }));
        }
      }
      saveHidden();
      refreshHideButtons();
      updateCounter();
    }
    function refreshHideButtons() {
      document.querySelectorAll('.slide').forEach(function(slide) {
        var num = parseInt(slide.id.replace('slide-', ''));
        var btn = slide.querySelector('.slide-hide-btn');
        if (!btn) return;
        var hidden = hiddenSlides.has(num);
        slide.classList.toggle('slide-excluded', hidden);
        btn.classList.toggle('is-hidden', hidden);
        btn.textContent = hidden ? 'Show' : 'Hide';
        btn.title = hidden ? 'Click to include in presentation' : 'Click to skip in presentation';
      });
    }
    document.querySelectorAll('.slide').forEach(function(slide) {
      var num = parseInt(slide.id.replace('slide-', ''));
      if (isNaN(num)) return;
      var btn = document.createElement('button');
      btn.className = 'slide-hide-btn';
      btn.textContent = 'Hide';
      btn.title = 'Click to skip in presentation';
      btn.addEventListener('click', function(e) { e.stopPropagation(); toggleHide(num); });
      slide.appendChild(btn);
    });

    // ── Slide navigation ──
    function showSlide(n) {
      current = n;
      document.querySelectorAll('.slide').forEach(function(s) { s.classList.remove('active'); });
      var el = document.getElementById('slide-' + n);
      if (el) el.classList.add('active');
      updateCounter();
      if (window['initSlide' + n]) { try { window['initSlide' + n](); } catch(e) {} }
    }
    function navigate(dir) {
      if (document.fullscreenElement) {
        var vis = visibleSlides();
        if (!vis.length) return;
        var idx = vis.indexOf(current);
        var next = idx + dir;
        if (next >= 0 && next < vis.length) showSlide(vis[next]);
      } else {
        var next2 = current + dir;
        if (next2 >= 1 && next2 <= total) showSlide(next2);
      }
    }

    // ── Viewport scaling ──
    function fitSlides() {
      var vp = document.getElementById('deckViewport');
      if (!vp) return;
      var scale = Math.min(vp.offsetWidth / 1280, vp.offsetHeight / 720);
      var left = Math.max(0, (vp.offsetWidth - 1280 * scale) / 2);
      var top = Math.max(0, (vp.offsetHeight - 720 * scale) / 2);
      var deck = document.getElementById('deck');
      deck.style.transform = 'scale(' + scale + ')';
      deck.style.transformOrigin = 'top left';
      deck.style.left = left + 'px';
      deck.style.top = top + 'px';
      deck.style.position = 'absolute';
    }

    // ── Fullscreen present mode ──
    function toggleFs() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(function() {
          document.getElementById('fsBtn').innerHTML = '&#x2715; Exit';
        }).catch(function() {});
      } else {
        document.exitFullscreen();
      }
    }
    document.addEventListener('fullscreenchange', function() {
      if (!document.fullscreenElement) {
        document.getElementById('fsBtn').innerHTML = '&#x26F6; Present';
      }
      fitSlides();
      updateCounter();
    });

    // ── Keyboard nav ──
    document.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigate(+1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') navigate(-1);
      if (e.key === 'f' || e.key === 'F') toggleFs();
    });

    // ── Peer column toggle buttons ──
    document.querySelectorAll('.peer-col-toggle').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var col = btn.getAttribute('data-col');
        var tableId = btn.getAttribute('data-table');
        var table = document.getElementById(tableId);
        if (!table || !col) return;
        table.classList.toggle(col);
        var hidden = table.classList.contains(col);
        btn.classList.toggle('is-active', hidden);
        var label = col.replace('hide-', '');
        btn.textContent = hidden ? 'Show ' + label : 'Hide ' + label;
      });
    });

  </script>

  ${slideJsParts}

  <script>
    // ── Init (after slide JS has loaded) ──
    fitSlides();
    window.addEventListener('resize', fitSlides);
    refreshHideButtons();
    showSlide(1);
    // Re-fit after fonts load and layout settles
    setTimeout(fitSlides, 100);
    setTimeout(fitSlides, 500);
    if (document.fonts) document.fonts.ready.then(fitSlides);
  </script>
</body>
</html>`;
}
