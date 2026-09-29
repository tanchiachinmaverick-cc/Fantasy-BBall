# Punt Draft Assistant

Static, dependency-free app: check off players you draft, mark ones others took, and get
recommendations for a chosen punt build (FT%, FG%, AST, TO, 3PM, PTS, REB, STL, BLK, plus
FT%+AST, FG%+TO, REB+BLK). Open `index.html` in a browser; state is kept in localStorage.

## Data
Copy the projections table from hashtagbasketball.com (or export CSV) and paste it into the app.
Required columns: PLAYER, FG%, FT%, 3PM, PTS, REB/TREB, AST, STL, BLK, TO. FGA/FTA columns (or
"0.485 (11.2)" / "5.2/10.1" style cells) make FG%/FT% accurate; otherwise attempts are estimated
from points and a warning is shown. The bundled sample is synthetic, not real projections.
The importer was written without access to the live site's markup, so verify with a real paste.

## Method
- z-score per category vs. the top (teams x roster spots) players; FG%/FT% use volume-weighted impact; TO inverted.
- Recommendation score = sum over non-punted cats of weight x z, where weight is up to +/-50% by how far
  your roster's total in that cat lags your active-cat average (heuristic).
- Ignores position/roster-slot constraints, injuries, and ADP/draft-position value.

Tests: `node --test core.test.js`
