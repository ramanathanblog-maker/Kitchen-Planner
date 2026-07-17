// Pure grouping/limiting logic for the suggestion sheet (Plan page picker).
// Vendored as a plain script (no bundler, per CLAUDE.md A2) so the same file
// is both `<script src>`-included in the browser and `require()`-able from
// node:test without a DOM.
(function (root) {
  // Composition order for the rice-course slot; roles outside this list
  // (e.g. tiffin_main/tiffin_side/snack for the noon slot) are appended
  // after, in first-seen order, so nothing is ever dropped.
  var COMPOSITION_ORDER = [
    'main_gravy',
    'secondary_gravy',
    'semi_solid_side',
    'dry_side',
    'salad',
    'condiment',
    'crisp_side',
    'standalone',
  ];
  var TOP_N = 3;

  function groupSuggestions(suggestions) {
    var groups = {};
    var order = [];
    for (var i = 0; i < suggestions.length; i++) {
      var s = suggestions[i];
      var role = s.mealRole || 'standalone';
      if (!groups[role]) {
        groups[role] = [];
        order.push(role);
      }
      groups[role].push(s);
    }
    var roles = COMPOSITION_ORDER.filter(function (r) {
      return groups[r];
    }).concat(
      order.filter(function (r) {
        return COMPOSITION_ORDER.indexOf(r) === -1;
      })
    );
    return roles.map(function (role) {
      var items = groups[role];
      return {
        role: role,
        items: items,
        top: items.slice(0, TOP_N),
        hasMore: items.length > TOP_N,
      };
    });
  }

  var api = { groupSuggestions: groupSuggestions, COMPOSITION_ORDER: COMPOSITION_ORDER, TOP_N: TOP_N };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.groupSuggestions = groupSuggestions;
    root.SUGGESTION_COMPOSITION_ORDER = COMPOSITION_ORDER;
    root.SUGGESTION_TOP_N = TOP_N;
  }
})(typeof window !== 'undefined' ? window : globalThis);
