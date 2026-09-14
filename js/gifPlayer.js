// js/gifPlayer.js
// Custom video player engine for animated GIF files in Paw Reader.
// Decodes GIF89a using omggif (MIT License) and duck-types an HTML5 Canvas to HTMLVideoElement
// to seamlessly connect with attachCustomVideoPlayer.

import { attachCustomVideoPlayer } from "./player.js";
import { formatBytes, renderMediaProgress, showMediaUnavailableWarning } from "./utils.js";
import { PROXY_URL, state } from "./state.js";

// ============================================================================
// GIF89a Decoder (omggif by Dean McNamee, MIT License)
// ============================================================================

function GifReader(buf) {
  let p = 0;

  if (
    buf[p++] !== 0x47 ||
    buf[p++] !== 0x49 ||
    buf[p++] !== 0x46 ||
    buf[p++] !== 0x38 ||
    ((buf[p++] + 1) & 0xfd) !== 0x38 ||
    buf[p++] !== 0x61
  ) {
    throw new Error("Invalid GIF 87a/89a header.");
  }

  const width = buf[p++] | (buf[p++] << 8);
  const height = buf[p++] | (buf[p++] << 8);
  const pf0 = buf[p++];
  const global_palette_flag = pf0 >> 7;
  const num_global_colors_pow2 = pf0 & 0x7;
  const num_global_colors = 1 << (num_global_colors_pow2 + 1);
  const background = buf[p++];
  buf[p++]; // Pixel aspect ratio

  let global_palette_offset = null;
  let global_palette_size = null;

  if (global_palette_flag) {
    global_palette_offset = p;
    global_palette_size = num_global_colors;
    p += num_global_colors * 3;
  }

  let no_eof = true;
  const frames = [];
  let delay = 0;
  let transparent_index = null;
  let disposal = 0;
  let loop_count = null;

  this.width = width;
  this.height = height;

  while (no_eof && p < buf.length) {
    switch (buf[p++]) {
      case 0x21: // Extension Block
        switch (buf[p++]) {
          case 0xff: // Application extension
            if (
              buf[p] !== 0x0b ||
              buf[p + 1] === 0x4e &&
                buf[p + 2] === 0x45 &&
                buf[p + 3] === 0x54 &&
                buf[p + 4] === 0x53 &&
                buf[p + 5] === 0x43 &&
                buf[p + 6] === 0x41 &&
                buf[p + 7] === 0x50 &&
                buf[p + 8] === 0x45 &&
                buf[p + 9] === 0x32 &&
                buf[p + 10] === 0x2e &&
                buf[p + 11] === 0x30 &&
                buf[p + 12] === 0x03 &&
                buf[p + 13] === 0x01 &&
                buf[p + 16] === 0
            ) {
              p += 14;
              loop_count = buf[p++] | (buf[p++] << 8);
              p++;
            } else {
              p += 12;
              while (true) {
                const block_size = buf[p++];
                if (!(block_size >= 0)) throw new Error("Invalid block size");
                if (block_size === 0) break;
                p += block_size;
              }
            }
            break;

          case 0xf9: // Graphics Control Extension
            if (buf[p++] !== 0x4 || buf[p + 4] !== 0) {
              throw new Error("Invalid graphics extension block.");
            }
            const pf1 = buf[p++];
            delay = buf[p++] | (buf[p++] << 8);
            transparent_index = buf[p++];
            if ((pf1 & 1) === 0) transparent_index = null;
            disposal = (pf1 >> 2) & 0x7;
            p++;
            break;

          case 0xfe: // Comment Extension
            while (true) {
              const block_size = buf[p++];
              if (!(block_size >= 0)) throw new Error("Invalid block size");
              if (block_size === 0) break;
              p += block_size;
            }
            break;

          default:
            throw new Error("Unknown graphic control label: 0x" + buf[p - 1].toString(16));
        }
        break;

      case 0x2c: // Image Descriptor
        const x = buf[p++] | (buf[p++] << 8);
        const y = buf[p++] | (buf[p++] << 8);
        const w = buf[p++] | (buf[p++] << 8);
        const h = buf[p++] | (buf[p++] << 8);
        const pf2 = buf[p++];
        const local_palette_flag = pf2 >> 7;
        const interlace_flag = (pf2 >> 6) & 1;
        const num_local_colors_pow2 = pf2 & 0x7;
        const num_local_colors = 1 << (num_local_colors_pow2 + 1);
        let palette_offset = global_palette_offset;
        let palette_size = global_palette_size;
        let has_local_palette = false;
        if (local_palette_flag) {
          has_local_palette = true;
          palette_offset = p;
          palette_size = num_local_colors;
          p += num_local_colors * 3;
        }

        const data_offset = p;
        p++; // codesize
        while (true) {
          const block_size = buf[p++];
          if (!(block_size >= 0)) throw new Error("Invalid block size");
          if (block_size === 0) break;
          p += block_size;
        }

        frames.push({
          x,
          y,
          width: w,
          height: h,
          has_local_palette,
          palette_offset,
          palette_size,
          data_offset,
          data_length: p - data_offset,
          transparent_index,
          interlaced: !!interlace_flag,
          delay,
          disposal,
        });
        break;

      case 0x3b: // Trailer Marker (EOF)
        no_eof = false;
        break;

      default:
        throw new Error("Unknown gif block: 0x" + buf[p - 1].toString(16));
    }
  }

  this.numFrames = () => frames.length;
  this.loopCount = () => loop_count;
  this.frameInfo = (frame_num) => {
    if (frame_num < 0 || frame_num >= frames.length) {
      throw new Error("Frame index out of range.");
    }
    return frames[frame_num];
  };

  this.decodeAndBlitFrameRGBA = (frame_num, pixels) => {
    const frame = this.frameInfo(frame_num);
    const num_pixels = frame.width * frame.height;
    const index_stream = new Uint8Array(num_pixels);
    GifReaderLZWOutputIndexStream(buf, frame.data_offset, index_stream, num_pixels);
    const palette_offset = frame.palette_offset;
    const trans = frame.transparent_index === null ? 256 : frame.transparent_index;

    const framewidth = frame.width;
    const framestride = width - framewidth;
    let xleft = framewidth;

    let opbeg = (frame.y * width + frame.x) * 4;
    const opend = ((frame.y + frame.height) * width + frame.x) * 4;
    let op = opbeg;

    let scanstride = framestride * 4;
    if (frame.interlaced === true) {
      scanstride += width * 4 * 7;
    }

    let interlaceskip = 8;

    for (let i = 0, il = index_stream.length; i < il; ++i) {
      const index = index_stream[i];

      if (xleft === 0) {
        op += scanstride;
        xleft = framewidth;
        if (op >= opend) {
          scanstride = framestride * 4 + width * 4 * (interlaceskip - 1);
          op = opbeg + (framewidth + framestride) * (interlaceskip << 1);
          interlaceskip >>= 1;
        }
      }

      if (index === trans) {
        op += 4;
      } else {
        const r = buf[palette_offset + index * 3];
        const g = buf[palette_offset + index * 3 + 1];
        const b = buf[palette_offset + index * 3 + 2];
        pixels[op++] = r;
        pixels[op++] = g;
        pixels[op++] = b;
        pixels[op++] = 255;
      }
      --xleft;
    }
  };
}

