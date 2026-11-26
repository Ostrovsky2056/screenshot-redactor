const assert = require("node:assert/strict");
const test = require("node:test");
const { findRegions } = require("../assets/visual-scan.js");

test("keeps a detected face when no supported conversation header is present", async t => {
  global.ChatLayout = require("../assets/chat-layout.js");
  global.ChatLayoutModel = require("../assets/chat-layout-model.js");
  global.HighlightMentions = require("../assets/highlight-mentions.js");
  t.after(() => {
    delete global.ChatLayout;
    delete global.ChatLayoutModel;
    delete global.HighlightMentions;
  });
  const width = 200, height = 160;
  const pixels = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(247) };
  const canvas = { width, height, getContext: () => ({ getImageData: () => pixels }) };
  const face = { originX: 82, originY: 51, width: 24, height: 24 };
  const detector = { detect: () => ({ detections: [{ boundingBox: face }] }) };

  const result = await findRegions(canvas, [], detector, () => true);
  assert.equal(result.header, null);
  assert.equal(result.faceScanIncomplete, false);
  assert.deepEqual(result.avatars, [{ x0: 76, x1: 112, y0: 43.8, y1: 80.28 }]);
});
