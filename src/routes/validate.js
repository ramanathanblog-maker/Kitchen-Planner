// Mirrors the CHECK-constraint domains in /migrations, so writes get a friendly
// 400 with the allowed values instead of a raw SQLite error. Keep in sync with the
// migrations by hand — there is no single source of truth to generate this from
// without a schema-introspection layer, which would be over-engineering for v1's
// six writeable tables.
const { ApiError } = require('./errors');

const DOMAINS = {
  ingredient_category: [
    'vegetable', 'pulse', 'pulse_nut', 'nut', 'dal', 'grain', 'greens',
    'aromatic', 'spice', 'dairy', 'protein', 'fruit', 'other',
  ],
  heaviness: ['light', 'medium', 'heavy'],
  meal_role: [
    'main_gravy', 'secondary_gravy', 'semi_solid_side', 'dry_side', 'condiment',
    'salad', 'standalone', 'crisp_side', 'tiffin_main', 'tiffin_side', 'snack',
  ],
  verdict: ['preferred', 'allowed', 'avoid', 'never', 'unsure'],
  rationale_tag: ['texture_clash', 'traditional_restriction', 'flavor_overlap', 'dislike', 'allergy', 'other'],
  severity: ['hard', 'soft'],
  preference: ['prefers', 'avoid'],
  direction: ['morning_to_noon'],
  slot: ['morning', 'noon', 'night'],
  special_day_rule: ['allow', 'avoid', 'block'],
  bool: [0, 1],
  // A1 forward-compat hook: scope exists on the three rule tables for a future
  // person/guest model, but v1 restricts it to 'household' at the app layer —
  // deliberately NOT a CHECK constraint (A1 is explicit that the column itself is
  // the only v2 hook allowed; the schema must not encode v2 values as legal).
  // This domain is that restriction's actual enforcement point.
  scope: ['household'],
};

function assertInDomain(value, domainKey, field) {
  if (value === undefined || value === null) return;
  const domain = DOMAINS[domainKey];
  if (!domain.includes(value)) {
    throw new ApiError(400, `${field} must be one of: ${domain.join(', ')} (got ${JSON.stringify(value)})`);
  }
}

function assertRequired(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null) {
      throw new ApiError(400, `${f} is required`);
    }
  }
}

module.exports = { DOMAINS, assertInDomain, assertRequired };
