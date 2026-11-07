const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

async function generatePdf() {
  console.log("Generating Clutch Arena Technical & Product Audit Dossier PDF...");

  const htmlPath = path.resolve(__dirname, "audit-dossier.html");
  const htmlContent = fs.readFileSync(htmlPath, "utf-8");

  const outputPath = path.resolve(process.cwd(), "Clutch_Arena_Technical_Product_Audit_Dossier.pdf");

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setContent(htmlContent, { waitUntil: "networkidle" });

  await page.pdf({
    path: outputPath,
    format: "A4",
    printBackground: true,
    margin: {
      top: "14mm",
      bottom: "14mm",
      left: "14mm",
      right: "14mm",
    },
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="font-size: 7pt; font-family: -apple-system, sans-serif; color: #81857b; width: 100%; text-align: right; padding-right: 14mm; font-weight: 600;">
        CLUTCH ARENA · TECHNICAL & PRODUCT AUDIT DOSSIER
      </div>
    `,
    footerTemplate: `
      <div style="font-size: 7pt; font-family: monospace; color: #81857b; width: 100%; display: flex; justify-content: space-between; padding: 0 14mm;">
        <span>CONFIDENTIAL · FOUNDER VALIDATION FRAMEWORK</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `,
  });

  await browser.close();
  const stats = fs.statSync(outputPath);
  console.log(`Successfully generated audit dossier PDF at: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);
}

generatePdf().catch((err) => {
  console.error("Failed to generate PDF:", err);
  process.exit(1);
});
