function renderStyleguide() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Styleguide — Kitchen Knowledge Planner</title>
<link rel="stylesheet" href="/theme.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#3F6212">
</head>
<body>
<main>
  <h1>Styleguide</h1>
  <p>A5 design system components, rendered for review.</p>

  <section class="styleguide-section">
    <h2>Color tokens</h2>
    <div class="styleguide-swatches">
      <div class="swatch" style="background:var(--bg);color:var(--ink)">bg</div>
      <div class="swatch" style="background:var(--ink);color:#fff">ink</div>
      <div class="swatch" style="background:var(--accent);color:#fff">accent</div>
      <div class="swatch" style="background:var(--accent-tint);color:var(--accent)">accent-tint</div>
      <div class="swatch" style="background:var(--warn);color:#fff">warn</div>
      <div class="swatch" style="background:var(--warn-tint);color:var(--warn)">warn-tint</div>
      <div class="swatch" style="background:var(--blocked);color:#fff">blocked</div>
      <div class="swatch" style="background:var(--blocked-tint);color:var(--blocked)">blocked-tint</div>
      <div class="swatch" style="background:var(--info);color:#fff">info</div>
    </div>
  </section>

  <section class="styleguide-section">
    <h2>Dish cards</h2>
    <div class="dish-card">
      <span class="heaviness-dot heaviness-dot--light" title="light"></span>
      <div>
        <div class="dish-card__name">Rasam</div>
        <div class="dish-card__family">Rasam family</div>
      </div>
      <span class="chip chip--preferred">✓ preferred</span>
    </div>
    <div class="dish-card">
      <span class="heaviness-dot heaviness-dot--medium" title="medium"></span>
      <div>
        <div class="dish-card__name">Adai</div>
        <div class="dish-card__family">Tiffin family</div>
      </div>
      <span class="chip chip--allowed">• allowed</span>
    </div>
    <div class="dish-card">
      <span class="heaviness-dot heaviness-dot--heavy" title="heavy"></span>
      <div>
        <div class="dish-card__name">Kari</div>
        <div class="dish-card__family">Kari family</div>
      </div>
      <span class="chip chip--avoid">⚠ avoid</span>
    </div>
    <div class="dish-card">
      <span class="heaviness-dot heaviness-dot--heavy" title="heavy"></span>
      <div>
        <div class="dish-card__name">Drumstick Kari</div>
        <div class="dish-card__family">Kari family</div>
      </div>
      <span class="chip chip--blocked">✕ blocked</span>
    </div>
  </section>

  <section class="styleguide-section">
    <h2>Verdict chips</h2>
    <p>
      <span class="chip chip--preferred">✓ preferred</span>
      <span class="chip chip--allowed">• allowed</span>
      <span class="chip chip--avoid">⚠ avoid</span>
      <span class="chip chip--blocked">✕ blocked</span>
    </p>
  </section>

  <section class="styleguide-section">
    <h2>Slot header</h2>
    <div class="slot-header">
      <div>
        <div class="slot-header__label">Morning (Rice Meal)</div>
        <div class="slot-header__date">Thu, Jul 16</div>
      </div>
      <span class="slot-header__badge">Amavasai</span>
    </div>
  </section>

  <section class="styleguide-section">
    <h2>Buttons</h2>
    <p>
      <button class="btn">Secondary</button>
      <button class="btn btn-primary">Primary action</button>
    </p>
  </section>

  <section class="styleguide-section">
    <h2>Bottom sheet</h2>
    <div class="sheet-backdrop" style="position:relative;inset:auto;background:none;">
      <div class="sheet">
        <h2>Remember this?</h2>
        <p>Avoid carrot in kootu going forward?</p>
        <button class="btn btn-primary">Yes, teach this</button>
        <button class="btn">No thanks</button>
      </div>
    </div>
  </section>

  <section class="styleguide-section">
    <h2>Skeleton rows</h2>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
  </section>

  <section class="styleguide-section">
    <h2>Kiosk variant</h2>
    <div class="kiosk">
      <h1>Today</h1>
      <div class="dish-card">
        <span class="heaviness-dot heaviness-dot--light"></span>
        <div class="dish-card__name">Rasam</div>
        <span class="chip chip--preferred">✓ preferred</span>
      </div>
    </div>
  </section>
</main>

<nav class="tab-bar">
  <a class="tab-bar__item is-active" href="#">Today</a>
  <a class="tab-bar__item" href="#">Plan</a>
  <a class="tab-bar__item" href="#">Shopping</a>
  <a class="tab-bar__item" href="#">Knowledge</a>
</nav>
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>
</body>
</html>`;
}

module.exports = { renderStyleguide };
