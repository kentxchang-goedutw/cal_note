const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

function createPng(width, height, drawPixel) {
  // PNG 簽名
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw Image Data (with filter byte 0 at start of each scanline)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  // IDAT (Compressed)
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);

  const crc = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([len, body, crcBuf]);
}

function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }

  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

// 繪製便條紙像素
function drawNoteIcon(x, y, w, h) {
  const border = 1;
  const headerH = Math.max(3, Math.floor(h * 0.25));

  // 外框外透明
  if (x < border || x >= w - border || y < border || y >= h - border) {
    return [217, 119, 6, 220]; // 琥珀橙邊框
  }

  // 頂部便條標籤 (深橙色)
  if (y <= headerH) {
    return [245, 159, 0, 255];
  }

  // 行程裝飾線
  if (w >= 32) {
    const margin = Math.floor(w * 0.18);
    const lineThickness = Math.max(1, Math.floor(h * 0.04));
    const lineYs = [Math.floor(h * 0.45), Math.floor(h * 0.65), Math.floor(h * 0.82)];
    
    for (let i = 0; i < lineYs.length; i++) {
      const ly = lineYs[i];
      const maxLineX = (i === 2) ? Math.floor(w * 0.65) : (w - margin);
      if (y >= ly && y < ly + lineThickness && x >= margin && x <= maxLineX) {
        return [140, 100, 60, 200];
      }
    }
  }

  // 便利貼本體底色 (暖黃)
  return [254, 224, 102, 255];
}

[16, 48, 128].forEach(size => {
  const pngBuf = createPng(size, size, drawNoteIcon);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), pngBuf);
  console.log(`產生 icon${size}.png 完成 (${pngBuf.length} bytes)`);
});
