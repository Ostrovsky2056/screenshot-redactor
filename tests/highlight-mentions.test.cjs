const assert = require("node:assert/strict");
const test = require("node:test");
const { findCrops, unreadCrops, readName, firstClause } = require("../assets/highlight-mentions.js");

function raster(width, height, background = [248, 248, 248]) {
  const data = new Uint8ClampedArray(width * height * 4);
  function fill(left, top, right, bottom, [r, g, b]) {
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  fill(0, 0, width, height, background);
  return { data, width, height, fill };
}

test("recovers the inside of a dotted highlight beside a punctuation-sized decoration", () => {
  const picture = raster(190, 80);
  const blue = [42, 105, 153];
  for (let x = 20; x <= 110; x += 3) {
    picture.fill(x, 20, x + 1, 21, blue);
    picture.fill(x, 54, x + 1, 55, blue);
  }
  for (let y = 20; y <= 54; y += 3) {
    picture.fill(20, y, 21, y + 1, blue);
    picture.fill(110, y, 111, y + 1, blue);
  }
  picture.fill(107, 12, 121, 26, [24, 155, 202]);
  const [crop] = findCrops(picture);
  assert(crop.outlined);
  assert(crop.x0 > 20 && crop.x1 <= 110 && crop.y0 > 20 && crop.y1 <= 54);
  assert.deepEqual(unreadCrops([crop], [{ x0: 39, y0: 29, x1: 101, y1: 48 }]), []);
});

test("keeps a filled highlight distinct from nearby colored shapes", () => {
  const picture = raster(240, 84);
  picture.fill(30, 20, 116, 52, [190, 217, 246]);
  picture.fill(118, 20, 180, 52, [235, 151, 152]);
  const crops = findCrops(picture);
  assert.equal(crops.length, 2);
  assert.deepEqual(crops[0], { x0: 30, y0: 20, x1: 116, y1: 52, outlined: false });
});

test("only covers the nickname ink after the at sign", () => {
  const image = raster(122, 37);
  image.fill(12, 6, 26, 30, [0, 0, 0]);
  image.fill(28, 8, 77, 27, [0, 0, 0]);
  image.fill(81, 9, 106, 28, [0, 0, 0]);
  const marker = { x0: 12, y0: 6, x1: 27, y1: 30 };
  const nickname = { x0: 28, y0: 8, x1: 77, y1: 27 };
  const line = { text: "@明月小👣", spans: [
    { start: 0, end: 1, box: marker },
    { start: 1, end: 4, box: nickname },
    { start: 4, end: 6, box: { x0: 81, y0: 9, x1: 106, y1: 28 } },
  ] };
  const pixels = { ...image, x: 0, y: 0 };
  const box = readName(line, 88, pixels);
  assert(box.x0 >= marker.x1 && box.x0 <= nickname.x0);
  assert(box.x1 >= nickname.x1 && box.x1 < 81);
  assert.equal(readName({ ...line, text: "公告" }, 94, pixels), null);
  const decorated = readName(line, 88, pixels, { includeEmoji: true });
  assert(decorated.includesEmoji);
  assert(decorated.x1 >= 106 && decorated.x0 >= marker.x1);
  image.fill(76, 10, 87, 29, [0, 0, 0]);
  const touching = readName(line, 88, pixels, { includeEmoji: true });
  assert(touching.includesEmoji);
  assert(touching.x1 >= 106 && touching.x0 >= marker.x1);
  const separate = raster(122, 37);
  separate.fill(12, 6, 26, 30, [0, 0, 0]);
  separate.fill(28, 8, 77, 27, [0, 0, 0]);
  separate.fill(95, 9, 117, 28, [0, 0, 0]);
  const result = readName(line, 88, { ...separate, x: 0, y: 0 }, { includeEmoji: true });
  assert(!result.includesEmoji);
  assert(result.x1 < 95);
});

test("finds a short opening address in an entire chat bubble", () => {
  const picture = raster(204, 88);
  picture.fill(30, 25, 55, 61, [0, 0, 0]);
  picture.fill(60, 25, 85, 61, [0, 0, 0]);
  picture.fill(90, 54, 95, 65, [0, 0, 0]);
  picture.fill(120, 25, 146, 61, [0, 0, 0]);
  picture.fill(151, 25, 177, 61, [0, 0, 0]);
  const ink = { ...picture, x: 0, y: 0 };
  const clause = firstClause(ink);
  assert.equal(clause.comma, 90);
  assert(clause.box.x1 < 120);
  const line = { text: "阿澄，试试", spans: [
    { start: 0, end: 2, box: { x0: 30, y0: 25, x1: 93, y1: 61 } },
    { start: 2, end: 3, box: { x0: 86, y0: 52, x1: 96, y1: 66 } },
    { start: 3, end: 5, box: { x0: 120, y0: 25, x1: 177, y1: 61 } },
  ] };
  const name = readName(line, 65, ink, { participants: [], clause });
  assert(name.x0 <= 30 && name.x1 >= 85 && name.x1 < 90);
  assert.equal(readName({ ...line, text: "小心，试试" }, 65, ink, { participants: [], clause }), null);
  assert(readName({ ...line, text: "星野，试试" }, 52, ink, { participants: ["星野"], clause }));
});
