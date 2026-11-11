export function mountViewport(app, stage) {
  app.view = {
    zoom: 1,
    panX: 0,
    panY: 0,
    size: { w: stage.clientWidth, h: stage.clientHeight },
    pointer: { x: 0, y: 0, sx: 0, sy: 0, inside: false },
    docToScreen: (x, y) => ({ x, y }),
    screenToDoc: (sx, sy) => ({ x: sx, y: sy }),
    px: (n) => n,
    visibleRect: () => ({ x: 0, y: 0, w: stage.clientWidth, h: stage.clientHeight }),
    setZoom() {},
    zoomIn() {},
    zoomOut() {},
    zoomTo() {},
    fit() {},
    actualPixels() {},
    panBy() {},
    centerOn() {},
    invalidate() {},
    invalidateOverlay() {},
    addOverlay: () => () => {},
    setCursor() {},
    snapPoint: (x, y) => ({ x, y })
  };
}
