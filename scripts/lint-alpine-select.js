#!/usr/bin/env node
// Guardrail against the class of bug behind the P0 verdict-inversion incident
// (Audit 2026-07-18, code #1): a `<template x-for>` rendering `<option>`
// elements inside a `<select>` clones one shared piece of markup per row/entry,
// so there is nowhere to bake a per-instance `selected` attribute into it — the
// browser paints whichever option happens to be first, regardless of the real
// stored/intended value, until Alpine's own JS reactivity catches up (and for
// an admin editing an existing DB row, it never matches until you look at the
// DOM value directly). The fix, applied throughout src/views, is to render
// <option>s server-side (optionsHtml/optionsHtmlFor pattern in
// src/views/knowledge.js, or a plain .map().join() as in specialDays.js)
// instead of cloning them client-side via x-for.
//
// This script fails (exit 1) if any src/views/*.js file contains a
// `<template x-for="...">...</template>` block whose own markup includes an
// `<option` tag — that inner-content check is what distinguishes the real bug
// signature (options cloned via x-for) from a file that merely happens to use
// x-for elsewhere (e.g. a history list) and a <select> elsewhere too, which is
// fine and common. A plain string scan can't fully parse nested templates, so
// it matches non-greedily up to the first `</template>` — good enough to catch
// every instance actually written this way; a genuinely exotic nesting that
// defeats this would still be worth a human's eyes on, not a reason to skip
// the check.
const fs = require('node:fs');
const path = require('node:path');

const VIEWS_DIR = path.join(__dirname, '..', 'src', 'views');
const TEMPLATE_XFOR_RE = /<template\s+x-for[^>]*>([\s\S]*?)<\/template>/g;

// Strips JS comments so prose that happens to mention `<template x-for>` or
// `<option>` (as this very file's own comments do, describing the bug) doesn't
// false-positive. Good enough for this codebase's comment style (// and /* */,
// no comment-like sequences inside template-literal HTML strings); not a full
// JS tokenizer.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function main() {
  const files = fs.readdirSync(VIEWS_DIR).filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const file of files) {
    const contents = stripComments(fs.readFileSync(path.join(VIEWS_DIR, file), 'utf8'));
    let match;
    TEMPLATE_XFOR_RE.lastIndex = 0;
    while ((match = TEMPLATE_XFOR_RE.exec(contents))) {
      if (/<option[\s>]/.test(match[1])) {
        offenders.push({ file, snippet: match[0].slice(0, 80).replace(/\s+/g, ' ') });
      }
    }
  }
  if (offenders.length > 0) {
    console.error('lint-alpine-select: found <option> elements inside a <template x-for> — this is the pattern behind the P0 verdict-inversion bug (Audit 2026-07-18, code #1). Render <option>s server-side instead (see optionsHtml/optionsHtmlFor in src/views/knowledge.js).');
    for (const o of offenders) console.error(`  src/views/${o.file}: ${o.snippet}...`);
    process.exit(1);
  }
  console.log(`lint-alpine-select: ok (${files.length} view files checked, no <option> rendered via <template x-for>)`);
}

main();
