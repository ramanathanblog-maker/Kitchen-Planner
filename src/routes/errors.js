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
  if (/CHECK constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed/.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err); // eslint-disable-line no-console
  res.status(500).json({ error: 'internal_error' });
}

module.exports = { ApiError, errorHandler };
