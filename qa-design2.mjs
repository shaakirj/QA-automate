// qa-analyzer.mjs

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import figma from 'figma-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import dotenv from 'dotenv';

dotenv.config();
console.log('FIGMA_FILE_ID:', process.env.FIGMA_FILE_ID);
console.log('FIGMA_TOKEN:', process.env.FIGMA_TOKEN ? '✅ Token loaded' : '❌ Token missing');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EnhancedQAAnalyzer {
  constructor() {
    this.browser = null;
    this.page = null;
    this.issues = [];
    this.screenshots = [];

    this.pagesToTest = [
      { name: 'home', url: 'https://cross-switch.staging2.liquidpreview2.net/' },
      { name: 'about', url: 'https://cross-switch.staging2.liquidpreview2.net/about' },
      { name: 'solutions', url: 'https://cross-switch.staging2.liquidpreview2.net/solutions' },
      { name: 'newsroom', url: 'https://cross-switch.staging2.liquidpreview2.net/newsroom' },
      { name: 'article', url: 'https://cross-switch.staging2.liquidpreview2.net/news/article-1' },
      { name: 'contact', url: 'https://cross-switch.staging2.liquidpreview2.net/contact' }
    ];

    this.defaultSections = {
      home: ['hero', 'features', 'footer'],
      about: ['team', 'mission', 'footer'],
      solutions: ['overview', 'features', 'cta', 'footer'],
      newsroom: ['latest-news', 'subscribe', 'footer'],
      article: ['article-content', 'author', 'footer'],
      contact: ['form', 'location', 'footer']
    };

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
    if (!process.env.FIGMA_TOKEN || !process.env.FIGMA_FILE_ID) {
      console.log('⚠️ No Figma config found. Using default sections.');
      return;
    }
  
    try {
      const client = figma.Client({ personalAccessToken: process.env.FIGMA_TOKEN });
  
      const pageIds = JSON.parse(process.env.FIGMA_PAGE_IDS);
      const { data } = await client.fileNodes(process.env.FIGMA_FILE_ID, {
        ids: Object.values(pageIds)
      });
  
      this.figmaDesignSpecs = {};
  
      for (const [key, nodeId] of Object.entries(pageIds)) {
        const node = data.nodes?.[nodeId]?.document;
  
        if (!node) {
          console.warn(`⚠️ No node found for page: ${key}`);
          continue;
        }
  
        const sections = [];
        if (node.children) {
          for (const child of node.children) {
            if (child.name && child.absoluteBoundingBox) {
              const sectionName = child.name.toLowerCase().replace(/\s+/g, '-');
              sections.push(sectionName);
            }
          }
        }
  
        this.figmaDesignSpecs[key] = sections;
      }
  
      console.log('✅ Loaded section specs from Figma');
    } catch (err) {
      console.error('❌ Failed to load from Figma. Using defaults:', err.response?.data || err.message);
      this.figmaDesignSpecs = null;
    }
  }
  

  parseFigmaSections(root) {
    const result = {};

    const walk = (node) => {
      if (node.type === 'CANVAS') {
        const pageName = node.name.toLowerCase().trim();
        result[pageName] = [];
        if (node.children) {
          for (const section of node.children) {
            if (section.name && section.absoluteBoundingBox) {
              const name = section.name.toLowerCase().replace(/\s+/g, '-');
              result[pageName].push(name);
            }
          }
        }
      }

      if (node.children) {
        node.children.forEach(walk);
      }
    };

    walk(root);
    return result;
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
      await this.generateReport(pageName, url);
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
        this.issues.push({ 
          type: 'visual_diff', 
          pixelsChanged: pixelDiff,
          message: `${pixelDiff} pixels changed between baseline and current screenshot`
        });
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
          this.issues.push({ 
            type: 'missing_section', 
            section,
            message: `Section "${section}" was not found on the page`
          });
          console.log(`⚠️ Missing: ${section}`);
        }
      } catch (err) {
        this.issues.push({ 
          type: 'error', 
          section, 
          message: err.message || 'Unknown error'
        });
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
<!DOCTYPE html>
<html>
<head>
  <title>${pageName} QA Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    img { max-width: 100%; height: auto; border: 1px solid #ccc; margin-bottom: 20px; }
    h1, h2, h3 { color: #333; }
    ul { list-style-type: disc; margin-left: 20px; }
    li { margin-bottom: 8px; }
  </style>
</head>
<body>
  <h1>QA Report: ${pageName}</h1>
  <p><strong>URL:</strong> <a href="${pageUrl}" target="_blank">${pageUrl}</a></p>
  <p><strong>Status:</strong> ${report.summary.status}</p>

  <h2>Screenshots</h2>
  ${report.screenshots.map(s => `
    <div>
      <h3>${s.name}</h3>
      <img src="../${s.path}" alt="${s.name} screenshot" />
    </div>
  `).join('')}

  <h2>Issues</h2>
  ${report.issues.length ? `<ul>${
    report.issues.map(i => `
      <li>
        <strong>${i.type}</strong> - 
        ${i.section ? `Section: ${i.section}` : ''} 
        ${i.message ? `Message: ${i.message}` : ''}
        ${i.pixelsChanged !== undefined ? `Pixels Changed: ${i.pixelsChanged}` : ''}
      </li>`).join('')
  }</ul>` : '<p>✅ No issues found</p>'}
</body>
</html>
    `;

    await fs.writeFile(htmlPath, html);
    return report;
  }
}

const qa = new EnhancedQAAnalyzer();
qa.run();
