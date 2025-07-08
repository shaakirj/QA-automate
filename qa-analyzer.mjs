import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import figma from 'figma-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

class EnhancedQAAnalyzer {
  constructor({ singlePage = null, reportType = 'html' } = {}) {
    this.browser = null;
    this.page = null;
    this.issues = [];
    this.screenshots = [];

    this.singlePage = singlePage;
    this.reportType = reportType;

    this.pagesToTest = JSON.parse(process.env.PAGE_CONFIG || '[]');
    this.defaultSections = JSON.parse(process.env.DEFAULT_SECTIONS || '{}');
    this.figmaDesignSpecs = null;

    const now = new Date();
    this.runDate = now.toISOString().replace(/[:T]/g, '-').split('.')[0];
    this.screenshotBaseDir = path.join('screenshots', this.runDate);
    this.reportBaseDir = path.join('reports', this.runDate);

    this.viewports = [
      { name: 'mobile', width: 375, height: 667 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1440, height: 900 }
    ];

    this.designTokens = {
      colors: {
        primary: '#0070f3',
        secondary: '#1c1c1e',
        // Add more colors as needed
      },
      fonts: {
        body: '"Inter", sans-serif',
        heading: '"Poppins", sans-serif',
      }
    };
  }

  async initialize() {
    await this.createDirectories();
    await this.loadFigmaDesignSpecs();
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
  }

  async createDirectories() {
    await fs.mkdir(this.screenshotBaseDir, { recursive: true });
    await fs.mkdir(this.reportBaseDir, { recursive: true });
  }

  async loadFigmaDesignSpecs() {
    if (!process.env.FIGMA_TOKEN || !process.env.FIGMA_FILE_ID) {
      console.log('⚠️ No Figma config found. Using default sections.');
      return;
    }
    try {
      const client = figma.Client({ personalAccessToken: process.env.FIGMA_TOKEN });
      const pageIds = JSON.parse(process.env.FIGMA_PAGE_IDS || '{}');

      const { data } = await client.fileNodes(process.env.FIGMA_FILE_ID, {
        ids: Object.values(pageIds)
      });

      this.figmaDesignSpecs = {};
      for (const [key, nodeId] of Object.entries(pageIds)) {
        const node = data.nodes[nodeId];
        if (!node) {
          console.log(`⚠️ No node found for page: ${key}`);
          continue;
        }
        this.figmaDesignSpecs[key] = this.parseFigmaSections(node.document);
      }
      console.log('✅ Loaded section specs from Figma');
    } catch (err) {
      console.log('❌ Failed to load from Figma. Using defaults:', err.message);
      this.figmaDesignSpecs = null;
    }
  }

  parseFigmaSections(root) {
    const sections = [];
    if (root.children) {
      for (const section of root.children) {
        if (section.name && section.absoluteBoundingBox) {
          sections.push(section.name.toLowerCase().replace(/\s+/g, '-'));
        }
      }
    }
    return sections;
  }

  async run() {
    await this.initialize();

    for (const { name: pageName, url } of this.pagesToTest) {
      if (this.singlePage && this.singlePage !== pageName) continue;

      for (const vp of this.viewports) {
        this.issues = [];
        this.screenshots = [];

        console.log(`\n🌐 Visiting: ${pageName} → ${url} at viewport: ${vp.name} (${vp.width}x${vp.height})`);
        await this.page.setViewportSize({ width: vp.width, height: vp.height });
        await this.page.goto(url, { waitUntil: 'networkidle' });

        const pageDir = path.join(this.screenshotBaseDir, `${pageName}-${vp.name}`);
        await fs.mkdir(pageDir, { recursive: true });

        await this.takeScreenshotWithDiff(pageName + `-${vp.name}`, pageDir);
        await this.analyzeSections(pageName, pageDir);
        await this.validateStyles(pageName, pageDir);
        await this.generateReport(pageName + `-${vp.name}`, url, pageDir);

        if (this.issues.length) {
          await this.sendSlackAlert(`⚠️ QA Analyzer detected issues on ${pageName} (${vp.name}) at ${this.runDate}. Please review reports.`);
        }
      }
    }

    await this.browser.close();
    console.log('\n✅ ALL PAGES COMPLETE');

    await this.generateIndexPage();
  }