function GifReaderLZWOutputIndexStream(code_stream, p, output, output_length) {
  const min_code_size = code_stream[p++];
  const clear_code = 1 << min_code_size;
  const eoi_code = clear_code + 1;
  let next_code = eoi_code + 1;

  let cur_code_size = min_code_size + 1;
  let code_mask = (1 << cur_code_size) - 1;
  let cur_shift = 0;
  let cur = 0;
  let op = 0;

  let subblock_size = code_stream[p++];
  const code_table = new Int32Array(4096);
  let prev_code = null;

  while (true) {
    while (cur_shift < 16) {
      if (subblock_size === 0) break;
      cur |= code_stream[p++] << cur_shift;
      cur_shift += 8;
      if (subblock_size === 1) {
        subblock_size = code_stream[p++];
      } else {
        --subblock_size;
      }
    }

    if (cur_shift < cur_code_size) break;

    const code = cur & code_mask;
    cur >>= cur_code_size;
    cur_shift -= cur_code_size;

    if (code === clear_code) {
      next_code = eoi_code + 1;
      cur_code_size = min_code_size + 1;
      code_mask = (1 << cur_code_size) - 1;
      prev_code = null;
      continue;
    } else if (code === eoi_code) {
      break;
    }

    const chase_code = code < next_code ? code : prev_code;
    let chase_length = 0;
    let chase = chase_code;
    while (chase > clear_code) {
      chase = code_table[chase] >> 8;
      ++chase_length;
    }

    const k = chase;
    const op_end = op + chase_length + (chase_code !== code ? 1 : 0);
    if (op_end > output_length) {
      return;
    }

    output[op++] = k;
    op += chase_length;
    let b = op;

    if (chase_code !== code) output[op++] = k;

    chase = chase_code;
    while (chase_length--) {
      chase = code_table[chase];
      output[--b] = chase & 0xff;
      chase >>= 8;
    }

    if (prev_code !== null && next_code < 4096) {
      code_table[next_code++] = (prev_code << 8) | k;
      if (next_code >= code_mask + 1 && cur_code_size < 12) {
        ++cur_code_size;
        code_mask = (code_mask << 1) | 1;
      }
    }

    prev_code = code;
  }

  return output;
}

