// Overlay (floating widget) BrowserWindow options, extracted for testability.
// The widget is a pill drawn on a transparent window: it must be frameless,
// fully transparent, and shadowless. Without hasShadow:false the OS draws a
// rectangular drop shadow around the window, visible as square fringes at
// the corners on light backgrounds.
function buildOverlayWindowOptions({ preloadPath, iconPath }) {
  return {
    width: 200,
    height: 46,
    minWidth: 140,
    minHeight: 42,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    show: true,
    title: 'KimFlow',
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}

module.exports = { buildOverlayWindowOptions };
