(function () {
  const { boxForRange, exactBoxForRange } = typeof module === "undefined"
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

  function dominantTone(pixels, { x0 = 0, y0 = 0, x1 = pixels.width, y1 = pixels.height } = {}) {
    const counts = new Map();
    const step = Math.max(6, Math.round(Math.min(pixels.width, pixels.height) / 48));
    let total = 0;
    let dominant = [0, 0, 0, 0];
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
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

  function components(pixels, tone, startY = 0, endY = pixels.height, contrast = 14, chroma = 0) {
    const step = Math.max(1, Math.ceil(Math.max(pixels.width, pixels.height) / 840));
    const cols = Math.ceil(pixels.width / step);
    const rows = Math.ceil((endY - startY) / step);
    const occupied = new Uint8Array(cols * rows);
    const pending = new Int32Array(occupied.length);
    for (let i = 0; i < occupied.length; i++) {
      const x = (i % cols) * step;
      const y = startY + Math.floor(i / cols) * step;
      const index = pixelIndex(pixels, x, y);
      const { data } = pixels;
      if (distance(data, index, tone) <= contrast) continue;
      if (chroma) {
        const r = data[index], g = data[index + 1], b = data[index + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) < chroma) continue;
      }
      occupied[i] = 1;
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
        y0: startY + top * step,
        y1: Math.min(endY, startY + (bottom + 1) * step),
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

  function avatarCandidates(shapes, minimum, maximum) {
    return shapes.filter(box => {
      const w = width(box);
      const h = height(box);
      return w >= minimum && h >= minimum && w <= maximum && h <= maximum &&
        box.fill >= .48 && w / h >= .72 && w / h <= 1.38;
    });
  }

  function profilePairs(pixels, tone, shapes, lines, model, likelyAvatars, minimum) {
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

  function inkColumns(pixels, tone, area) {
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
    return columns;
  }

  function pixelNickname(pixels, tone, area, edge, side, size, gap = Math.max(4, size * .13)) {
    const columns = inkColumns(pixels, tone, area);
    if (side === "right") columns.reverse();
    const nearest = columns[0];
    if (!nearest || Math.abs(nearest.x0 - edge) > size * .43) return null;
    const chain = [nearest];
    for (const column of columns.slice(1)) {
      if (Math.abs(column.x0 - chain[chain.length - 1].x0) > gap) break;
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

  function hasCardOutline(pixels, tone, box) {
    const band = Math.max(1, Math.ceil(Math.max(pixels.width, pixels.height) / 840));
    const edges = [
      [box.x0, box.y0, width(box), 0, 0, 1],
      [box.x0, box.y1 - 1, width(box), 0, 0, -1],
      [box.x0, box.y0, 0, height(box), 1, 0],
      [box.x1 - 1, box.y0, 0, height(box), -1, 0],
    ];
    return edges.every(([x, y, dx, dy, inwardX, inwardY]) => {
      let hits = 0;
      for (let i = 2; i <= 8; i++) {
        for (let depth = 0; depth < band; depth++) {
          const at = pixelIndex(pixels, x + dx * i / 10 + inwardX * depth, y + dy * i / 10 + inwardY * depth);
          if (distance(pixels.data, at, tone) <= 14) continue;
          hits++;
          break;
        }
      }
      return hits >= 5;
    });
  }

  function cardCandidates(pixels, tone, shapes, minimum) {
    // Thumbnails can be textured, and a card may have only a thin edge against the chat background.
    return shapes.filter(box => width(box) >= minimum && height(box) >= minimum &&
      width(box) <= pixels.width * .85 && height(box) <= pixels.height * .8 &&
      box.x0 > 0 && box.y0 > 0 && box.x1 < pixels.width && box.y1 < pixels.height &&
      (box.fill >= .6 || hasCardOutline(pixels, tone, box)));
  }

  function mediaProfiles(pixels, tone, lines, cards, avatars, textProfiles) {
    const occupied = textProfiles.flatMap(({ avatar, bubble }) => [avatar, bubble]);
    const isOccupied = box => occupied.some(other => overlap(other, box) > .55);
    const profiles = [];
    for (const avatar of avatars) {
      if (avatar.clipped || isOccupied(avatar)) continue;
      const size = length(avatar);
      const center = (avatar.x0 + avatar.x1) / 2;
      const side = center < pixels.width / 2 ? "left" : "right";
      const margin = side === "left" ? avatar.x0 : pixels.width - avatar.x1;
      const inChatLane = textProfiles.some(profile => profile.side === side &&
        Math.abs((profile.avatar.x0 + profile.avatar.x1) / 2 - center) <= .42 * size);
      if (!inChatLane && margin > Math.min(.16 * pixels.width, 2 * size)) continue;

      let nearest = null;
      let nearestDistance = Infinity;
      for (const bubble of cards) {
        const gap = side === "left" ? bubble.x0 - avatar.x1 : avatar.x0 - bubble.x1;
        const drop = bubble.y0 - avatar.y0;
        if (gap < .04 * size || gap > 1.1 * size || drop < -.18 * size || drop > .95 * size ||
          width(bubble) < 1.2 * size || height(bubble) < .6 * size || isOccupied(bubble)) continue;
        const separation = gap + Math.abs(drop) * .45;
        if (separation >= nearestDistance) continue;
        const profile = { avatar, bubble, side, size };
        const name = nickname(pixels, tone, lines, profile);
        if (!name && !inChatLane && Math.abs(drop) > .2 * size) continue;
        nearest = { ...profile, name };
        nearestDistance = separation;
      }
      if (nearest) {
        profiles.push(nearest);
        occupied.push(avatar, nearest.bubble);
      }
    }
    return profiles;
  }

  function quoteNameBounds(pixels, tone, line, start, end, separator) {
    const box = boxForRange(line, start, end);
    const colon = exactBoxForRange(line, separator, separator + 1);
    if (!box || !colon) return box;
    const rightLimit = Math.floor(colon.x0);
    if (rightLimit >= box.x1) return { ...box, rightLimit };
    // A symbol box can overlap the colon. Only shorten it at a gap near the end of the name.
    if (rightLimit <= box.x0 || box.x1 - rightLimit > .2 * width(box)) return box;
    const boundary = {
      x0: rightLimit - 1, x1: rightLimit, y0: Math.max(0, box.y0 - 1), y1: Math.min(pixels.height, box.y1 + 1),
    };
    return inkColumns(pixels, tone, boundary).length ? box : { ...box, x1: rightLimit, rightLimit };
  }

  function quotes(pixels, tone, shapes, lines, pairs) {
    const senders = [];
    const bodies = new Map();
    for (const { bubble, side, size } of pairs) {
      const edge = side === "left" ? bubble.x0 : bubble.x1;
      for (const rail of shapes) {
        if (width(rail) > size * .14 || height(rail) < size * .49 || width(rail) / height(rail) >= .23 || rail.fill < .68) continue;
        if (rail.y0 < bubble.y1 - size * .10 || rail.y0 > bubble.y1 + size * .9) continue;
        if (Math.abs(rail.x0 - edge) > size * .51) continue;
        const alongside = lines.filter(({ box }) => centerY(box) >= rail.y0 && centerY(box) <= rail.y1);
        const toLeft = side === "right" ? alongside.filter(({ box }) => {
          const gap = rail.x0 - box.x1;
          return gap >= 0 && gap <= size * .78;
        }) : [];
        const align = toLeft.length ? "x1" : "x0";
        const quotedLines = (toLeft.length ? toLeft : alongside.filter(({ box }) => {
          const gap = box.x0 - rail.x1;
          return gap >= 0 && gap <= size * .78;
        })).sort((a, b) => centerY(a.box) - centerY(b.box));
        const first = quotedLines[0];
        if (!first) continue;
        for (const line of quotedLines) {
          if (Math.abs(line.box[align] - first.box[align]) > size * .35) continue;
          if (!bodies.has(line)) bodies.set(line, 0);
        }
        if (centerY(first.box) > rail.y0 + size * .62 || bodies.get(first)) continue;
        const match = first.text.match(/^\s*([\p{L}\p{N}\p{So}][\p{L}\p{N}\p{So}\p{M}\u200d_@. ·'’-]{0,32}?)\s*[:：]/u);
        if (!match || /^[\d ]+$/.test(match[1])) continue;
        const start = match[0].indexOf(match[1]);
        const sender = quoteNameBounds(pixels, tone, first, start, start + match[1].length, match[0].length - 1);
        if (sender) senders.push({ box: sender, label: match[1] });
        bodies.set(first, match[0].length);
      }
    }
    return { senders, quoteBodies: Array.from(bodies, ([line, start]) => ({ line, start })) };
  }

  function titleBounds(line, pixels) {
    const suffix = line.text.match(/\(\s*[1-9](?:\s*[0-9]){0,3}\s*\)\s*$/u);
    if (!suffix || !/\p{L}/u.test(line.text.slice(0, suffix.index))) return null;
    const title = exactBoxForRange(line, 0, suffix.index);
    const count = exactBoxForRange(line, suffix.index, line.text.length);
    if (!title || !count || count.x0 <= title.x0) return null;
    if (pixels && count.x0 - title.x1 > height(title)) {
      // A valid count can follow a title whose intervening glyphs the OCR skipped.
      const gap = { x0: title.x1, x1: count.x0, y0: title.y0, y1: title.y1 };
      const at = pixelIndex(pixels, (gap.x0 + gap.x1) / 2, Math.max(0, gap.y0 - 2));
      const tone = pixels.data.subarray(at, at + 3);
      if (inkColumns(pixels, tone, gap).length >= .3 * height(title)) return null;
    }
    return bounds([title, count]);
  }

  function headerDivider(pixels, before) {
    const { data, width, height } = pixels;
    const reach = Math.max(3, Math.round(.004 * height));
    const step = Math.ceil(.86 * width / 48);
    for (let y = Math.max(12, Math.round(.016 * height)); y < before && y + reach < height; y++) {
      let probes = 0, edge = 0, rail = 0;
      for (let x = Math.ceil(.07 * width); x < .93 * width; x += step) {
        const at = pixelIndex(pixels, x, y);
        const above = pixelIndex(pixels, x, y - reach);
        const below = pixelIndex(pixels, x, y + reach);
        probes++;
        if (distance(data, at, [data[above], data[above + 1], data[above + 2]]) < 14) continue;
        edge++;
        if (distance(data, at, [data[below], data[below + 1], data[below + 2]]) >= 14) rail++;
      }
      if (edge >= .8 * probes && rail >= .35 * probes) return y;
    }
    return null;
  }

  function titleCropAboveDivider(pixels, candidates, divider) {
    const start = candidates.filter(({ box, text }) => box.x0 < .17 * pixels.width &&
      box.y0 > .15 * divider && box.y1 < divider && /\p{L}/u.test(text))
      .sort((a, b) => a.box.x0 - b.box.x0)[0]?.box;
    const size = start ? height(start) : .36 * divider;
    const padding = Math.ceil(.35 * size);
    const row = {
      x0: Math.max(Math.ceil(.015 * pixels.width), (start?.x0 ?? 0) - 1.5 * size),
      x1: Math.floor(.86 * pixels.width),
      y0: Math.max(0, (start?.y0 ?? .23 * divider) - padding),
      y1: Math.min(divider, (start?.y1 ?? .77 * divider) + padding),
    };
    const at = pixelIndex(pixels, .63 * pixels.width, Math.max(0, row.y0 - 2));
    const tone = pixels.data.subarray(at, at + 3);
    const columns = inkColumns(pixels, tone, row);
    const first = columns[0];
    if (!first || first.x0 > .22 * pixels.width) return null;
    let last = first;
    for (const column of columns.slice(1)) {
      if (column.x0 - last.x1 > Math.max(6, 1.6 * size)) break;
      last = column;
    }
    if (last.x1 - first.x0 < size) return null;
    return { ...row, x0: Math.max(0, first.x0 - padding), x1: Math.min(row.x1, last.x1 + padding) };
  }

  function chatHeader(lines, pairs, pixels, divider) {
    const empty = { groupTitle: null, titleCrop: null };
    if (pairs.length < 2) return empty;
    // A pair of title glyphs can resemble a small avatar and bubble.
    const chatBelow = divider && pairs.filter(({ avatar, bubble }) => avatar.y0 >= divider && bubble.y0 >= divider).length >= 2;
    const limit = chatBelow ? divider : Math.min(...pairs.map(({ bubble }) => bubble.y0));
    const candidates = lines.filter(({ box }) => box.y0 < .15 * pixels.height &&
      box.y1 < limit && height(box) >= 8);
    for (const line of candidates) {
      const { box, text, confidence } = line;
      // Sparse OCR sometimes puts the count on its own line and drops its opening parenthesis.
      if (confidence < 42 || !/(?:\(\s*|^|\s)[1-9](?:\s*[0-9]){0,3}\s*\)\s*$/u.test(text)) continue;
      const row = candidates.filter(({ box: part }) => part.x0 <= box.x0 &&
        part.x1 <= box.x1 && Math.abs(centerY(part) - centerY(box)) <= .4 * Math.max(height(part), height(box)) &&
        Math.min(part.y1, box.y1) - Math.max(part.y0, box.y0) >= .5 * Math.min(height(part), height(box)));
      const start = row.filter(part => part.box.x0 < .17 * pixels.width &&
        !(part.confidence < 25) && /\p{L}/u.test(part.text)).sort((a, b) => a.box.x0 - b.box.x0)[0];
      if (!start) continue;

      const title = confidence < 48 ? null : titleBounds(line, pixels);
      const area = bounds([start.box, box]);
      const padding = Math.ceil(.32 * Math.max(height(start.box), height(box)));
      if (!title || start.box.x0 < title.x0) {
        const titleCrop = { x0: Math.max(0, area.x0 - padding), y0: Math.max(0, area.y0 - padding),
          x1: Math.min(pixels.width, area.x1 + padding), y1: Math.min(limit, area.y1 + padding) };
        // Cover the adjacent prefix even when the focused read is unavailable.
        const groupTitle = title && start.box.x1 <= title.x0 && title.x0 - start.box.x1 < height(title)
          ? bounds([start.box, title]) : title;
        return { groupTitle, titleCrop };
      }
      return { groupTitle: title, titleCrop: null };
    }
    // A toolbar divider and chat rows below it allow a focused read even when sparse OCR misses the count.
    return chatBelow ? { groupTitle: null, titleCrop: titleCropAboveDivider(pixels, candidates, divider) } : empty;
  }

  function colorShare(pixels, box) {
    const step = Math.max(1, Math.floor(Math.min(width(box), height(box)) / 9));
    let vivid = 0;
    let sampled = 0;
    for (let y = box.y0; y < box.y1; y += step) {
      for (let x = box.x0; x < box.x1; x += step) {
        const i = pixelIndex(pixels, x, y);
        const { data } = pixels;
        const high = Math.max(data[i], data[i + 1], data[i + 2]);
        const low = Math.min(data[i], data[i + 1], data[i + 2]);
        if (high - low >= 22) vivid++;
        sampled++;
      }
    }
    return vivid / sampled;
  }

  function toolbarText(pixels, tone, area, gap, leadingGap = gap) {
    const columns = inkColumns(pixels, tone, area);
    if (!columns.length || columns[0].x0 - area.x0 > leadingGap) return null;
    let end = 1;
    while (end < columns.length && columns[end].x0 - columns[end - 1].x1 <= gap) end++;
    return bounds(columns.slice(0, end));
  }

  function textRows(pixels, tone, area) {
    const rows = [];
    for (let y = Math.ceil(area.y0); y < area.y1; y++) {
      let ink = 0;
      for (let x = Math.ceil(area.x0); x < area.x1; x++) {
        if (distance(pixels.data, pixelIndex(pixels, x, y), tone) > 85) ink++;
      }
      if (ink < 2) continue;
      const last = rows.at(-1);
      if (last && y - last.y1 <= 1) last.y1 = y + 1;
      else rows.push({ y0: y, y1: y + 1 });
    }
    return rows;
  }

  function phoneEdges(pixels, center) {
    const { width: w, height: h, data } = pixels;
    function edge(direction) {
      for (let x = Math.round(center); x >= 0 && x < w; x += direction) {
        let dark = 0;
        for (let probe = 0; probe < 12; probe++) {
          const y = (.36 + .033 * probe) * h;
          const i = pixelIndex(pixels, x, y);
          if (Math.max(data[i], data[i + 1], data[i + 2]) < 55) dark++;
        }
        if (dark >= 10) return x - direction;
      }
      return direction < 0 ? 0 : w;
    }
    return { x0: edge(-1), x1: edge(1) };
  }

  function centeredHeader(pixels, tone, shapes, lines) {
    const { width: w, height: h, data } = pixels;
    if (Math.min(...tone) < 200) return null;
    const notch = shapes.find(box => {
      if (box.y0 >= .17 * h || height(box) < 9 || width(box) <= .11 * w || width(box) > .38 * w ||
          width(box) < height(box) * 2.4 || width(box) >= height(box) * 6.5 || box.fill < .72) return false;
      const center = pixelIndex(pixels, (box.x0 + box.x1) / 2, centerY(box));
      return Math.max(data[center], data[center + 1], data[center + 2]) < 50;
    });
    if (!notch) return null;
    const middle = (notch.x0 + notch.x1) / 2;
    const pane = phoneEdges(pixels, middle);
    const portrait = shapes.find(box => box.y0 >= notch.y1 && box.y0 - notch.y1 < .7 * height(notch) &&
      width(box) >= .32 * width(notch) && width(box) <= .72 * width(notch) &&
      Math.abs((box.x0 + box.x1) / 2 - middle) <= .2 * width(box) &&
      Math.abs(width(box) - height(box)) <= .28 * width(box) && colorShare(pixels, box) >= .24);
    if (!portrait) return null;
    const size = height(portrait);
    const controls = shapes.some(box => Math.abs(centerY(box) - centerY(portrait)) <= .52 * size &&
      (box.x1 < portrait.x0 - size || box.x0 > portrait.x1 + size) &&
      box.x0 >= pane.x0 && box.x1 <= pane.x1 && width(box) > .14 * size && height(box) >= .16 * size);
    if (!controls) return null;
    const line = lines.find(({ box, text, confidence }) => confidence >= 48 &&
      /\p{L}[\p{L}\p{N}]/u.test(text) && !/[!?]$/.test(text) &&
      box.y0 >= portrait.y1 - .10 * size && box.y0 <= portrait.y1 + .30 * size &&
      height(box) <= .47 * size && Math.abs((box.x0 + box.x1) / 2 - middle) < .22 * size &&
      box.x0 >= pane.x0 && box.x1 <= pane.x1);
    if (!line) return null;
    const title = { x0: Math.max(pane.x0, line.box.x0 - 2), y0: Math.max(portrait.y1, line.box.y0 - 2),
      x1: Math.min(pane.x1, line.box.x1 + 2), y1: line.box.y1 + 2 };
    return { kind: "centered", title, portrait, pane, bodyTop: title.y1 + .20 * size, confirmed: true };
  }

  function memberStatus(text) {
    return /^\s*\d[\d,. ]*\s*(?:online|active|members?|人(?:在线|活跃)?|在线|活跃)\s*$/iu.test(text);
  }

  function inlineHeader(pixels, tone, shapes, lines, profiles) {
    const { width: w, height: h } = pixels;
    const compact = shapes.filter(box => width(box) >= 3 && height(box) >= 3);
    const minimum = Math.max(13, Math.min(w, h) * .021);
    const maximum = Math.min(w, h) * .18;
    const portraits = compact.filter(box => {
      const boxWidth = width(box), boxHeight = height(box);
      return box.y0 < Math.min(.19 * h, .23 * w) && Math.min(boxWidth, boxHeight) >= minimum &&
        Math.max(boxWidth, boxHeight) <= maximum && boxWidth / boxHeight >= .76 &&
        boxWidth / boxHeight <= 1.31 && box.fill >= .37 && colorShare(pixels, box) >= .16;
    });
    for (const portrait of portraits) {
      const size = height(portrait);
      const wide = w > h * 1.15 && portrait.x0 > .23 * w && portrait.x1 < .67 * w;
      const control = box => Math.abs(centerY(box) - centerY(portrait)) < .47 * size &&
        height(box) >= Math.max(3, size * .075) && height(box) <= .86 * size &&
        width(box) <= 1.08 * size;
      const leading = !wide ? portrait.x0 < .24 * w && compact.some(box =>
        box.x1 < portrait.x0 - 2 && portrait.x0 - box.x1 < 1.7 * size && control(box)) :
        compact.some(box => box.y0 >= portrait.y1 + .28 * size && box.y0 <= portrait.y1 + 2.5 * size &&
          Math.abs(box.x0 - portrait.x0) <= .18 * size && Math.abs(width(box) - width(portrait)) < .25 * size);
      if (!leading) continue;
      const right = compact.filter(box => box.x0 > portrait.x1 + 1.25 * size && box.x0 > .62 * w && control(box));
      if (!right.length) continue;
      const start = portrait.x1 + 2;
      const rowEnd = Math.min(w, start + Math.ceil(.88 * size));
      const rows = textRows(pixels, tone, { x0: start, x1: rowEnd, y0: portrait.y0, y1: portrait.y1 })
        .filter(row => height(row) >= .17 * size && height(row) <= .72 * size);
      const row = rows.find(row => row.y0 < centerY(portrait) + .13 * size);
      if (!row) continue;
      const gap = Math.max(4, Math.round(height(row) * .62));
      const title = toolbarText(pixels, tone, { x0: start, x1: w - 2,
        y0: Math.max(portrait.y0, row.y0 - 1), y1: Math.min(portrait.y1, row.y1 + 1) }, gap, Math.max(gap, .36 * size));
      if (!title || width(title) < .50 * size || width(title) >= .69 * w ||
        right.some(box => overlap(box, title) > .45 && width(box) >= .55 * size)) continue;
      if (!right.some(box => box.x0 - title.x1 >= Math.max(4, .14 * size))) continue;
      const evidence = lines.filter(({ box }) => box.x0 >= start - 2 && box.x0 <= title.x0 + size * .55 &&
        box.y0 >= title.y1 && box.y1 <= portrait.y1 + size * .12);
      const countLine = evidence.find(({ text }) => memberStatus(text));
      const isChat = profiles.some(({ bubble }) => bubble.y0 >= portrait.y1) || countLine;
      if (!isChat) continue;
      const count = countLine && { ...countLine.box };
      const second = !count && !wide && rows.find(part => part.y0 >= title.y1 + 2 && height(part) < height(row) * .85);
      const status = second && toolbarText(pixels, tone, { x0: start, x1: Math.min(w, start + 3 * size),
        y0: second.y0, y1: Math.min(portrait.y1 + 1, second.y1 + 1) }, Math.max(4, height(second) * .75));
      const label = wide && lines.some(line => {
        if (line.confidence < 58) return false;
        const spans = spanBoxes(line, title);
        if (!spans.length) return false;
        const value = line.text.slice(spans[0].start, spans.at(-1).end);
        return /\p{L}.*\p{L}/u.test(value);
      });
      return { kind: wide ? "split" : "inline", title: {
        x0: Math.max(portrait.x1, title.x0 - 2), x1: title.x1 + 2,
        y0: title.y0 - 2, y1: Math.min(count?.y0 ?? portrait.y1 + 1, title.y1 + 2),
      }, portrait, count, status, pane: { x0: wide ? portrait.x0 - .38 * size : 0, x1: w },
      bodyTop: Math.ceil(portrait.y1 + .12 * size), confirmed: label };
    }
    return null;
  }

  function numberedHeader(pixels, tone, shapes, lines) {
    const { width: w, height: h } = pixels;
    const line = lines.find(({ box, text, confidence }) => confidence >= 32 && box.y0 < .09 * h &&
      box.x0 < .28 * w && box.x1 < .77 * w && /[（([\s]\s*\d{1,4}\s*[)）\]]\s*$/u.test(text) &&
      /\p{L}/u.test(text));
    if (!line) return null;
    const band = { y0: line.box.y0, y1: line.box.y1 };
    const controls = shapes.filter(box => box.y0 < band.y1 && box.y1 > band.y0 && width(box) >= 4 &&
      width(box) < .10 * w && height(box) >= 2 && height(box) < .085 * h);
    const left = controls.find(box => box.x1 <= line.box.x0 + .04 * w && box.x0 < .21 * w);
    const right = controls.find(box => box.x0 > .78 * w && box.x0 - line.box.x1 > .08 * w);
    if (!left || !right) return null;
    const start = left.x1 + 2;
    const row = textRows(pixels, tone, { ...band, x0: start, x1: Math.min(line.box.x1, start + .21 * w) })
      .find(row => height(row) >= 5);
    if (!row) return null;
    const title = toolbarText(pixels, tone, { y0: Math.max(0, row.y0 - 1), y1: row.y1 + 1,
      x0: start, x1: right.x0 }, Math.max(4, .036 * w));
    if (!title || width(title) < .16 * w || title.x1 < line.box.x1 - .08 * w) return null;
    return { kind: "numbered", title: { x0: title.x0 - 1, x1: title.x1 + 2,
      y0: Math.max(0, title.y0 - 1), y1: title.y1 + 2 }, pane: { x0: 0, x1: w },
    bodyTop: Math.ceil(Math.max(title.y1, right.y1) + .01 * h), confirmed: true };
  }

  function conversationHeader(pixels, tone, lines, profiles = []) {
    if (!tone) return null;
    const top = Math.ceil(Math.min(.43 * pixels.height, .46 * pixels.width));
    const strong = components(pixels, tone, 0, top, 53);
    const centered = centeredHeader(pixels, tone, strong, lines);
    if (centered) return { ...centered, tone };
    const shapes = components(pixels, tone, 0, top, 20);
    const header = inlineHeader(pixels, tone, shapes, lines, profiles) || numberedHeader(pixels, tone, strong, lines);
    return header && { ...header, tone };
  }

  function portraitShapes(pixels, tone, top, minimum, maximum) {
    const start = Math.max(0, Math.floor(top));
    const sharp = components(pixels, tone, start, pixels.height, 48);
    const colors = components(pixels, tone, start, pixels.height, 32, 24);
    const portraits = avatarCandidates([...sharp, ...colors], minimum, maximum)
      .filter(box => colorShare(pixels, box) >= .18)
      .sort((a, b) => {
        const square = box => Math.min(width(box), height(box)) / Math.max(width(box), height(box));
        return square(b) - square(a) || length(b) - length(a);
      });
    const distinct = [];
    for (const box of portraits) {
      if (!distinct.some(other => overlap(box, other) >= .75)) distinct.push(box);
    }
    return distinct;
  }

  function closeLane(a, b) {
    const size = Math.min(width(a), width(b));
    return Math.abs((a.x0 + a.x1 - b.x0 - b.x1) / 2) <= .32 * size &&
      Math.abs(width(a) - width(b)) <= .36 * size && Math.abs(centerY(a) - centerY(b)) >= .8 * size;
  }

  function nearbyMessage(lines, avatar, side, pane) {
    const size = length(avatar);
    return lines.some(({ box, text }) => {
      const gap = side === "left" ? box.x0 - avatar.x1 : avatar.x0 - box.x1;
      return box.x0 >= pane.x0 && box.x1 <= pane.x1 && /\p{L}/u.test(text) && gap >= 0 &&
        gap <= 2.2 * size && box.y0 <= avatar.y1 + .5 * size && box.y1 >= avatar.y0 - 2.4 * size;
    });
  }

  function listName(lines, avatar, end, below = false) {
    const size = length(avatar);
    const area = below ? { x0: avatar.x0 - .12 * size, x1: avatar.x1 + .12 * size,
      y0: avatar.y1 + .04 * size, y1: avatar.y1 + .50 * size } :
      { x0: avatar.x1 + .06 * size, x1: Math.min(avatar.x1 + 4 * size, end),
        y0: avatar.y0 - .06 * size, y1: avatar.y0 + .51 * size };
    const choices = [];
    for (const line of lines) {
      const spans = spanBoxes(line, area);
      if (!spans.length) continue;
      const label = line.text.slice(spans[0].start, spans.at(-1).end);
      if (!/\p{L}/u.test(label) || /[:：[\]]/.test(label) || label.length > 38) continue;
      const box = bounds(spans.map(span => span.box));
      if (box.x0 < area.x0 - .15 * size || !below && box.x0 - avatar.x1 > .70 * size ||
          height(box) < .12 * size || height(box) > .64 * size) continue;
      choices.push({ box, label });
    }
    return choices.sort((a, b) => a.box.y0 - b.box.y0)[0] || null;
  }

  function sidebarPortraits(pixels, lines, shapes, header) {
    if (header.kind !== "split") return { entries: [], bounds: null };
    const end = header.pane.x0;
    const size = width(header.portrait);
    const sidebar = shapes.filter(box => box.x1 <= end && width(box) >= size && width(box) <= 2.3 * size);
    const named = sidebar.map(avatar => ({ avatar, name: listName(lines, avatar, end) })).filter(({ name }) => name);
    let lane = [];
    for (const row of named) {
      const aligned = named.filter(other => other === row || closeLane(other.avatar, row.avatar));
      if (aligned.length > lane.length) lane = aligned;
    }
    if (lane.length < 3) return { entries: [], bounds: null };
    lane.sort((a, b) => a.avatar.y0 - b.avatar.y0);
    const first = lane[0].avatar;
    const rowSize = Math.round(length(first));
    const gaps = lane.slice(1).map(({ avatar }, i) => avatar.y0 - lane[i].avatar.y0)
      .filter(gap => gap >= rowSize * 1.04 && gap <= 1.65 * rowSize).sort((a, b) => a - b);
    if (gaps.length >= 2) {
      const middle = Math.floor(gaps.length / 2);
      const pitch = Math.round((gaps[middle] + gaps[Math.floor((gaps.length - 1) / 2)]) / 2);
      for (let y = first.y0 + pitch; y + .34 * rowSize < pixels.height; y += pitch) {
        const avatar = { x0: first.x0, x1: first.x1, y0: y, y1: Math.min(pixels.height, y + rowSize) };
        if (lane.some(row => overlap(avatar, row.avatar) > .55) || colorShare(pixels, avatar) < .16) continue;
        const name = listName(lines, avatar, end);
        const clipped = height(avatar) < rowSize;
        if (name || clipped) lane.push({ avatar: { ...avatar, clipped }, name });
      }
    }
    const shortcuts = sidebar.filter(box => box.y1 < first.y0 - .35 * rowSize &&
      Math.abs(width(box) - rowSize) <= .35 * rowSize);
    const strip = shortcuts.filter(box => shortcuts.filter(other => Math.abs(other.y0 - box.y0) < .30 * rowSize).length >= 3);
    const entries = [...lane, ...strip.map(avatar => ({ avatar, name: listName(lines, avatar, end, true) }))];
    return { entries, bounds: { x0: Math.max(0, first.x0 - .18 * rowSize), x1: end,
      y0: Math.min(first.y0, ...strip.map(box => box.y0)) - 3, y1: pixels.height } };
  }

  function additionalPortraits(pixels, lines, header, knownAvatars, profiles = []) {
    const { pane } = header;
    const paneWidth = pane.x1 - pane.x0;
    const tone = header.tone;
    const size = header.portrait ? length(header.portrait) : paneWidth * .16;
    const minimum = Math.max(10, .40 * size);
    const maximum = header.kind === "split" ? 2.3 * size : 1.42 * size;
    const shapes = portraitShapes(pixels, tone, header.bodyTop, minimum, maximum);
    const sidebar = sidebarPortraits(pixels, lines, shapes, header);
    const candidates = shapes.filter(box => {
      const edge = Math.min(box.x0 - pane.x0, pane.x1 - box.x1);
      return edge >= -2 && edge <= Math.min(paneWidth * .14, .95 * width(box)) &&
        centerY(box) < .90 * pixels.height && (header.kind !== "split" || length(box) <= 1.4 * size);
    });
    const entries = [...sidebar.entries];
    for (const avatar of candidates) {
      const side = (avatar.x0 + avatar.x1) / 2 < (pane.x0 + pane.x1) / 2 ? "left" : "right";
      const lane = [...knownAvatars, ...candidates].some(other => closeLane(avatar, other));
      if (!lane && !nearbyMessage(lines, avatar, side, pane)) continue;
      entries.push({ avatar: { ...avatar, topLimit: Math.floor(header.bodyTop) - 2 }, side });
    }
    const names = entries.filter(({ name }) => name).map(({ name }) => name.box);
    const avatars = entries.map(({ avatar }) => avatar);
    if (header.portrait) avatars.unshift(header.portrait);
    const artworkLabels = new Set(profiles.filter(({ name }) => name && !name.label && colorShare(pixels, name.box) >= .28)
      .map(({ name }) => name.box));
    return { avatars, names, artworkLabels, sidebar: sidebar.bounds };
  }

  function nicknameAboveMessage(pixels, header, { bubble, avatar }, previous) {
    const size = length(avatar);
    const area = {
      x0: bubble.x0 + .14 * size,
      x1: Math.min(header.pane.x1, bubble.x0 + 4.2 * size),
      y0: Math.max(header.bodyTop, bubble.y0 - .76 * size, (previous?.y1 ?? 0) + 1),
      y1: bubble.y0 - 1,
    };
    if (height(area) < .19 * size) return null;
    const tone = dominantTone(pixels, area) || header.tone;
    const name = pixelNickname(pixels, tone, area, bubble.x0 + .42 * size, "left", size, Math.max(6, size * .31));
    return name && width(name) >= .46 * size && height(name) <= .52 * size ? name : null;
  }

  function leftMessageRows(pixels, header, avatars, profiles) {
    if (header.kind === "inline") return profiles.filter(({ avatar, bubble, side }) =>
      side === "left" && bubble.y0 >= header.bodyTop && bubble.y0 <= avatar.y0 + .06 * length(avatar));
    if (header.kind !== "centered") return [];
    const { pane, tone } = header;
    const incoming = avatars.filter(box => box !== header.portrait && box.y0 >= header.bodyTop &&
      box.x0 >= pane.x0 && box.x1 < pane.x0 + .27 * width(pane));
    const rows = [];
    const shapes = components(pixels, tone, Math.ceil(header.bodyTop), Math.floor(.91 * pixels.height), 55);
    for (const bubble of shapes) {
      if (bubble.fill < .66 || bubble.x1 > pane.x1) continue;
      const avatar = incoming.find(box => {
        const size = length(box);
        const gap = bubble.x0 - box.x1;
        return gap >= 0 && gap <= .68 * size && width(bubble) >= 1.6 * size && height(bubble) >= .67 * size &&
          box.y0 < bubble.y1 + 2 * size && box.y1 > bubble.y0 - .5 * size;
      });
      if (avatar && surface(pixels, bubble, tone).flatness >= .43) rows.push({ bubble, avatar });
    }
    return rows;
  }

  function labelInk(pixels, box) {
    const rgb = [0, 0, 0];
    let count = 0;
    for (let y = Math.ceil(box.y0); y < box.y1; y++) {
      for (let x = Math.ceil(box.x0); x < box.x1; x++) {
        const i = pixelIndex(pixels, x, y);
        const { data } = pixels;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) < 28 || Math.min(r, g, b) > 192) continue;
        rgb[0] += r;
        rgb[1] += g;
        rgb[2] += b;
        count++;
      }
    }
    return count >= 5 ? rgb.map(value => value / count) : null;
  }

  function repeatedMessageSenders(pixels, lines, header, labels) {
    // Some conversations omit the avatar on later messages from the same sender.
    const repeated = [];
    for (const label of labels) {
      const source = lines.find(({ box, text, confidence }) => confidence >= 55 && box.x0 >= label.x0 - 2 &&
        box.x1 <= label.x1 + 2 && overlap(box, label) >= .65 && /^[\p{L}\p{M}\p{N} ._'’-]{2,40}$/u.test(text));
      if (!source) continue;
      const ink = labelInk(pixels, source.box);
      if (!ink) continue;
      const size = height(source.box);
      for (const entry of lines) {
        const { box } = entry;
        if (entry === source || entry.text !== source.text || entry.confidence < 55 || box.y0 < header.bodyTop ||
            Math.abs(box.x0 - source.box.x0) > .35 * size || Math.abs(height(box) - size) > .25 * size) continue;
        const color = labelInk(pixels, box);
        if (color && color.every((value, i) => Math.abs(value - ink[i]) < 24)) repeated.push({ ...box });
      }
    }
    return repeated;
  }

  function messageSenderLayout(pixels, lines, header, avatars, profiles, known) {
    const rows = leftMessageRows(pixels, header, avatars, profiles).sort((a, b) => a.bubble.y0 - b.bubble.y0);
    const labels = [];
    let previous;
    for (const row of rows) {
      const name = nicknameAboveMessage(pixels, header, row, previous);
      if (name) labels.push(name);
      previous = row.bubble;
    }
    return {
      names: [...labels, ...repeatedMessageSenders(pixels, lines, header, [...known, ...labels])],
      bodies: rows.map(({ bubble }) => bubble),
    };
  }

  function captionCrop(pixels, tone, area, size, kind) {
    const columns = inkColumns(pixels, tone, area);
    if (!columns.length) return null;
    const box = bounds(columns);
    return width(box) >= 1.2 * size && height(box) >= .14 * size && height(box) <= .41 * size
      ? { ...box, kind } : null;
  }

  function messageCaptionCrops(pixels, header) {
    if (header.kind !== "inline" || !header.portrait || header.count) return [];
    const { pane, tone } = header;
    const size = length(header.portrait);
    const bottom = Math.floor(.91 * pixels.height);
    const shapes = components(pixels, tone, Math.ceil(header.bodyTop), bottom, 19)
      .filter(box => box.x0 >= pane.x0 && box.x1 <= pane.x1 && height(box) >= .58 * size && box.fill >= .61);
    const bubbles = shapes.filter(box => width(box) >= 1.45 * size && height(box) <= 3.1 * size);
    const crops = [];
    for (const rail of shapes) {
      if (width(rail) > .24 * size || height(rail) > 1.62 * size || rail.fill < .72) continue;
      const left = rail.x0 < (pane.x0 + pane.x1) / 2;
      const bubble = bubbles.find(box => {
        const gap = left ? box.x0 - rail.x1 : rail.x0 - box.x1;
        return gap >= .06 * size && gap < .63 * size && Math.abs(box.y0 - rail.y0) < .19 * size &&
          Math.abs(height(box) - height(rail)) < .25 * size;
      });
      if (!bubble) continue;
      const area = {
        x0: left ? Math.max(pane.x0, bubble.x0 - .18 * size) : bubble.x0,
        x1: left ? bubble.x1 : Math.min(pane.x1, bubble.x1 + .11 * size),
        y0: Math.max(header.bodyTop, rail.y0 - .81 * size),
        y1: rail.y0 - .15 * size,
      };
      const crop = captionCrop(pixels, tone, area, size, "reply");
      if (crop && !crops.some(other => overlap(other, crop) > .65)) crops.push({ ...crop, bubble });
    }
    // A small receipt can follow the last outgoing message in a conversation with reply captions.
    if (crops.length) {
      const last = bubbles.filter(box => box.x1 > pane.x1 - .45 * size && box.y1 > .66 * pixels.height &&
        colorShare(pixels, box) > .42).sort((a, b) => b.y1 - a.y1)[0];
      if (last) {
        const area = { x0: last.x0, x1: last.x1, y0: last.y1 + 1, y1: Math.min(bottom, last.y1 + .54 * size) };
        const receipt = captionCrop(pixels, tone, area, size, "receipt");
        if (receipt) crops.push(receipt);
      }
    }
    return crops.slice(0, 12);
  }

  function captionNames(readings) {
    const names = [];
    for (const [crop, { line, confidence }] of readings) {
      if (!line || confidence < 53) continue;
      const { text } = line;
      const match = crop.kind === "receipt" ? text.match(/^(?:seen\s+by\s+|已\s*读\s*[:：]\s*)(.+?)(?:\s*\+\s*\d+)?$/iu) :
        text.match(/^(?:you\s+replied\s+to\s+|你\s*回\s*复\s*了?\s*)(.+?)[.。]?$/iu) ||
        text.match(/^(.+?)(?:\s+replied\s+to\s+you|\s*回\s*复\s*了?\s*你)[.。]?$/iu);
      if (!match) continue;
      const value = match[1];
      const start = crop.kind === "receipt" || /^(?:you\s+replied|你\s*回\s*复)/iu.test(text)
        ? text.lastIndexOf(value) : match.index;
      for (const part of value.matchAll(/[^,，]+/gu)) {
        const name = part[0].trim();
        if (!/^[\p{L}\p{M}\p{N} _.'’·-]{2,48}$/u.test(name) || !/\p{L}/u.test(name)) continue;
        const from = start + part.index + part[0].indexOf(name);
        const box = exactBoxForRange(line, from, from + name.length);
        if (!box || overlap(box, crop) < .65) continue;
        names.push({ text: name, box, bubble: crop.bubble });
      }
    }
    return names;
  }

  function sameAvatarFragment(pixels, tone, fragment, avatar, atStart) {
    const step = Math.max(1, Math.ceil(width(fragment) / 27));
    const samples = [];
    for (let y = fragment.y0; y < fragment.y1; y += step) {
      for (let x = fragment.x0; x < fragment.x1; x += step) {
        const i = pixelIndex(pixels, x, y);
        if (distance(pixels.data, i, tone) > 28) samples.push({ x, y, i });
      }
    }
    if (samples.length < 12) return false;
    const offset = atStart ? avatar.y1 - fragment.y1 : avatar.y0 - fragment.y0;
    const slack = Math.round(.14 * height(avatar));
    for (let dy = -slack; dy <= slack; dy++) {
      for (let dx = -step; dx <= step; dx++) {
        let same = 0;
        for (const { x, y, i } of samples) {
          const refX = x + dx, refY = y + offset + dy;
          if (refX < avatar.x0 || refX >= avatar.x1 || refY < avatar.y0 || refY >= avatar.y1) continue;
          const j = pixelIndex(pixels, refX, refY);
          const data = pixels.data;
          if (Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) +
            Math.abs(data[i + 2] - data[j + 2]) < 118) same++;
        }
        if (same >= .78 * samples.length) return true;
      }
    }
    return false;
  }

  function repeatedAvatars(pixels, tone, shapes, colorCrops, profiles, lines, groupTitle, speakerIds, divider) {
    const recovered = [];
    const below = divider === null ? [] : profiles.filter(({ avatar, bubble }) => avatar.y0 >= divider && bubble.y0 >= divider);
    // A divider can connect the topmost portrait to a much larger component.
    const start = (divider ?? 0) + 2;
    const edgeShapes = below.length >= 2
      ? components(pixels, tone, start, Math.min(pixels.height, start + Math.ceil(1.4 * Math.max(...below.map(({ avatar }) => height(avatar))))))
      : [];
    const edgeFragments = new Set(edgeShapes.filter(box => box.y0 <= start + 2 && height(box) < .65 * width(box)));
    const neighbors = [...shapes, ...edgeShapes];
    for (const shape of [...shapes, ...colorCrops, ...edgeFragments]) {
      const w = width(shape), h = height(shape);
      if (w < 10 || h < 5 || profiles.some(({ avatar }) => overlap(avatar, shape) > .65) ||
        recovered.some(avatar => overlap(avatar, shape) > .65)) continue;
      const clipped = h < .65 * w;
      const atDivider = edgeFragments.has(shape);
      const nearTop = shape.y0 <= 3 || atDivider ||
        (groupTitle && shape.y0 >= groupTitle.y1 && shape.y0 < .26 * pixels.height);
      const nearBottom = pixels.height - shape.y1 <= 3;
      if (clipped && (!nearTop && !nearBottom)) continue;

      let matchedSpeaker;
      for (const { avatar, side } of profiles) {
        const size = width(avatar);
        if (w < .56 * size || w > 1.12 * size || h > 1.12 * height(avatar) ||
          shape.x0 < avatar.x0 - .10 * size || shape.x1 > avatar.x1 + .10 * size) continue;
        if (clipped && h > .64 * height(avatar)) continue;
        if (!clipped && (h < .72 * height(avatar) || shape.outlined !== undefined)) continue;
        const adjacent = !clipped || neighbors.some(bubble => {
          const gap = side === "left" ? bubble.x0 - shape.x1 : shape.x0 - bubble.x1;
          const cut = nearTop ? Math.abs(bubble.y0 - shape.y0) : Math.abs(bubble.y1 - shape.y1);
          return gap >= 0 && gap <= 1.6 * size && cut <= Math.max(3, .10 * size) &&
            height(bubble) >= h && width(bubble) >= .85 * size && bubble.fill > .5;
        }) || lines.some(({ box, confidence }) => {
          const gap = side === "left" ? box.x0 - shape.x1 : shape.x0 - box.x1;
          return !(confidence < 55) && gap >= 0 && gap <= 1.85 * size &&
            Math.abs(centerY(box) - centerY(shape)) < .57 * height(avatar) && width(box) >= .75 * size;
        });
        if (!adjacent || !sameAvatarFragment(pixels, tone, shape, avatar, !clipped || nearTop)) continue;
        const speaker = speakerIds.get(avatar);
        if (matchedSpeaker !== undefined && speaker !== matchedSpeaker) {
          matchedSpeaker = undefined;
          break;
        }
        matchedSpeaker = speaker;
        if (!atDivider) break;
      }
      if (matchedSpeaker !== undefined) {
        const portrait = clipped ? { ...shape, clipped,
          x0: Math.max(0, shape.x0 - 2), x1: Math.min(pixels.width, shape.x1 + 2),
          y0: atDivider ? divider + 1 : shape.y0 } : { ...shape };
        recovered.push(portrait);
        speakerIds.set(portrait, matchedSpeaker);
      }
    }
    return recovered;
  }

  function avatarSlots(profiles, recovered, pixels, speakerIds) {
    const avatars = profiles.map(({ avatar }) => avatar);
    if (profiles.length < 2) return [...avatars, ...recovered];
    const sizes = avatars.map(box => Math.max(width(box), height(box))).sort((a, b) => a - b);
    const typical = sizes[Math.floor(sizes.length / 2)];
    const size = sizes.findLast(value => value <= 1.17 * typical);
    return [...avatars, ...recovered].map(avatar => {
      if (avatar.clipped || width(avatar) > size || height(avatar) > size ||
        width(avatar) < .44 * size || height(avatar) < .74 * size) return avatar;
      const middle = (avatar.x0 + avatar.x1) / 2;
      const lane = avatars.map(box => (box.x0 + box.x1) / 2)
        .filter(x => Math.abs(x - middle) <= .20 * size).sort((a, b) => a - b);
      const center = lane[Math.floor(lane.length / 2)] ?? middle;
      const left = Math.max(0, Math.min(pixels.width - size, avatar.x0,
        Math.max(avatar.x1 - size, Math.floor(center - size / 2))));
      const top = Math.max(0, Math.min(pixels.height - size, Math.floor(centerY(avatar) - size / 2)));
      const box = { x0: left, y0: top, x1: left + size, y1: top + size };
      if (profiles.some(({ bubble }) => overlap(bubble, box) > .08)) return avatar;
      speakerIds.set(box, speakerIds.get(avatar));
      return box;
    });
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

  function groupSpeakers(pixels, profiles, { groups, ids }) {
    const ordered = [...profiles].sort((a, b) => a.avatar.y0 - b.avatar.y0 || a.avatar.x0 - b.avatar.x0);
    for (const { avatar, side, name } of ordered) {
      const existing = ids.get(avatar);
      if (existing !== undefined) {
        if (name) {
          const group = groups[existing];
          if (group.key) name.label = group.key;
          else group.key = speakerKey(name.label);
          ids.set(name.box, existing);
        }
        continue;
      }
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

  function findRegions(pixels, lines, model, colorCrops = []) {
    const tone = dominantTone(pixels);
    if (!tone) {
      const topTone = dominantTone(pixels, { x0: .10 * pixels.width, x1: .90 * pixels.width,
        y1: Math.min(.20 * pixels.height, .22 * pixels.width) });
      return { header: conversationHeader(pixels, topTone, lines), avatars: [], associatedNames: [],
        messages: [], quoteBodies: [], graphics: [], profiles: [], quoteSenders: [], speakerIds: new Map() };
    }
    const shapes = components(pixels, tone);
    const shortest = Math.min(pixels.width, pixels.height);
    const minimum = Math.max(14, shortest * .028);
    const minimumAvatar = Math.max(11, shortest * .012);
    const cards = cardCandidates(pixels, tone, shapes, minimum);
    const outlines = cards.filter(box => box.fill < .6);
    const insideCard = box => outlines.some(card => width(card) > width(box) + 2 &&
      height(card) > height(box) + 2 && overlap(card, box) >= .98);
    // Words and icons inside an outlined card can resemble a small avatar and bubble.
    const messageShapes = shapes.filter(box => !insideCard(box));
    const likelyAvatars = avatarCandidates(messageShapes, minimumAvatar, shortest * .21);
    const detectedPairs = profilePairs(pixels, tone, messageShapes, lines, model, likelyAvatars, minimumAvatar);
    const divider = detectedPairs.length >= 2 ? headerDivider(pixels, .16 * pixels.height) : null;
    let { groupTitle, titleCrop } = chatHeader(lines, detectedPairs, pixels, divider);
    const titleArea = groupTitle || titleCrop;
    const pairs = titleArea ? detectedPairs.filter(({ avatar, bubble }) =>
      overlap(avatar, titleArea) < .65 || overlap(bubble, titleArea) < .65) : detectedPairs;
    const profiles = pairs.map(pair => ({ ...pair, name: nickname(pixels, tone, lines, pair) }));
    const speakerIds = new Map();
    const grouping = { groups: [], ids: speakerIds };
    groupSpeakers(pixels, profiles, grouping);
    const recovered = repeatedAvatars(pixels, tone, shapes, colorCrops, profiles, lines, titleArea, speakerIds, divider);
    const unpairedAvatars = [...recovered, ...likelyAvatars].filter(box => !titleArea || overlap(box, titleArea) < .65);
    const media = mediaProfiles(pixels, tone, lines, cards.filter(box => !insideCard(box)), unpairedAvatars, profiles);
    groupSpeakers(pixels, media, grouping);
    profiles.push(...media);
    if (media.length && !groupTitle && !titleCrop && profiles.length >= 2) {
      const mediaDivider = detectedPairs.length >= 2 ? divider : headerDivider(pixels, .16 * pixels.height);
      ({ groupTitle, titleCrop } = chatHeader(lines, profiles, pixels, mediaDivider));
    }

    const paired = new Set(media.map(({ avatar }) => avatar));
    const avatars = avatarSlots(profiles, recovered.filter(avatar => !paired.has(avatar)), pixels, speakerIds);
    const mediaCards = new Set(media.map(({ bubble }) => bubble));
    const graphics = shapes.filter(box => mediaCards.has(box) || (width(box) >= minimum && height(box) >= minimum &&
      box.fill >= .5 && box.x0 > 0 && box.y0 > 0 && box.x1 < pixels.width && box.y1 < pixels.height));
    const { senders, quoteBodies } = quotes(pixels, tone, shapes, lines, profiles);
    matchQuoteSpeakers(profiles, senders, speakerIds);
    return {
      avatars,
      groupTitle,
      titleCrop,
      header: groupTitle ? null : conversationHeader(pixels, tone, lines, profiles),
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

  const chat = { findRegions, pairInputs, matchQuoteSpeakers, titleBounds, additionalPortraits, memberStatus, messageSenderLayout,
    messageCaptionCrops, captionNames };
  if (typeof module !== "undefined") module.exports = chat;
  else window.ChatLayout = chat;
})();