// ============================================================================
// Fast Synchronous Compositor & Duck-Typed HTMLVideoElement
// ============================================================================

/**
 * Rapidly pre-composites all frames synchronously into ImageData buffers (~15-50ms total),
 * avoiding any blocking GPU/IPC roundtrips during initial loading.
 */
function compositeGifFrames(reader) {
  const width = reader.width;
  const height = reader.height;
  const numFrames = reader.numFrames();

  const compBuffer = new Uint8ClampedArray(width * height * 4);
  let savedBuffer = null;

  const processedFrames = [];
  let cumulativeCentis = 0;

  for (let i = 0; i < numFrames; i++) {
    const frame = reader.frameInfo(i);

    if (i > 0) {
      const prevFrame = reader.frameInfo(i - 1);
      if (prevFrame.disposal === 2) {
        // Disposal 2: Restore to background (clear previous frame sub-rectangle)
        for (let y = prevFrame.y; y < prevFrame.y + prevFrame.height; y++) {
          for (let x = prevFrame.x; x < prevFrame.x + prevFrame.width; x++) {
            const idx = (y * width + x) * 4;
            compBuffer[idx] = 0;
            compBuffer[idx + 1] = 0;
            compBuffer[idx + 2] = 0;
            compBuffer[idx + 3] = 0;
          }
        }
      } else if (prevFrame.disposal === 3 && savedBuffer) {
        // Disposal 3: Restore to previous snapshot
        compBuffer.set(savedBuffer);
      }
    }

    if (frame.disposal === 3) {
      savedBuffer = new Uint8ClampedArray(compBuffer);
    }

    reader.decodeAndBlitFrameRGBA(i, compBuffer);

    // Modern browsers clamp delays <= 1 (<= 10ms) to 10 (100ms) or 2
    const delayCentis = frame.delay <= 1 ? 10 : frame.delay;
    const startCentis = cumulativeCentis;
    cumulativeCentis += delayCentis;
    const endCentis = cumulativeCentis;
    const durationSec = delayCentis / 100;

    const imgData = new ImageData(new Uint8ClampedArray(compBuffer), width, height);

    processedFrames.push({
      index: i,
      startCentis,
      endCentis,
      startTime: startCentis / 100,
      endTime: endCentis / 100,
      duration: durationSec,
      bitmap: null,
      imageData: imgData,
    });
  }

  const totalDuration = cumulativeCentis / 100 || 0.1;

  return {
    width,
    height,
    numFrames,
    totalDuration,
    frames: processedFrames,
  };
}

