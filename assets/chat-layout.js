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

  function components(pixels, tone, startY = 0, endY = pixels.height) {
    const step = Math.max(1, Math.ceil(Math.max(pixels.width, pixels.height) / 840));
    const cols = Math.ceil(pixels.width / step);
    const rows = Math.ceil((endY - startY) / step);
    const occupied = new Uint8Array(cols * rows);
    const pending = new Int32Array(occupied.length);
    for (let i = 0; i < occupied.length; i++) {
      const x = (i % cols) * step;
      const y = startY + Math.floor(i / cols) * step;
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

  function pixelNickname(pixels, tone, area, edge, side, size) {
    const columns = inkColumns(pixels, tone, area);
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
    if (!tone) return { avatars: [], associatedNames: [], messages: [], quoteBodies: [], graphics: [],
      profiles: [], quoteSenders: [], speakerIds: new Map() };
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

  const chat = { findRegions, pairInputs, matchQuoteSpeakers, titleBounds };
  if (typeof module !== "undefined") module.exports = chat;
  else window.ChatLayout = chat;
})();
