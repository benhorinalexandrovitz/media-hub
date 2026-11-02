// Builds the "Media Sample Reviews Report" deck in the same format as the original SEIL deck.
import { fmtDate, loadImage } from './extract.js';

const W = 13.333, H = 7.5;
const TITLE_FONT = 'Samsung Sharp Sans Bold';
const BODY_FONT = 'Calibri';

function titleSlide(pptx, line1, line2, sub) {
  const s = pptx.addSlide();
  s.background = { color: '000000' };
  const runs = [{ text: line1, options: { fontSize: 62, bold: true, color: 'FFFFFF', breakLine: true } }];
  if (line2) runs.push({ text: line2, options: { fontSize: 62, bold: true, color: 'FFFFFF', breakLine: true } });
  runs.push({ text: ' ', options: { fontSize: 20, breakLine: true } });
  runs.push({ text: sub || '', options: { fontSize: 30, color: 'FFFFFF' } });
  s.addText(runs, { x: 0.6, y: 2.4, w: 10.6, h: 4.26, valign: 'top', fontFace: BODY_FONT, margin: 0 });
}

async function addImage(s, dataUrl) {
  if (!dataUrl) {
    s.addShape('rect', { x: 0.5, y: 1.6, w: 4.6, h: 4.2, fill: { color: 'F2F2F2' }, line: { color: 'D0D0D0', dashType: 'dash' } });
    s.addText('הוסיפו צילום מסך', { x: 0.5, y: 3.4, w: 4.6, h: 0.6, align: 'center', color: '999999', fontSize: 14, fontFace: BODY_FONT });
    return;
  }
  const img = await loadImage(dataUrl);
  const boxX = 0.17, boxY = 1.0, boxW = 5.1, boxH = 6.25;
  const r = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
  const w = img.naturalWidth * r, h = img.naturalHeight * r;
  // Center vertically around the text block like the original layout
  const y = Math.max(boxY, Math.min(boxY + (boxH - h) / 2, 1.6));
  s.addImage({ data: dataUrl, x: boxX + (boxW - w) / 2, y, w, h });
}

function bodyRuns(it) {
  const B = (t, extra = {}) => ({ text: t, options: { bold: true, ...extra } });
  const N = (t, extra = {}) => ({ text: t, options: { ...extra } });
  const br = { breakLine: true };
  const runs = [];
  runs.push(B('Publication:'), N(' ' + (it.publication || ''), br));
  runs.push(B('Journalist Name:'), N(' ' + (it.journalist || ''), br));
  runs.push(B('Date:'), N(' ' + fmtDate(it.date), br));
  runs.push(B('Link-'), N(' '), N(it.url, { hyperlink: { url: it.url }, color: '0563C1', underline: true, breakLine: true }));
  if (it.platform !== 'web') {
    if (it.views != null && it.views !== '') runs.push(B('Views:'), N(' ' + Number(it.views).toLocaleString('en-US'), br));
    runs.push(B('Total Potential Reach(UVM):'), N(' ' + (it.reach || ''), br));
  }
  runs.push(N(' ', br));
  runs.push(B('Headline:', br));
  runs.push(B(it.headline || '', br));
  const quotes = (it.quotes || []).filter((q) => q && q.trim());
  if (quotes.length) {
    runs.push(B('Positive Quotes (Pros) 👍', br));
    quotes.forEach((q) => runs.push(B(q.trim(), br)));
  }
  return runs;
}

function fontSizeFor(it) {
  const len = (it.headline || '').length + (it.quotes || []).join(' ').length;
  if (len > 1300) return 10;
  if (len > 1000) return 11;
  if (len > 750) return 12;
  if (len > 500) return 13;
  return 14;
}

export async function buildDeck(items, opts) {
  const pptx = new window.PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = opts.reportTitle || 'Media Sample Reviews Report';
  pptx.author = 'SEIL Media Tool';
  titleSlide(pptx, opts.reportTitle || '2026 Media Sample Reviews Report', '', opts.subsidiary || 'SEIL');
  if (opts.product) titleSlide(pptx, opts.reportTitle2 || '2026 Media Sample Reviews', opts.product, opts.subsidiary || 'SEIL');
  for (const it of items) {
    if (it.skip) continue;
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addText(opts.slideHeader || '[SEIL] TECHIE  Media Review', { x: 0.34, y: 0.25, w: 11.6, h: 0.61, fontFace: TITLE_FONT, fontSize: 30, bold: true, color: '000000', margin: 0 });
    await addImage(s, it.image);
    s.addText(bodyRuns(it), {
      x: 5.56, y: 1.25, w: 7.13, h: 5.95, valign: 'top', fontFace: BODY_FONT, fontSize: fontSizeFor(it), color: '000000',
      paraSpaceAfter: 0, margin: 0.05, fit: 'shrink',
    });
  }
  const name = (opts.fileName || 'Media Sample Reviews Report').replace(/[\\/:*?"<>|]/g, '-');
  await pptx.writeFile({ fileName: name + '.pptx' });
}