/**
 * Creates a <canvas> element duck-typed as an HTMLVideoElement that integrates
 * seamlessly with attachCustomVideoPlayer.
 */
function createGifVideoElement(compositeData) {
  const { width, height, totalDuration, frames } = compositeData;

  const canvas = document.createElement("canvas");
  canvas.className = "post-media";
  canvas.width = width;
  canvas.height = height;
  canvas.dataset.isGif = "true";

  const ctx = canvas.getContext("2d", { willReadFrequently: false });

  let isPaused = true;
  let playbackTime = 0;
  let currentFrameIndex = -1;
  let rafId = null;
  let lastRafTime = 0;
  let isLooping = true;
  canvas._userPaused = false;

  function findFrameIndex(t) {
    if (frames.length === 0) return 0;
    const boundedTime = Math.max(0, Math.min(totalDuration, t));
    const targetCentis = Math.round(boundedTime * 100);
    for (let i = 0; i < frames.length; i++) {
      if (targetCentis >= frames[i].startCentis && (targetCentis < frames[i].endCentis || i === frames.length - 1)) {
        return i;
      }
    }
    return frames.length - 1;
  }

  function drawFrame(idx) {
    if (idx < 0 || idx >= frames.length) return;
    const f = frames[idx];
    if (f.bitmap) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(f.bitmap, 0, 0);
    } else if (f.imageData) {
      ctx.putImageData(f.imageData, 0, 0);
    }
    currentFrameIndex = idx;
  }

  function renderFrameAtTime(t) {
    const idx = findFrameIndex(t);
    if (idx !== currentFrameIndex) {
      drawFrame(idx);
    }
  }

  function tick(now) {
    if (isPaused) return;

    if (!lastRafTime) lastRafTime = now;
    const dt = (now - lastRafTime) / 1000;
    lastRafTime = now;

    playbackTime += dt;

    if (playbackTime >= totalDuration) {
      if (isLooping) {
        playbackTime = playbackTime % totalDuration;
      } else {
        playbackTime = totalDuration;
        canvas.pause();
        canvas.dispatchEvent(new Event("ended"));
        return;
      }
    }

    renderFrameAtTime(playbackTime);
    canvas.dispatchEvent(new Event("timeupdate"));

    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    lastRafTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // Draw initial frame immediately
  drawFrame(0);

  // Background non-blocking promotion to ImageBitmap for GPU caching
  if (typeof createImageBitmap === "function") {
    (async () => {
      for (const f of frames) {
        if (!canvas.isConnected && canvas.parentNode === null) break;
        try {
          if (f.imageData) {
            const bmp = await createImageBitmap(f.imageData);
            f.bitmap = bmp;
            f.imageData = null;
          }
        } catch (_) {}
      }
    })();
  }

  // --- Duck-typed HTMLVideoElement API ---
  Object.defineProperty(canvas, "videoWidth", {
    get: () => width,
    configurable: true,
  });

  Object.defineProperty(canvas, "videoHeight", {
    get: () => height,
    configurable: true,
  });

  Object.defineProperty(canvas, "duration", {
    get: () => totalDuration,
    configurable: true,
  });

  Object.defineProperty(canvas, "currentTime", {
    get: () => playbackTime,
    set: (val) => {
      const target = Math.max(0, Math.min(totalDuration, Number(val) || 0));
      playbackTime = target;
      lastRafTime = performance.now();
      renderFrameAtTime(playbackTime);
      canvas.dispatchEvent(new Event("timeupdate"));
    },
    configurable: true,
  });

  Object.defineProperty(canvas, "paused", {
    get: () => isPaused,
    configurable: true,
  });

  Object.defineProperty(canvas, "loop", {
    get: () => isLooping,
    set: (v) => {
      isLooping = !!v;
    },
    configurable: true,
  });

  Object.defineProperty(canvas, "muted", {
    get: () => true,
    set: () => {},
    configurable: true,
  });

  Object.defineProperty(canvas, "volume", {
    get: () => 0,
    set: () => {},
    configurable: true,
  });

  Object.defineProperty(canvas, "readyState", {
    get: () => 4, // HAVE_ENOUGH_DATA
    configurable: true,
  });

  Object.defineProperty(canvas, "buffered", {
    get: () => ({
      length: 1,
      start: () => 0,
      end: () => totalDuration,
    }),
    configurable: true,
  });

  canvas.play = function (fromUser = false) {
    if (fromUser) canvas._userPaused = false;
    if (!isPaused) return Promise.resolve();
    isPaused = false;
    startLoop();
    canvas.dispatchEvent(new Event("play"));
    return Promise.resolve();
  };

  canvas.pause = function (fromUser = false) {
    if (fromUser) canvas._userPaused = true;
    if (isPaused) return;
    isPaused = true;
    stopLoop();
    canvas.dispatchEvent(new Event("pause"));
  };

  // Cleanup helper to cancel animation loop and close GPU textures
  canvas._cleanupGif = function () {
    stopLoop();
    for (const f of frames) {
      if (f.bitmap && typeof f.bitmap.close === "function") {
        try {
          f.bitmap.close();
        } catch (_) {}
      }
      f.imageData = null;
    }
  };

  return canvas;
}

