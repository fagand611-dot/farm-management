// Reads an .xlsx file in the browser with no libraries.
// Returns { "Tab name": [[cell, cell, ...], ...], ... } with values as strings, numbers or booleans.
// Formula cells give their last calculated value. Dates come back as Excel day numbers.

export async function readXlsx(file) {
  const files = await unzip(new Uint8Array(await file.arrayBuffer()), n => n.startsWith("xl/") && n.endsWith(".xml") || n.endsWith(".rels"));
  const xml = s => new DOMParser().parseFromString(s, "application/xml");
  const tags = (node, name) => Array.from(node.getElementsByTagNameNS("*", name));

  if (!files["xl/workbook.xml"]) throw new Error("That file isn't an Excel workbook.");
  const shared = files["xl/sharedStrings.xml"]
    ? tags(xml(files["xl/sharedStrings.xml"]), "si").map(si => tags(si, "t").map(t => t.textContent).join(""))
    : [];
  const rels = {};
  if (files["xl/_rels/workbook.xml.rels"]) {
    for (const r of tags(xml(files["xl/_rels/workbook.xml.rels"]), "Relationship")) {
      let t = r.getAttribute("Target");
      t = t.startsWith("/") ? t.slice(1) : "xl/" + t;
      rels[r.getAttribute("Id")] = t;
    }
  }
  const out = {};
  for (const sh of tags(xml(files["xl/workbook.xml"]), "sheet")) {
    const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const path = rels[rid];
    if (!path || !files[path]) continue;
    const rows = [];
    for (const row of tags(xml(files[path]), "row")) {
      const r = Number(row.getAttribute("r")) - 1;
      const cells = [];
      for (const c of tags(row, "c")) {
        const col = colIndex(c.getAttribute("r"));
        const t = c.getAttribute("t");
        const v = tags(c, "v")[0];
        let val = null;
        if (t === "s") val = v ? shared[Number(v.textContent)] ?? "" : "";
        else if (t === "b") val = v ? v.textContent === "1" : false;
        else if (t === "inlineStr") val = tags(c, "t").map(x => x.textContent).join("");
        else if (t === "str" || t === "e") val = v ? v.textContent : "";
        else if (v) val = Number(v.textContent);
        cells[col] = val;
      }
      rows[r] = cells;
    }
    out[sh.getAttribute("name")] = Array.from(rows, r => r || []);
  }
  return out;
}

function colIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Minimal zip reader using the central directory (works with data descriptors).
async function unzip(u8, want) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That file isn't an Excel workbook.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = {};
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("The workbook file looks damaged.");
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!want(name)) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const data = u8.subarray(start, start + csize);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8) bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else throw new Error("The workbook uses a compression this app can't read.");
    out[name] = dec.decode(bytes);
  }
  return out;
}

// Excel day number -> "YYYY-MM-DD"
export function excelDate(v) {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}
