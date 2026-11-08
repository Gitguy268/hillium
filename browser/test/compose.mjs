// Test helper: a picture of a whole Hillium window without macOS screen-recording rights.
// Captures the toolbar page, the active tab and the assistant with capturePage and paints
// them in stacking order. Native glass is an OS layer, so it can't appear: transparent
// areas show a diagonal-stripe "desktop" instead, which also shows any CSS refraction.
// backdrop "plain" paints a soft neutral wash instead, for pictures in the README.
export async function composeWindow(app, which = 0, backdrop = "stripes") {
  const dataUrl = await app.evaluate(async ({ BrowserWindow }, [which, backdrop]) => {
    const shell = [...globalThis.__hillium.shells][which];
    const { width, height } = shell.win.getContentBounds();
    const parts = [];
    const add = async (view) => {
      const image = await view.webContents.capturePage();
      parts.push({ url: image.toDataURL(), ...view.getBounds() });
    };
    await add(shell.ui);
    const children = shell.win.contentView.children;
    for (const view of children) if (view !== shell.ui) await add(view);
    if (shell.overlay) await add(shell.ui); // the toolbar page is on top during overlays
    const painter = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } });
    await painter.loadURL("about:blank");
    const result = await painter.webContents.executeJavaScript(`(async () => {
      const parts = ${JSON.stringify(parts)};
      const c = document.createElement("canvas");
      c.width = ${width} * 2; c.height = ${height} * 2;
      const g = c.getContext("2d");
      g.scale(2, 2);
      if (${JSON.stringify(backdrop)} === "plain") {
        const wash = g.createLinearGradient(0, 0, ${width}, ${height});
        wash.addColorStop(0, "#dcd6f2"); wash.addColorStop(1, "#c9dcef");
        g.fillStyle = wash; g.fillRect(0, 0, ${width}, ${height});
      } else {
        g.fillStyle = "#3a6ea5"; g.fillRect(0, 0, ${width}, ${height});
        g.strokeStyle = "#f2c94c"; g.lineWidth = 6;
        for (let x = -${height}; x < ${width}; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + ${height}, ${height}); g.stroke(); }
      }
      for (const p of parts) {
        const img = new Image(); img.src = p.url; await img.decode();
        g.drawImage(img, p.x, p.y, p.width, p.height);
      }
      return c.toDataURL("image/png");
    })()`);
    painter.destroy();
    return result;
  }, [which, backdrop]);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}
