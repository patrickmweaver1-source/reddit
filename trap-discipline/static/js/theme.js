// Appearance: light / dark / match the computer, and a colour palette. Loaded in <head> before the
// page paints so it never flashes the wrong theme. Stored per device (a phone can differ from the laptop).
(function () {
  var MODES = ['light', 'dark', 'system'];
  var PALETTES = ['classic', 'ocean', 'forest', 'sunset', 'grape', 'contrast'];
  var BAR = { light: '#f4f6f9', dark: '#06090f' };
  function read(k, d, ok) { try { var v = localStorage.getItem(k); return ok.indexOf(v) >= 0 ? v : d; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: this visit only */ } }
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var mode = read('trap.mode', 'light', MODES);
  var palette = read('trap.palette', 'classic', PALETTES);
  function apply() {
    var dark = mode === 'dark' || (mode === 'system' && mq && mq.matches);
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-palette', palette);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', BAR[dark ? 'dark' : 'light']);
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (mode === 'system') apply(); });
  apply();
  window.trapTheme = {
    modes: MODES, palettes: PALETTES,
    get: function () { return { mode: mode, palette: palette }; },
    set: function (m, p) {
      if (m && MODES.indexOf(m) >= 0) { mode = m; write('trap.mode', m); }
      if (p && PALETTES.indexOf(p) >= 0) { palette = p; write('trap.palette', p); }
      apply();
    },
  };
})();
