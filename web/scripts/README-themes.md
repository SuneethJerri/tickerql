# Theme palette validation

Every theme surface is checked with the dataviz validator on both pairlists.
Re-run these if a surface or a series colour changes.

`validate_palette.js` is **vendored here on purpose**. It is not a dependency of
the app and nothing imports it; it is checked in so the result below can be
reproduced from a clone. Pointing at a copy that lives somewhere else on one
machine would make this file a claim rather than a record.

```bash
V=web/scripts/validate_palette.js
LIGHT8="#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948"
DARK8="#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9,#e66767"

# adjacent pairlist — lines, bars, stacks. Caps at eight.
node $V "$LIGHT8" --mode light --surface "#fcfcfb"   # Light
node $V "$LIGHT8" --mode light --surface "#fbf6e9"   # Sepia
node $V "$DARK8"  --mode dark  --surface "#1a1a19"   # Dark
node $V "$DARK8"  --mode dark  --surface "#121826"   # Midnight
node $V "$DARK8"  --mode dark  --surface "#2c2c2e"   # Graphite

# all-pairs pairlist — scatter, small multiples. Caps at three.
node $V "#2a78d6,#eb6834,#1baf7a" --mode light --surface "#fcfcfb" --pairs all
node $V "#2a78d6,#eb6834,#1baf7a" --mode light --surface "#fbf6e9" --pairs all
node $V "#3987e5,#d95926,#199e70" --mode dark  --surface "#1a1a19" --pairs all
node $V "#3987e5,#d95926,#199e70" --mode dark  --surface "#121826" --pairs all
node $V "#3987e5,#d95926,#199e70" --mode dark  --surface "#2c2c2e" --pairs all
```

Result on 2026-08-22, re-run against the vendored copy: **all five surfaces PASS
both pairlists — 10 runs, 10 passes.** The light-mode contrast WARN (aqua,
yellow, magenta below 3:1) is the documented relief case, discharged by direct
labels and the table view, both already present.

Accent contrast against each surface, lowest first: Graphite/blue 3.83,
Sepia/blue 4.09, Sepia/orange 4.20 — all above the 3:1 UI floor.

## What is not validated here

- The **diverging pair** used by the correlation heatmap. The validator's scope
  is categorical palettes; a diverging scale is checked by different properties
  (two hues that read as opposite, a neutral midpoint, monotone lightness out
  from the middle), which is why the poles are asserted by eye against every
  theme in the screenshot pass instead.
- **Layout.** The validator reads colour and nothing else. Label collision and
  overflow are found by `web/scripts/screenshot.py`, which shoots every view in
  every theme at 1440px.
