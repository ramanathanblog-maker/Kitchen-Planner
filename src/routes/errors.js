class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Express error-handling middleware (4-arg signature required by Express to be
// recognized as such). Converts ApiError into its {status, message} JSON shape;
// anything else (including raw SQLite CHECK-constraint errors that slipped past
// our own domain validation) becomes a generic 400 rather than a 500 + stack trace,
// since almost all of them are client input problems in this app.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  if (/CHECK constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed|UNIQUE constraint failed/.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err); // eslint-disable-line no-console
  res.status(500).json({ error: 'internal_error' });
}

// Error-handling middleware for the HTML page routes (Today/Plan/wizard/etc — see
// src/app.js), as opposed to errorHandler above for /api's JSON responses. Only
// currently-thrown case that reaches this in practice is
// MealPatternsFormatError (src/data/mealPatterns.js) when the meal_patterns
// settings value is malformed JSON — a visible "something's wrong" page is the
// correct failure mode for a household member mid-planning, not a raw stack
// trace (Audit 2026-07-18, code #5).
function pageErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err); // eslint-disable-line no-console
  const message = err.status && err.status < 500
    ? err.message
    : 'Something went wrong loading this page. Please tell PK.';
  res.status(err.status || 500).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Something went wrong — Kitchen Knowledge Planner</title><link rel="stylesheet" href="/theme.css"></head>
<body><main><h1>Something went wrong</h1><p>${message.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p>
<p><a class="btn" href="/">Back to Today</a></p></main></body></html>`);
}

module.exports = { ApiError, errorHandler, pageErrorHandler };
