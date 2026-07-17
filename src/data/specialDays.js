// Data for the server-rendered /special-days view: special_day_types and the
// upcoming/assigned special_day_dates with their type name denormalized in.
function getSpecialDaysData(db) {
  const types = db.prepare('SELECT * FROM special_day_types ORDER BY name').all();
  const dates = db
    .prepare(
      `SELECT sdd.date, sdd.special_day_type_id, sdt.name AS type_name
       FROM special_day_dates sdd JOIN special_day_types sdt ON sdt.id = sdd.special_day_type_id
       ORDER BY sdd.date`
    )
    .all();
  return { types, dates };
}

module.exports = { getSpecialDaysData };
