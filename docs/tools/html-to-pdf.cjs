// Turns an HTML page into an A4 PDF with page numbers, using the installed Chrome.
//   node docs/tools/html-to-pdf.cjs <in.html> <out.pdf> "<footer title>"
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');

(async () => {
  const [input, output, title = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(input).href);
  await page.pdf({
    path: output,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#777">${title} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
  });
  await browser.close();
})();
