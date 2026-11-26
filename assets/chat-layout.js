(function () {
  const { boxForRange } = typeof module === "undefined"
    ? window.SensitiveText : require("./sensitive-text.js");
  const width = box => box.x1 - box.x0;
  const height = box => box.y1 - box.y0;
  const centerY = box => (box.y0 + box.y1) / 2;
  const length = box => (width(box) + height(box)) / 2;

  function bounds(boxes) {
    return {
      x0: Math.min(...boxes.map(box => box.x0)),
      y0: Math.min(...boxes.map(box => box.y0)),
      x1: Math.max(...boxes.map(box => box.x1)),
      y1: Math.max(...boxes.map(box => box.y1)),
    };
  }

  function overlap(a, b) {
    const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    return (w * h) / Math.min(width(a) * height(a), width(b) * height(b));
  }

  function distance(data, i, tone) {
    return Math.abs(data[i] - tone[0]) + Math.abs(data[i + 1] - tone[1]) + Math.abs(data[i + 2] - tone[2]);
  }

  function pixelIndex(pixels, x, y) {
    return (Math.floor(y) * pixels.width + Math.floor(x)) * 4;
  }

  function dominantTone(pixels) {
    const counts = new Map();
    const step = Math.max(6, Math.round(Math.min(pixels.width, pixels.height) / 48));
    let total = 0;
    let dominant = [0, 0, 0, 0];
    for (let y = step / 2; y < pixels.height; y += step) {
      for (let x = step / 2; x < pixels.width; x += step) {
        const i = pixelIndex(pixels, x, y);
        const [r, g, b] = pixels.data.subarray(i, i + 3);
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const bin = counts.get(key) || [0, 0, 0, 0];
        bin[0]++;
        bin[1] += r;
        bin[2] += g;
        bin[3] += b;
        counts.set(key, bin);
        if (bin[0] > dominant[0]) dominant = bin;
        total++;
      }
    }
    if (dominant[0] < total * .36) return null;
    return dominant.slice(1).map(channel => channel / dominant[0]);
  }

  function components(pixels, tone) {
    const step = Math.max(1, Math.ceil(Math.max(pixels.width, pixels.height) / 840));
    const cols = Math.ceil(pixels.width / step);
    const rows = Math.ceil(pixels.height / step);
    const occupied = new Uint8Array(cols * rows);
    const pending = new Int32Array(occupied.length);
    for (let i = 0; i < occupied.length; i++) {
      const x = (i % cols) * step;
      const y = Math.floor(i / cols) * step;
      occupied[i] = Number(distance(pixels.data, pixelIndex(pixels, x, y), tone) > 14);
    }
    const shapes = [];
    for (let cell = 0; cell < occupied.length; cell++) {
      if (!occupied[cell]) continue;
      let read = 0, queued = 0, left = cols, right = 0, top = rows, bottom = 0;
      function push(next) {
        if (!occupied[next]) return;
        occupied[next] = 0;
        pending[queued++] = next;
      }
      push(cell);
      while (read < queued) {
        const i = pending[read++];
        const x = i % cols;
        const y = Math.floor(i / cols);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        if (x > 0) push(i - 1);
        if (x + 1 < cols) push(i + 1);
        if (y > 0) push(i - cols);
        if (y + 1 < rows) push(i + cols);
      }
      if (queued < 4) continue;
      const fill = queued / ((right - left + 1) * (bottom - top + 1));
      shapes.push({
        x0: left * step,
        x1: Math.min(pixels.width, (right + 1) * step),
        y0: top * step,
        y1: Math.min(pixels.height, (bottom + 1) * step),
        fill,
      });
    }
    return shapes;
  }

  function surface(pixels, box, tone) {
    const colors = new Map();
    let total = 0;
    let dominant = [0, 0, 0, 0];
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 11; x++) {
        const i = pixelIndex(pixels, box.x0 + width(box) * (x + .5) / 11, box.y0 + height(box) * (y + .5) / 11);
        if (distance(pixels.data, i, tone) <= 14) continue;
        const key = ((pixels.data[i] >> 4) << 8) | ((pixels.data[i + 1] >> 4) << 4) | (pixels.data[i + 2] >> 4);
        const sample = colors.get(key) || [0, 0, 0, 0];
        sample[0]++;
        sample[1] += pixels.data[i];
        sample[2] += pixels.data[i + 1];
        sample[3] += pixels.data[i + 2];
        colors.set(key, sample);
        if (sample[0] > dominant[0]) dominant = sample;
        total++;
      }
    }
    return {
      flatness: total ? dominant[0] / total : 0,
      color: dominant.slice(1).map(channel => channel / dominant[0]),
    };
  }

  function bubbleBody(pixels, box, color) {
    const step = Math.max(1, Math.ceil(width(box) / 48));
    const sampleCount = Math.ceil(width(box) / step);
    let first = box.y1;
    let last = box.y0;
    // Thin attached marks can extend a component beyond the main bubble surface.
    for (let y = box.y0; y < box.y1; y++) {
      let matches = 0;
      for (let x = box.x0; x < box.x1; x += step) {
        if (distance(pixels.data, pixelIndex(pixels, x, y), color) <= 17) matches++;
      }
      if (matches >= sampleCount * .47) {
        first = Math.min(first, y);
        last = y + 1;
      }
    }
    return last - first >= height(box) * .40 ? { ...box, y0: first, y1: last } : box;
  }

  function pairInputs(avatar, bubble, side, imageWidth) {
    const size = length(avatar);
    const gap = side === "left" ? bubble.x0 - avatar.x1 : avatar.x0 - bubble.x1;
    const outer = side === "left" ? avatar.x0 : imageWidth - avatar.x1;
    return [
      Math.abs(gap / size - .28),
      Math.abs((bubble.y0 - avatar.y0) / size - .26),
      Math.abs(Math.log(width(avatar) / height(avatar))),
      avatar.flatness,
      bubble.flatness,
      Number(bubble.hasText),
      Math.min(1, outer / imageWidth * 3),
      Math.min(3, width(bubble) / size) / 3,
      bubble.fill,
    ];
  }

  function profilePairs(pixels, tone, shapes, lines, model) {
    const minimum = Math.max(11, Math.min(pixels.width, pixels.height) * .012);
    const maximum = Math.min(pixels.width, pixels.height) * .21;
    const likelyAvatars = shapes.filter(box => {
      const w = width(box);
      const h = height(box);
      return w >= minimum && h >= minimum && w <= maximum && h <= maximum &&
        box.fill >= .48 && w / h >= .72 && w / h <= 1.38;
    });
    const likelyBubbles = shapes.filter(box => width(box) >= minimum && height(box) >= minimum * .66 &&
      width(box) <= pixels.width * .9 && height(box) <= pixels.height * .36 && box.fill >= .58);
    const surfaces = new Map();
    for (const box of new Set([...likelyAvatars, ...likelyBubbles])) {
      surfaces.set(box, surface(pixels, box, tone));
    }
    const bubbles = [];
    for (const box of likelyBubbles) {
      const { flatness, color } = surfaces.get(box);
      if (flatness <= .52) continue;
      const body = bubbleBody(pixels, box, color);
      bubbles.push({ ...body, flatness, hasText: lines.some(line => overlap(body, line.box) > .65) });
    }
    const pairs = [];
    for (const box of likelyAvatars) {
      const avatar = { ...box, flatness: surfaces.get(box).flatness };
      const size = length(avatar);
      const side = (avatar.x0 + avatar.x1) / 2 < pixels.width / 2 ? "left" : "right";
      for (const bubble of bubbles) {
        const gap = side === "left" ? bubble.x0 - avatar.x1 : avatar.x0 - bubble.x1;
        const drop = bubble.y0 - avatar.y0;
        if (gap < size * .04 || gap > size * 1.1 || drop < size * -.42 || drop > size * 1.25) continue;
        if (height(bubble) < size * .35 || width(bubble) < size * .36) continue;
        const confidence = model.score(pairInputs(avatar, bubble, side, pixels.width));
        if (confidence >= model.threshold) pairs.push({ avatar, bubble, side, size, confidence });
      }
    }
    pairs.sort((a, b) => b.confidence - a.confidence);
    const selected = [];
    for (const pair of pairs) {
      if (!selected.some(existing => overlap(pair.avatar, existing.avatar) > .55 ||
        overlap(pair.bubble, existing.bubble) > .65 || overlap(pair.avatar, existing.bubble) > .55 ||
        overlap(pair.bubble, existing.avatar) > .55)) selected.push(pair);
    }
    return selected;
  }

  function inside(box, x, y) {
    return x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;
  }

  function spanBoxes(line, area) {
    return line.spans.filter(({ box }) => box &&
      inside(area, (box.x0 + box.x1) / 2, centerY(box)));
  }

  function pixelNickname(pixels, tone, area, edge, side, size) {
    const columns = [];
    for (let x = Math.ceil(area.x0); x < area.x1; x++) {
      let top = Infinity;
      let bottom = 0;
      for (let y = Math.ceil(area.y0); y < area.y1; y++) {
        if (distance(pixels.data, pixelIndex(pixels, x, y), tone) > 46) {
          top = Math.min(top, y);
          bottom = y + 1;
        }
      }
      if (bottom - top >= 2) columns.push({ x0: x, x1: x + 1, y0: top, y1: bottom });
    }
    if (side === "right") columns.reverse();
    const nearest = columns[0];
    if (!nearest || Math.abs(nearest.x0 - edge) > size * .43) return null;
    const chain = [nearest];
    for (const column of columns.slice(1)) {
      if (Math.abs(column.x0 - chain[chain.length - 1].x0) > Math.max(4, size * .13)) break;
      chain.push(column);
    }
    const box = bounds(chain);
    const rows = new Uint16Array(height(box));
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        if (distance(pixels.data, pixelIndex(pixels, x, y), tone) > 46) rows[y - box.y0]++;
      }
    }
    // Keep the main line of glyphs across sparse rows, without joining an isolated rule.
    const minimum = Math.max(2, Math.ceil(Math.max(...rows) * .14));
    let top = 0, bottom = 0, start = 0;
    let lastInk = -Infinity;
    for (let row = 0; row < rows.length; row++) {
      if (rows[row] < minimum) continue;
      if (row - lastInk > 3) start = row;
      if (row + 1 - start > bottom - top) {
        top = start;
        bottom = row + 1;
      }
      lastInk = row;
    }
    box.y1 = box.y0 + bottom;
    box.y0 += top;
    return width(box) > size * .15 && height(box) > size * .12 && height(box) < size * .58 ? box : null;
  }

  function nickname(pixels, tone, lines, { avatar, bubble, side, size }) {
    if (bubble.y0 - avatar.y0 < size * .24) return null;
    const edge = side === "left" ? bubble.x0 : bubble.x1;
    const area = {
      x0: Math.max(0, edge - (side === "left" ? size * .16 : size * 4.2)),
      x1: Math.min(pixels.width, edge + (side === "left" ? size * 4.2 : size * .16)),
      y0: Math.max(0, avatar.y0 - size * .15),
      y1: Math.min(bubble.y0 - Math.max(2, size * .075), avatar.y0 + size * .79),
    };
    const choices = [];
    for (const line of lines) {
      const spans = spanBoxes(line, area);
      if (!spans.length) continue;
      const text = line.text.slice(spans[0].start, spans[spans.length - 1].end).trim();
      if (!/[\p{L}\p{N}]/u.test(text) || text.length > 56 || /\d{1,2}:\d{2}|[。？！!?；;]/.test(text)) continue;
      const box = bounds(spans.map(span => span.box));
      const offset = Math.abs((side === "left" ? box.x0 : box.x1) - edge);
      if (offset < size * .47 && height(box) >= size * .10 && height(box) <= size * .62) {
        choices.push({ box, offset, label: text, line, start: spans[0].start, end: spans.at(-1).end });
      }
    }
    choices.sort((a, b) => a.offset - b.offset);
    const best = choices[0];
    const ink = pixelNickname(pixels, tone, area, edge, side, size);
    if (!best) return ink ? { box: ink, label: "" } : null;
    if (!ink) return best;
    const commonWidth = Math.min(ink.x1, best.box.x1) - Math.max(ink.x0, best.box.x0);
    // OCR can extend a nickname box into empty space above the bubble.
    const sameName = commonWidth >= .8 * Math.max(width(ink), width(best.box)) &&
      overlap(ink, best.box) >= .75 && height(ink) <= height(best.box) + 2;
    return sameName ? { ...best, box: ink } : best;
  }

  function quotes(shapes, lines, pairs) {
    const senders = [];
    const bodies = new Map();
    for (const { bubble, side, size } of pairs) {
      const edge = side === "left" ? bubble.x0 : bubble.x1;
      for (const rail of shapes) {
        if (width(rail) > size * .14 || height(rail) < size * .49 || width(rail) / height(rail) >= .23 || rail.fill < .68) continue;
        if (rail.y0 < bubble.y1 - size * .10 || rail.y0 > bubble.y1 + size * .9) continue;
        if (Math.abs(rail.x0 - edge) > size * .51) continue;
        const quotedLines = lines.filter(line => {
          const gap = line.box.x0 - rail.x1;
          return gap >= 0 && gap <= size * .78 && centerY(line.box) >= rail.y0 && centerY(line.box) <= rail.y1;
        }).sort((a, b) => centerY(a.box) - centerY(b.box));
        const first = quotedLines[0];
        if (!first) continue;
        for (const line of quotedLines) {
          if (Math.abs(line.box.x0 - first.box.x0) > size * .35) continue;
          if (!bodies.has(line)) bodies.set(line, 0);
        }
        if (centerY(first.box) > rail.y0 + size * .62 || bodies.get(first)) continue;
        const match = first.text.match(/^\s*([\p{L}\p{N}\p{So}][\p{L}\p{N}\p{So}\p{M}\u200d_@. ·'’-]{0,32}?)\s*[:：]/u);
        if (!match || /^[\d ]+$/.test(match[1])) continue;
        const start = match[0].indexOf(match[1]);
        const sender = boxForRange(first, start, start + match[1].length);
        if (sender) senders.push({ box: sender, label: match[1] });
        bodies.set(first, match[0].length);
      }
    }
    return { senders, quoteBodies: Array.from(bodies, ([line, start]) => ({ line, start })) };
  }

  function fingerprint(pixels, box) {
    const samples = new Float32Array(6 * 6 * 3);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const target = (y * 6 + x) * 3;
        for (const dy of [.25, .75]) {
          for (const dx of [.25, .75]) {
            const left = box.x0 + width(box) * (.1 + .8 * (x + dx) / 6);
            const top = box.y0 + height(box) * (.1 + .8 * (y + dy) / 6);
            const source = pixelIndex(pixels, left, top);
            for (let channel = 0; channel < 3; channel++) {
              samples[target + channel] += pixels.data[source + channel] / 4;
            }
          }
        }
      }
    }
    return samples;
  }

  function speakerKey(label) {
    return label.normalize("NFKC").toLowerCase()
      .replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, "$1").replace(/\s+/g, " ").trim();
  }

  function groupSpeakers(pixels, profiles) {
    const groups = [];
    const ids = new Map();
    const ordered = [...profiles].sort((a, b) => a.avatar.y0 - b.avatar.y0 || a.avatar.x0 - b.avatar.x0);
    for (const { avatar, side, name } of ordered) {
      const key = speakerKey(name?.label || "");
      const portrait = fingerprint(pixels, avatar);
      let closest;
      let distance = Infinity;
      for (const group of groups) {
        if (group.side !== side || (key && group.key && key !== group.key)) continue;
        const difference = portrait.reduce((sum, channel, i) => sum + Math.abs(channel - group.portrait[i]), 0) / portrait.length;
        const tolerance = key && group.key === key ? 22 : 10;
        if (difference > tolerance || difference >= distance) continue;
        closest = group;
        distance = difference;
      }
      if (!closest) {
        closest = { id: groups.length, side, key, portrait };
        groups.push(closest);
      } else if (!closest.key) {
        closest.key = key;
      }
      ids.set(avatar, closest.id);
      if (name) ids.set(name.box, closest.id);
    }
    return ids;
  }

  function matchQuoteSpeakers(profiles, senders, ids, labels = new Map()) {
    for (const { box, label } of senders) {
      const key = speakerKey(label);
      if (!key || ids.has(box)) continue;
      const matches = new Set();
      for (const { avatar, name } of profiles) {
        if (!name) continue;
        if (speakerKey(name.label || labels.get(name.box) || "") === key) matches.add(ids.get(avatar));
      }
      if (matches.size === 1) ids.set(box, matches.values().next().value);
    }
  }

  function findRegions(pixels, lines, model) {
    const tone = dominantTone(pixels);
    if (!tone) return { avatars: [], associatedNames: [], messages: [], quoteBodies: [], graphics: [],
      profiles: [], quoteSenders: [], speakerIds: new Map() };
    const shapes = components(pixels, tone);
    const pairs = profilePairs(pixels, tone, shapes, lines, model);
    const { senders, quoteBodies } = quotes(shapes, lines, pairs);
    const profiles = pairs.map(pair => ({ ...pair, name: nickname(pixels, tone, lines, pair) }));
    const speakerIds = groupSpeakers(pixels, profiles);
    matchQuoteSpeakers(profiles, senders, speakerIds);
    const minimum = Math.max(14, Math.min(pixels.width, pixels.height) * .028);
    const graphics = shapes.filter(box => width(box) >= minimum && height(box) >= minimum &&
      box.fill >= .5 && box.x0 > 0 && box.y0 > 0 && box.x1 < pixels.width && box.y1 < pixels.height);
    return {
      avatars: pairs.map(({ avatar }) => avatar),
      associatedNames: [
        ...profiles.filter(({ name }) => name).map(({ name }) => name.box),
        ...senders.map(({ box }) => box),
      ],
      messages: pairs.map(({ bubble }) => bubble),
      quoteBodies,
      graphics,
      profiles,
      quoteSenders: senders,
      speakerIds,
    };
  }

  const chat = { findRegions, pairInputs, matchQuoteSpeakers };
  if (typeof module !== "undefined") module.exports = chat;
  else window.ChatLayout = chat;
})();