  async takeScreenshotWithDiff(pageName, dir) {
    const currentPath = path.join(dir, 'current.png');
    const baselinePath = path.join(dir, 'baseline.png');
    const diffPath = path.join(dir, 'diff.png');

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
          const imgPath = path.join(dir, `${section}.png`);
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

  // Expanded style validation for multiple selectors and CSS props
  async validateStyles(pageName, dir) {
    const checks = [
      {
        name: 'header',
        selector: 'header',
        expectedStyles: {
          color: this.designTokens.colors.primary,
          'font-family': this.designTokens.fonts.heading,
          // add more if needed
        }
      },
      {
        name: 'body',
        selector: 'body',
        expectedStyles: {
          color: this.designTokens.colors.secondary,
          'font-family': this.designTokens.fonts.body,
        }
      },
      {
        name: 'footer',
        selector: 'footer',
        expectedStyles: {
          color: this.designTokens.colors.secondary,
          'font-family': this.designTokens.fonts.body,
        }
      },
      // Add more sections as needed
    ];

    for (const check of checks) {
      try {
        const el = await this.page.locator(check.selector).first();

        for (const [prop, expected] of Object.entries(check.expectedStyles)) {
          const computedValue = await el.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

          const normalizedExpected = expected.toLowerCase().replace(/['"\s]/g, '');
          const normalizedActual = computedValue.toLowerCase().replace(/['"\s]/g, '');

          if (!normalizedActual.includes(normalizedExpected)) {
            this.issues.push({
              type: 'style_mismatch',
              section: check.name,
              message: `CSS property "${prop}" expected "${expected}", but got "${computedValue.trim()}"`
            });
          }
        }
      } catch (err) {
        this.issues.push({ type: 'error', section: `style_validation_${check.name}`, message: err.message });
      }
    }
  }

  async generateReport(pageName, pageUrl, pageDir) {
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

    const htmlPath = path.join(this.reportBaseDir, `qa-report-${pageName}.html`);
    const html = `
<!DOCTYPE html><html><head><title>${pageName} QA Report</title></head><body>
<h1>QA Report: ${pageName}</h1>
<p><strong>Date:</strong> ${this.runDate}</p>
<p><strong>URL:</strong> <a href="${pageUrl}">${pageUrl}</a></p>
<p><strong>Status:</strong> ${report.summary.status}</p>

<h2>Screenshots</h2>
${report.screenshots.map(s => {
  const relPath = path.relative(this.reportBaseDir, s.path).replace(/\\/g, '/');
  return `<div><h3>${s.name}</h3><img src="${relPath}" width="600" /></div>`;
}).join('')}

<h2>Issues</h2>
${report.issues.length ? `<ul>${
  report.issues.map(i => {
    if (i.type === 'missing_section') {
      return `<li>⚠️ <strong>Missing Section:</strong> <code>${i.section}</code> — Section expected but not found.</li>`;
    } else if (i.type === 'visual_diff') {
      return `<li>🎨 <strong>Visual Difference:</strong> ${i.pixelsChanged} pixels changed.</li>`;
    } else if (i.type === 'style_mismatch') {
      return `<li>🎨 <strong>Style Mismatch:</strong> <code>${i.section}</code> — ${i.message}</li>`;
    } else if (i.type === 'error') {
      return `<li>❌ <strong>Error Processing Section:</strong> <code>${i.section}</code> — ${i.message}</li>`;
    } else {
      return `<li>🔍 <strong>Unknown Issue:</strong> ${JSON.stringify(i)}</li>`;
    }
  }).join('')
}</ul>` : '<p>✅ No issues</p>'}

</body></html>`;

    await fs.writeFile(htmlPath, html);
    return report;
  }

  async generateIndexPage() {
    const reportsRoot = path.resolve('reports');
    let folders = [];
    try {
      folders = await fs.readdir(reportsRoot, { withFileTypes: true });
    } catch {
      console.log('No reports folder found, skipping index generation.');
      return;
    }

    folders = folders.filter(f => f.isDirectory());
    folders.sort((a, b) => b.name.localeCompare(a.name));

    let indexContent = `
      <!DOCTYPE html>
      <html>
      <head><title>QA Reports Index</title></head>
      <body>
        <h1>QA Reports Index</h1>
        <ul>
    `;

    for (const folder of folders) {
      const folderPath = path.join(reportsRoot, folder.name);
      let files = [];
      try {
        files = await fs.readdir(folderPath);
      } catch {}

      const reportFiles = files.filter(f => f.endsWith('.html'));
      if (reportFiles.length === 0) continue;

      indexContent += `<li><strong>${folder.name}</strong><ul>`;

      for (const reportFile of reportFiles) {
        const reportRelPath = path.join(folder.name, reportFile).replace(/\\/g, '/');
        indexContent += `<li><a href="./${reportRelPath}">${reportFile}</a></li>`;
      }

      indexContent += '</ul></li>';
    }

    indexContent += `
        </ul>
      </body>
      </html>
    `;

    const indexPath = path.join(reportsRoot, 'index.html');
    await fs.writeFile(indexPath, indexContent);
    console.log(`🗂️ Reports index generated at ${indexPath}`);
  }

  async sendSlackAlert(message) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ text: message }),
      });
      console.log('✅ Slack alert sent');
    } catch (err) {
      console.log('❌ Slack alert failed:', err.message);
    }
  }
}

export default EnhancedQAAnalyzer;

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let singlePage = null;
  let reportType = 'html';

  for (const arg of args) {
    if (arg.startsWith('--page=')) singlePage = arg.split('=')[1];
    if (arg.startsWith('--reportType=')) reportType = arg.split('=')[1];
  }

  (async () => {
    const analyzer = new EnhancedQAAnalyzer({ singlePage, reportType });
    await analyzer.run();
  })();
}
