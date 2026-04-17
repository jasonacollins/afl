# TODO

## CSP Style Cleanup

- Replace inline `style="display: none;"` usage in admin templates with CSS classes.
- Replace direct `.style.display = ...` toggles in `public/js/admin.js` and `public/js/admin-scripts.js` with class-based show/hide helpers.
- Remove inline HTML style fragments from `public/js/elo-chart.js` and move them to stylesheet-backed classes.
- Replace inline probability-cell styling in `public/js/simulation.js` with class-based styling or CSS custom properties.
- Remove `'unsafe-inline'` from `styleSrc` in `app.js` after the remaining inline-style paths are gone.
- Run the relevant JS app/browser tests after the CSP cleanup lands.
