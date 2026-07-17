// CLI debugging harness: node src/engine/explain.js <dish_item_id> <date> <slot>
// Prints the findings trail for one evaluation. This becomes the UI's "why" display
// data source in a later phase — the UI must render these findings verbatim, not
// re-derive its own logic (per build-prompt Phase 4 GATE).
const { openDb } = require('../db/connection');
const { buildContext } = require('./context');
const { evaluate } = require('./evaluate');

function main() {
  const [, , dishItemIdArg, date, slot] = process.argv;
  if (!dishItemIdArg || !date || !slot) {
    console.error('Usage: node src/engine/explain.js <dish_item_id> <date YYYY-MM-DD> <slot morning|noon|night>');
    process.exit(1);
  }
  const dishItemId = Number(dishItemIdArg);
  const db = openDb();
  const context = buildContext(db, { dishItemId, date, slot });
  const result = evaluate(context);

  console.log(`Dish:   ${context.dish.name_en} (${context.dish.family_name})`);
  console.log(`Date:   ${date}   Slot: ${slot}`);
  console.log(`Status: ${result.status.toUpperCase()}`);
  console.log('Findings:');
  if (result.findings.length === 0) {
    console.log('  (none)');
  } else {
    for (const f of result.findings) {
      console.log(`  [${f.severity.toUpperCase()}] (${f.step}) ${f.message}${f.rule_ref ? `  <${f.rule_ref}>` : ''}`);
    }
  }
  db.close();
}

if (require.main === module) main();

module.exports = { main };
