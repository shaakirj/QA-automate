import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import figma from 'figma-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import dotenv from 'dotenv';
import PDFDocument from 'pdfkit';
import fetch from 'node-fetch'; // You'll need to `npm install node-fetch` for this

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EnhancedQAAnalyzer {
  constructor(runPage = null) {
    this.browser = null;
    this.page = null;
    this.issues = [];
    this.screenshots = [];
    this.runPage = runPage; // page to run only

    this.pagesToTest = [
      { name: 'home', url: 'https://cross-switch.staging2.liquidpreview2.net/' },
      { name: 'about', url: 'https://cross-switch.staging2.liquidpreview2.net/about' },
      { name: 'solutions', url: 'https://cross-switch.staging2.liquidpreview2.net/solutions' },
    ];

    // Filter if CLI arg specified
    if (this.runPage) {
      this.pagesToTest = this.pagesToTest.filter(p => p.name === this.runPage);
      if (this.pagesToTest.length === 0) {
        console.warn(`⚠️ Warning: Page name "${this.runPage}" not found in pagesToTest`);
      }
    }

    this.defaultSections = {
      home: ['hero', 'features', 'footer'],
      about: ['team', 'mission', 'footer'],
      solutions: ['overview', 'features', 'cta', 'footer'],
      newsroom: ['latest-news', 'subscribe', 'footer'],
      article: ['article-content', 'author', 'footer'],
      contact: ['form', 'location', 'footer']
    };

    // Parse FIGMA_PAGE_NODE_IDS if provided (JSON string in env)
    try {
      this.figmaPageNodeIds = process.env.FIGMA_PAGE_NODE_IDS
        ? JSON.parse(process.env.FIGMA_PAGE_NODE_IDS)
        : null;
    } catch {
      this.figmaPageNodeIds = null;
      console.warn('⚠️ Invalid FIGMA_PAGE_NODE_IDS format; expected JSON.');
    }

    this.figmaDesignSpecs = null;
  }

  async initialize() {
    await this.createDirectories();
    await this.loadFigmaDesignSpecs();
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
  }

  async createDirectories() {
    await fs.mkdir('reports', { recursive: true });
    await fs.mkdir('screenshots', { recursive: true });
  }

  async loadFigmaDesignSpecs() {
    if (!process.env.FIGMA_TOKEN) {
      console.log('⚠️ No FIGMA_TOKEN found. Using default sections.');
      return;
    }
    if (!process.env.FIGMA_FILE_ID) {
      console.log('⚠️ No FIGMA_FILE_ID found. Using default sections.');
      return;
    }

    try {
      const client = figma.Client({ personalAccessToken: process.env.FIGMA_TOKEN });
      this.figmaDesignSpecs = {};

      if (this.figmaPageNodeIds) {
        // Fetch children of each node ID individually
        for (const [pageName, nodeId] of Object.entries(this.figmaPageNodeIds)) {
          try {
            const { data } = await client.fileNodes(process.env.FIGMA_FILE_ID, {ids: nodeId});
            const node = data.nodes[nodeId]?.document;
            if (node) {
              this.figmaDesignSpecs[pageName] = this.parseFigmaSections(node);
            } else {
              console.warn(`⚠️ Node ID ${nodeId} not found in Figma file for page ${pageName}`);
            }
          } catch (err) {
            console.warn(`⚠️ Error fetching Figma node ${nodeId}: ${err.message}`);
          }
        }
      } else {
        // Fetch whole file and parse canvases as pages
        const { data } = await client.file(process.env.FIGMA_FILE_ID);
        this.figmaDesignSpecs = this.parseFigmaSections(data.document);
      }

      console.log('✅ Loaded section specs from Figma');
    } catch (err) {
      console.log('❌ Failed to load from Figma. Using defaults:', err.message);
      this.figmaDesignSpecs = null;
    }
  }

  parseFigmaSections(root) {
    // Return array of section names in node.children
    if (!root.children) return [];

    return root.children
      .filter(section => section.name && section.absoluteBoundingBox)
      .map(section => section.name.toLowerCase().replace(/\s+/g, '-'));
  }

  async run() {
    await this.initialize();

    for (const { name: pageName, url } of this.pagesToTest) {
      this.issues = [];
      this.screenshots = [];

      const pageDir = path.join('screenshots', pageName);
      await fs.mkdir(pageDir, { recursive: true });

      console.log(`\n🌐 Visiting: ${pageName} → ${url}`);
      await this.page.goto(url, { waitUntil: 'networkidle' });

      await this.takeScreenshotWithDiff(pageName, pageDir);
      await this.analyzeSections(pageName, pageDir);
      const report = await this.generateReport(pageName, url);
      await this.generatePDFReport(pageName, report);
      await this.uploadReport(pageName, report);
    }

    await this.browser.close();
    console.log('\n✅ ALL PAGES COMPLETE');
  }

  async takeScreenshotWithDiff(pageName, dir) {
    const currentPath = `${dir}/current.png`;
    const baselinePath = `${dir}/baseline.png`;
    const diffPath = `${dir}/diff.png`;

    await this.page.screenshot({ fullPage: true, path: currentPath });
    this.screenshots.push({ name: 'full-page', path: currentPath });

    try {
      await fs.access(baselinePath);
      const img1 = PNG.sync.read(await fs.readFile(currentPath));
      const img2 = PNG.sync.read(await fs.readFile(baselinePath));
      const { width, height } = img1;
      const diff = new PNG({ width, height });

      const pixelDiff = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
      await fs.writeFile(diffPath, PNG.sync.write(diff));

      this.screenshots.push({ name: 'diff', path: diffPath });

      if (pixelDiff > 50) {
        this.issues.push({ type: 'visual_diff', pixelsChanged: pixelDiff });
      }

      console.log(`🖼️ Visual diff complete: ${pixelDiff} pixels changed`);
    } catch {
      await fs.copyFile(currentPath, baselinePath);
      console.log('🆕 Baseline created for:', pageName);
    }
  }

  async analyzeSections(pageName, dir) {
    const expected = this.figmaDesignSpecs?.[pageName] || this.defaultSections[pageName] || [];

    for (const section of expected) {
      const selector = `.${section}, [class*="${section}"], section[id*="${section}"]`;
      try {
        const el = await this.page.locator(selector).first();
        if (await el.isVisible()) {
          const imgPath = `${dir}/${section}.png`;
          await el.screenshot({ path: imgPath });
          this.screenshots.push({ name: section, path: imgPath });
          console.log(`✅ Section found: ${section}`);
        } else {
          this.issues.push({ type: 'missing_section', section });
          console.log(`⚠️ Missing: ${section}`);
        }
      } catch (err) {
        this.issues.push({ type: 'error', section, message: err.message });
        console.log(`❌ Error with section ${section}: ${err.message}`);
      }
    }
  }

  async generateReport(pageName, pageUrl) {
    const report = {
      timestamp: new Date().toISOString(),
      url: pageUrl,
      summary: {
        status: this.issues.length ? 'REVIEW' : 'PASS',
        screenshots: this.screenshots.length,
        issues: this.issues.length
      },
      screenshots: this.screenshots,
      issues: this.issues
    };

    const htmlPath = `reports/qa-report-${pageName}.html`;
    const html = `
<!DOCTYPE html><html><head><title>${pageName} QA Report</title></head><body>
<h1>QA Report: ${pageName}</h1>
<p><strong>URL:</strong> <a href="${pageUrl}">${pageUrl}</a></p>
<p><strong>Status:</strong> ${report.summary.status}</p>
<h2>Screenshots</h2>
${report.screenshots.map(s => `<div><h3>${s.name}</h3><img src="../${s.path}" width="600" /></div>`).join('')}
<h2>Issues</h2>
${report.issues.length ? `<ul>${report.issues.map(i => `<li>${i.type} - ${i.section || i.message}</li>`).join('')}</ul>` : '<p>✅ No issues</p>'}
</body></html>`;

    await fs.writeFile(htmlPath, html);
    console.log(`📝 Report generated: ${htmlPath}`);
    return report;
  }

  async generatePDFReport(pageName, report) {
    return new Promise(async (resolve, reject) => {
      const pdfPath = `reports/qa-report-${pageName}.pdf`;
      const doc = new PDFDocument({ autoFirstPage: false });

      const stream = (await fs.open(pdfPath, 'w')).createWriteStream();
      doc.pipe(stream);

      doc.addPage();
      doc.fontSize(18).text(`QA Report: ${pageName}`, { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(`URL: ${report.url}`);
      doc.text(`Status: ${report.summary.status}`);
      doc.text(`Timestamp: ${report.timestamp}`);
      doc.moveDown();

      doc.fontSize(14).text('Issues:', { underline: true });
      if (report.issues.length === 0) {
        doc.text('✅ No issues');
      } else {
        report.issues.forEach(issue => {
          doc.text(`- ${issue.type}: ${issue.section || issue.message}`);
        });
      }

      doc.addPage();
      doc.fontSize(14).text('Screenshots:', { underline: true });
      for (const shot of report.screenshots) {
        try {
          const imgPath = path.resolve(shot.path);
          doc.addPage();
          doc.fontSize(12).text(shot.name);
          doc.image(imgPath, {
            fit: [500, 400],
            align: 'center',
            valign: 'center'
          });
        } catch (e) {
          console.warn(`⚠️ Failed to add image to PDF: ${shot.path}`, e.message);
        }
      }

      doc.end();

      stream.on('finish', () => {
        console.log(`📄 PDF report generated: ${pdfPath}`);
        resolve();
      });

      stream.on('error', reject);
    });
  }

  async uploadReport(pageName, report) {
    if (!process.env.DASHBOARD_API_URL) {
      // No upload configured, skip
      return;
    }

    try {
      // Example payload - customize as needed
      const payload = {
        page: pageName,
        url: report.url,
        status: report.summary.status,
        issues: report.issues,
        timestamp: report.timestamp,
      };

      const response = await fetch(process.env.DASHBOARD_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.warn(`⚠️ Failed to upload report for ${pageName}: ${response.statusText}`);
      } else {
        console.log(`🚀 Report uploaded for ${pageName}`);
      }
    } catch (e) {
      console.warn(`⚠️ Upload error for ${pageName}: ${e.message}`);
    }
  }
}

// Read CLI arg to run only one page (optional)
const runPage = process.argv[2] || null;

const qa = new EnhancedQAAnalyzer(runPage);
qa.run();
