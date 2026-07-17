const { openDb } = require('./src/db/connection');
const { migrate } = require('./src/db/migrate');
const { createApp } = require('./src/app');

const PORT = process.env.KITCHEN_PORT || 3010;

const db = openDb();
migrate(db);

const app = createApp(db);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Kitchen Knowledge Planner listening on :${PORT}`);
  });
}

module.exports = { app, db };