// ============================================================================
// Public GIF Player Loader
// ============================================================================

/**
 * Loads a GIF file rapidly, shows instant thumbnail poster preview if available,
 * decodes frames synchronously, and starts autoplaying immediately.
 */
export async function loadGifPlayer({
  item,
  url,
  filename,
  progressOverlay,
  onRetry,
  syncCarouselClones,
  playbackObserver,
}) {
  if (item.dataset.isClone === "true") {
    if (progressOverlay) progressOverlay.style.display = "none";
    return;
  }

  const abortController = new AbortController();
  item._abortController = abortController;
  const signal = abortController.signal;

  // Show immediate poster image from thumbnail if available (instant visual gratification)
  const path = item.dataset.path;
  const isImagePath = path && /\.(jpe?g|png|webp|gif|avif)$/i.test(path);
  let posterImg = null;
  if (isImagePath && (state.currentSite === "pawchive" || state.currentSite === "kemono")) {
    posterImg = document.createElement("img");
    posterImg.className = "post-media";
    posterImg.loading = "eager";
    posterImg.src = `${PROXY_URL}/${state.currentSite}/thumbnail/data${path}`;
    item.appendChild(posterImg);
  }

  renderMediaProgress(progressOverlay, "Loading...", null, filename, "", "");

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const totalSize = parseInt(response.headers.get("content-length") || "0", 10);
    let fullBuffer;

    // Fast-path for small-to-medium GIFs (< 2.5MB): fetch native ArrayBuffer in one pass
    if (totalSize > 0 && totalSize < 2.5 * 1024 * 1024) {
      const ab = await response.arrayBuffer();
      if (signal.aborted) return;
      fullBuffer = new Uint8Array(ab);
    } else {
      // Stream larger files with throttled UI progress updates
      const reader = response.body.getReader();
      const chunks = [];
      let downloadedBytes = 0;
      let lastUiUpdate = 0;

      while (true) {
        if (signal.aborted) return;
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        downloadedBytes += value.length;

        const now = Date.now();
        if (now - lastUiUpdate > 120) {
          lastUiUpdate = now;
          if (totalSize > 0) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalSize) * 100));
            const loadedStr = formatBytes(downloadedBytes);
            const totalStr = formatBytes(totalSize);
            renderMediaProgress(progressOverlay, "Loading...", percent, filename, loadedStr, totalStr);
          } else {
            renderMediaProgress(progressOverlay, "Loading...", null, filename, formatBytes(downloadedBytes), "");
          }
        }
      }

      if (signal.aborted) return;

      fullBuffer = new Uint8Array(downloadedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        fullBuffer.set(chunk, offset);
        offset += chunk.length;
      }
    }

    // Parse with omggif (synchronous & instant, ~1-3ms)
    const gifReader = new GifReader(fullBuffer);
    const numFrames = gifReader.numFrames();

    // If 1-frame static GIF, render as an <img> without video player controls
    if (numFrames <= 1) {
      if (posterImg) posterImg.remove();

      const blob = new Blob([fullBuffer], { type: "image/gif" });
      const blobUrl = URL.createObjectURL(blob);
      item._blobUrl = blobUrl;

      const img = document.createElement("img");
      img.className = "post-media";
      img.src = blobUrl;

      img.onload = () => {
        if (progressOverlay) progressOverlay.style.display = "none";
        if (typeof syncCarouselClones === "function") syncCarouselClones(item);
      };
      img.onerror = () => {
        if (progressOverlay) progressOverlay.style.display = "flex";
        showMediaUnavailableWarning(progressOverlay, {
          type: "image",
          filename,
          errorStatus: "404",
          onRetry,
        });
      };

      item.appendChild(img);
      return;
    }

    // Pre-composite frames synchronously (~15-40ms)
    const compositeData = compositeGifFrames(gifReader);

    if (signal.aborted) return;

    // Create duck-typed canvas element
    const canvas = createGifVideoElement(compositeData);

    // Remove temporary poster if one was attached
    if (posterImg) {
      posterImg.remove();
      posterImg = null;
    }

    item.appendChild(canvas);
    attachCustomVideoPlayer(canvas, item);

    if (progressOverlay) progressOverlay.style.display = "none";
    if (typeof syncCarouselClones === "function") syncCarouselClones(item);
    if (playbackObserver) playbackObserver.observe(canvas);

    // Autoplay by default!
    canvas.play().catch(() => {});

    item._cleanupGif = () => {
      if (playbackObserver) playbackObserver.unobserve(canvas);
      if (typeof canvas._cleanupGif === "function") {
        canvas._cleanupGif();
      }
    };
  } catch (err) {
    if (signal.aborted) return;
    if (posterImg) {
      posterImg.remove();
      posterImg = null;
    }

    // Optional thumbnail fallback for Kemono / Pawchive
    const path = item.dataset.path;
    const isImagePath = path && /\.(jpe?g|png|webp|gif)$/i.test(path);
    if (isImagePath && (state.currentSite === "pawchive" || state.currentSite === "kemono")) {
      const thumbImg = document.createElement("img");
      thumbImg.className = "post-media";
      thumbImg.loading = "eager";
      thumbImg.src = `${PROXY_URL}/${state.currentSite}/thumbnail/data${path}`;

      thumbImg.onload = () => {
        if (progressOverlay) progressOverlay.style.display = "none";
        if (typeof syncCarouselClones === "function") syncCarouselClones(item);
      };
      thumbImg.onerror = () => {
        if (progressOverlay) progressOverlay.style.display = "flex";
        showMediaUnavailableWarning(progressOverlay, {
          type: "gif",
          filename,
          errorStatus: "404",
          onRetry,
        });
      };

      item.appendChild(thumbImg);
      return;
    }

    if (progressOverlay) progressOverlay.style.display = "flex";
    showMediaUnavailableWarning(progressOverlay, {
      type: "gif",
      filename,
      errorStatus: err.message || "404",
      onRetry,
    });
  }
}
