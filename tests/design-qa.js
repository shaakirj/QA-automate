const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const figma = require('figma-js');
require('dotenv').config();

class EnhancedQAAnalyzer {
  constructor() {
    this.browser = null;
    this.page = null;
    this.issues = [];
    this.screenshots = [];
    this.figmaDesignSpecs = null;
    
    this.defaultDesignSpecs = {
      expectedColors: ['#1a4a47', '#ff4d00', '#ffffff', '#f5f5f5'],
      expectedTexts: [
        'A unified switch',
        'Built for scale',
        'Powering payments across emerging markets',
        'Built with local insight. Backed by global scale',
        'Local → Global'
      ],
      expectedSections: [
        'hero',
        'features',
        'trust-indicators',
        'global-reach',
        'footer'
      ]
    };
  }

  async initialize() {
    console.log('🚀 Starting Enhanced QA Analysis...');
    await this.createDirectories();
    await this.loadFigmaDesignSpecs();
    
    this.browser = await chromium.launch({ headless: false });
    this.page = await this.browser.newPage();
    await this.page.setViewportSize({ width: 1200, height: 800 });
    
    console.log('✅ Browser initialized');
    console.log('🎨 Loaded design specs:', 
      this.figmaDesignSpecs ? 'From Figma' : 'Using default');
  }

  async createDirectories() {
    const dirs = ['screenshots', 'reports', 'analysis'];
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        // Directory exists
      }
    }
  }

  async loadFigmaDesignSpecs() {
    if (!process.env.FIGMA_TOKEN || !process.env.FIGMA_FILE_ID) {
      console.log('⚠️ Figma credentials not found. Using default design specs.');
      this.figmaDesignSpecs = null;
      return;
    }

    try {
      console.log('🔄 Loading design specs from Figma...');
      const client = figma.Client({
        personalAccessToken: process.env.FIGMA_TOKEN
      });
      
      const { data } = await client.file(process.env.FIGMA_FILE_ID);
      this.figmaDesignSpecs = this.parseFigmaData(data);
      console.log('✅ Loaded Figma design specs');
    } catch (error) {
      console.error('❌ Failed to load Figma specs:', error.message);
      this.figmaDesignSpecs = null;
    }
  }

  parseFigmaData(figmaData) {
    // Fixed rgbToHex function
    const rgbToHex = (r, g, b) => {
      const toHex = (value) => {
        const hex = Math.round(value * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      };
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    };

    const colors = new Set();
    const textStyles = new Set();
    
    const traverseNodes = (node) => {
      if (node.fills) {
        node.fills.forEach(fill => {
          if (fill.type === 'SOLID') {
            colors.add(rgbToHex(fill.color.r, fill.color.g, fill.color.b));
          }
        });
      }
      
      if (node.style) {
        if (node.style.fontFamily) {
          textStyles.add(node.style.fontFamily);
        }
      }
      
      if (node.children) {
        node.children.forEach(traverseNodes);
      }
    };
    
    traverseNodes(figmaData.document);
    
    return {
      colors: Array.from(colors),
      fonts: Array.from(textStyles),
      components: this.extractComponents(figmaData.document)
    };
  }

  extractComponents(node) {
    const components = {};
    const frameNames = ['hero', 'features', 'trust', 'footer', 'navigation'];
    
    const traverse = (n) => {
      if (frameNames.includes(n.name.toLowerCase()) && n.absoluteBoundingBox) {
        components[n.name.toLowerCase()] = {
          width: n.absoluteBoundingBox.width,
          height: n.absoluteBoundingBox.height
        };
      }
      
      if (n.children) {
        n.children.forEach(traverse);
      }
    };
    
    traverse(node);
    return components;
  }

  async navigateToSite() {
    console.log('🌐 Navigating to Cross Switch website...');
    
    try {
      await this.page.goto('https://cross-switch.staging2.liquidpreview2.net/', {
        waitUntil: 'networkidle',
        timeout: 30000
      });
      console.log('✅ Site loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load site:', error.message);
      throw error;
    }
  }

  async performVisualAnalysis() {
    console.log('👁️ Performing visual analysis...');
    
    // Take full page screenshot
    await this.page.screenshot({
      fullPage: true,
      path: 'screenshots/full-page.png'
    });
    
    this.screenshots.push({
      name: 'full-page',
      path: 'screenshots/full-page.png',
      timestamp: new Date().toISOString()
    });
    
    // Analyze viewport sections with Figma validation
    await this.analyzeViewportSections();
    
    // Check responsive behavior
    await this.checkResponsiveDesign();
    
    console.log('✅ Visual analysis complete');
  }

  async analyzeViewportSections() {
    console.log('📐 Analyzing page sections...');
    
    const sections = [
      { name: 'hero', selector: 'header, .hero, h1' },
      { name: 'navigation', selector: 'nav, .nav, .navigation' },
      { name: 'features', selector: '.features, .cards, [class*="feature"]' },
      { name: 'trust', selector: '.trust, .partners, .logos' },
      { name: 'footer', selector: 'footer' }
    ];

    for (const section of sections) {
      try {
        const element = await this.page.locator(section.selector).first();
        
        if (await element.isVisible()) {
          // Capture screenshot
          await element.screenshot({
            path: `screenshots/${section.name}.png`
          });
          
          // Validate against Figma specs
          if (this.figmaDesignSpecs?.components?.[section.name]) {
            await this.validateComponentAgainstFigma(section.name, element);
          }
          
          this.screenshots.push({
            name: section.name,
            path: `screenshots/${section.name}.png`,
            found: true
          });
          
          console.log(`✅ Found and captured: ${section.name}`);
        } else {
          console.log(`⚠️  Section not visible: ${section.name}`);
          this.issues.push({
            type: 'missing_section',
            section: section.name
          });
        }
      } catch (error) {
        console.log(`❌ Error analyzing ${section.name}:`, error.message);
        this.issues.push({
          type: 'analysis_error',
          section: section.name,
          error: error.message
        });
      }
    }
  }

  async validateComponentAgainstFigma(componentName, element) {
    const figmaSpec = this.figmaDesignSpecs.components[componentName];
    const actualSize = await element.boundingBox();
    
    if (actualSize) {
      const widthDiff = Math.abs(actualSize.width - figmaSpec.width);
      const heightDiff = Math.abs(actualSize.height - figmaSpec.height);
      
      if (widthDiff > 10) {
        this.issues.push({
          type: 'size_mismatch',
          component: componentName,
          dimension: 'width',
          expected: figmaSpec.width,
          actual: actualSize.width
        });
      }
      
      if (heightDiff > 10) {
        this.issues.push({
          type: 'size_mismatch',
          component: componentName,
          dimension: 'height',
          expected: figmaSpec.height,
          actual: actualSize.height
        });
      }
    }
  }

  async checkResponsiveDesign() {
    console.log('📱 Checking responsive design...');
    
    const viewports = [
      { width: 1920, height: 1080, name: 'desktop-large' },
      { width: 1024, height: 768, name: 'tablet' },
      { width: 375, height: 667, name: 'mobile' }
    ];

    for (const viewport of viewports) {
      await this.page.setViewportSize(viewport);
      await this.page.waitForTimeout(1000);
      
      await this.page.screenshot({
        path: `screenshots/responsive-${viewport.name}.png`,
        fullPage: true
      });
      
      this.screenshots.push({
        name: `responsive-${viewport.name}`,
        path: `screenshots/responsive-${viewport.name}.png`,
        viewport: viewport
      });
      
      console.log(`✅ Captured ${viewport.name} view`);
    }
    
    // Reset to original viewport
    await this.page.setViewportSize({ width: 1200, height: 800 });
  }

  async performContentAnalysis() {
    console.log('📝 Performing content analysis...');
    
    const textContent = await this.page.evaluate(() => {
      return {
        headings: Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
          tag: h.tagName,
          text: h.textContent.trim(),
          visible: h.offsetParent !== null
        })),
        paragraphs: Array.from(document.querySelectorAll('p')).map(p => ({
          text: p.textContent.trim(),
          visible: p.offsetParent !== null
        })).filter(p => p.text.length > 0),
        buttons: Array.from(document.querySelectorAll('button, .btn, [role="button"]')).map(b => ({
          text: b.textContent.trim(),
          visible: b.offsetParent !== null
        })),
        links: Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.textContent.trim(),
          href: a.href,
          visible: a.offsetParent !== null
        })).filter(l => l.text.length > 0)
      };
    });

    this.validateExpectedContent(textContent);
    
    console.log('✅ Content analysis complete');
    return textContent;
  }

  validateExpectedContent(textContent) {
    console.log('🔍 Validating expected content...');
    
    const allText = [
      ...textContent.headings.map(h => h.text),
      ...textContent.paragraphs.map(p => p.text),
      ...textContent.buttons.map(b => b.text),
      ...textContent.links.map(l => l.text)
    ].join(' ').toLowerCase();

    const expectedTexts = this.figmaDesignSpecs?.expectedTexts || 
                         this.defaultDesignSpecs.expectedTexts;
    
    for (const expectedText of expectedTexts) {
      const found = allText.includes(expectedText.toLowerCase());
      
      if (found) {
        console.log(`✅ Found expected text: "${expectedText}"`);
      } else {
        console.log(`❌ Missing expected text: "${expectedText}"`);
        this.issues.push({
          type: 'missing_content',
          expectedText: expectedText
        });
      }
    }
  }

  async performTechnicalAnalysis() {
    console.log('🔧 Performing technical analysis...');
    
    const performanceMetrics = await this.page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        loadTime: navigation.loadEventEnd - navigation.fetchStart,
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.fetchStart,
        firstPaint: performance.getEntriesByType('paint').find(p => p.name === 'first-paint')?.startTime,
        largestContentfulPaint: performance.getEntriesByType('largest-contentful-paint')[0]?.startTime
      };
    });

    const consoleErrors = [];
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const accessibilityIssues = await this.page.evaluate(() => {
      const issues = [];
      
      // Check for images without alt text
      const images = document.querySelectorAll('img');
      images.forEach((img, index) => {
        if (!img.alt) {
          issues.push(`Image ${index + 1} missing alt text`);
        }
      });
      
      // Check for buttons without accessible text
      const buttons = document.querySelectorAll('button, [role="button"]');
      buttons.forEach((btn, index) => {
        if (!btn.textContent.trim() && !btn.getAttribute('aria-label')) {
          issues.push(`Button ${index + 1} missing accessible text`);
        }
      });
      
      return issues;
    });

    const technicalResults = {
      performance: performanceMetrics,
      consoleErrors,
      accessibilityIssues,
      timestamp: new Date().toISOString()
    };

    console.log('✅ Technical analysis complete');
    return technicalResults;
  }

  async generateSimpleAIAnalysis() {
    console.log('🤖 Generating AI-powered analysis...');
    
    const analysis = {
      visualCompliance: this.assessVisualCompliance(),
      contentCompliance: this.assessContentCompliance(),
      technicalScore: this.calculateTechnicalScore(),
      recommendations: this.generateRecommendations()
    };

    console.log('✅ AI analysis complete');
    return analysis;
  }

  assessVisualCompliance() {
    const expectedSections = this.figmaDesignSpecs?.expectedSections || 
                           this.defaultDesignSpecs.expectedSections;
    
    const totalSections = expectedSections.length;
    const foundSections = this.screenshots.filter(s => 
      expectedSections.includes(s.name) && s.found !== false
    ).length;
    
    const complianceScore = (foundSections / totalSections) * 100;
    
    return {
      score: complianceScore,
      status: complianceScore >= 80 ? 'GOOD' : complianceScore >= 60 ? 'FAIR' : 'POOR',
      details: `${foundSections}/${totalSections} expected sections found`
    };
  }

  assessContentCompliance() {
    const expectedTexts = this.figmaDesignSpecs?.expectedTexts || 
                         this.defaultDesignSpecs.expectedTexts;
    
    const totalExpectedTexts = expectedTexts.length;
    const missingTexts = this.issues.filter(i => i.type === 'missing_content').length;
    const foundTexts = totalExpectedTexts - missingTexts;
    const complianceScore = (foundTexts / totalExpectedTexts) * 100;
    
    return {
      score: complianceScore,
      status: complianceScore >= 80 ? 'GOOD' : complianceScore >= 60 ? 'FAIR' : 'POOR',
      details: `${foundTexts}/${totalExpectedTexts} expected texts found`
    };
  }

  calculateTechnicalScore() {
    const errorCount = this.issues.filter(i => i.type === 'analysis_error').length;
    const baseScore = 100;
    const penalty = errorCount * 10;
    const score = Math.max(0, baseScore - penalty);
    
    return {
      score: score,
      status: score >= 80 ? 'GOOD' : score >= 60 ? 'FAIR' : 'POOR',
      errorCount: errorCount
    };
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (this.issues.some(i => i.type === 'missing_content')) {
      recommendations.push('Review content alignment with design specifications');
    }
    
    if (this.issues.some(i => i.type === 'missing_section')) {
      recommendations.push('Check for missing or incorrectly structured page sections');
    }
    
    if (this.issues.some(i => i.type === 'analysis_error')) {
      recommendations.push('Review page structure and element selectors');
    }
    
    if (this.issues.some(i => i.type === 'size_mismatch')) {
      recommendations.push('Verify component dimensions match Figma designs');
    }
    
    recommendations.push('Implement automated visual regression testing');
    recommendations.push('Set up continuous monitoring of design consistency');
    
    return recommendations;
  }

  async generateReport() {
    console.log('📊 Generating comprehensive report...');
    
    const report = {
      timestamp: new Date().toISOString(),
      url: 'https://cross-switch.staging2.liquidpreview2.net/',
      summary: {
        totalScreenshots: this.screenshots.length,
        totalIssues: this.issues.length,
        status: this.issues.length === 0 ? 'PASS' : 'NEEDS_REVIEW'
      },
      screenshots: this.screenshots,
      issues: this.issues,
      designSpecs: this.figmaDesignSpecs || this.defaultDesignSpecs,
      analysis: await this.generateSimpleAIAnalysis()
    };

    await fs.writeFile('reports/qa-report.json', JSON.stringify(report, null, 2));
    await this.generateHTMLReport(report);
    
    console.log('✅ Report generated: reports/qa-report.json');
    console.log('✅ HTML Report generated: reports/qa-report.html');
    
    return report;
  }

  async generateHTMLReport(report) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cross Switch QA Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .status { padding: 10px 20px; border-radius: 6px; font-weight: bold; text-align: center; margin: 20px 0; }
        .status.pass { background: #d4edda; color: #155724; }
        .status.needs-review { background: #fff3cd; color: #856404; }
        .status.fail { background: #f8d7da; color: #721c24; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 20px 0; }
        .card { background: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 4px solid #007bff; }
        .card h3 { margin-top: 0; color: #007bff; }
        .screenshot { max-width: 100%; height: auto; border-radius: 4px; margin: 10px 0; }
        .issue { background: #fff3cd; padding: 10px; margin: 10px 0; border-radius: 4px; border-left: 4px solid #ffc107; }
        .score { font-size: 24px; font-weight: bold; text-align: center; margin: 10px 0; }
        .good { color: #28a745; }
        .fair { color: #ffc107; }
        .poor { color: #dc3545; }
        .recommendations { background: #e7f3ff; padding: 15px; border-radius: 6px; }
        .recommendations ul { margin: 10px 0; padding-left: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Cross Switch QA Report</h1>
            <p>Generated: ${report.timestamp}</p>
            <p>URL: <a href="${report.url}" target="_blank">${report.url}</a></p>
            <p>Design Specs: ${report.designSpecs === this.defaultDesignSpecs ? 'Default' : 'Figma'}</p>
        </div>
        
        <div class="status ${report.summary.status.toLowerCase().replace('_', '-')}">
            Status: ${report.summary.status} | Screenshots: ${report.summary.totalScreenshots} | Issues: ${report.summary.totalIssues}
        </div>
        
        <div class="grid">
            <div class="card">
                <h3>Visual Compliance</h3>
                <div class="score ${report.analysis.visualCompliance.status.toLowerCase()}">${report.analysis.visualCompliance.score.toFixed(1)}%</div>
                <p>${report.analysis.visualCompliance.details}</p>
            </div>
            
            <div class="card">
                <h3>Content Compliance</h3>
                <div class="score ${report.analysis.contentCompliance.status.toLowerCase()}">${report.analysis.contentCompliance.score.toFixed(1)}%</div>
                <p>${report.analysis.contentCompliance.details}</p>
            </div>
            
            <div class="card">
                <h3>Technical Score</h3>
                <div class="score ${report.analysis.technicalScore.status.toLowerCase()}">${report.analysis.technicalScore.score}%</div>
                <p>Errors: ${report.analysis.technicalScore.errorCount}</p>
            </div>
        </div>
        
        <h2>Screenshots</h2>
        <div class="grid">
            ${report.screenshots.map(screenshot => `
                <div class="card">
                    <h3>${screenshot.name}</h3>
                    ${screenshot.viewport ? `<p>Viewport: ${screenshot.viewport.width}x${screenshot.viewport.height}</p>` : ''}
                    <img src="../${screenshot.path}" alt="${screenshot.name}" class="screenshot">
                </div>
            `).join('')}
        </div>
        
        ${report.issues.length > 0 ? `
            <h2>Issues Found</h2>
            ${report.issues.map(issue => `
                <div class="issue">
                    <strong>${issue.type}:</strong> ${issue.description || issue.error || 'No description'}
                    ${issue.expected ? `<br>Expected: ${issue.expected} | Actual: ${issue.actual}` : ''}
                </div>
            `).join('')}
        ` : '<div class="status pass">No issues found!</div>'}
        
        <h2>Recommendations</h2>
        <div class="recommendations">
            <ul>
                ${report.analysis.recommendations.map(rec => `<li>${rec}</li>`).join('')}
            </ul>
        </div>
    </div>
</body>
</html>`;

    await fs.writeFile('reports/qa-report.html', html);
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
    console.log('✅ Cleanup complete');
  }

  async run() {
    try {
      await this.initialize();
      await this.navigateToSite();
      await this.performVisualAnalysis();
      await this.performContentAnalysis();
      await this.performTechnicalAnalysis();
      
      const report = await this.generateReport();
      
      console.log('\n' + '='.repeat(50));
      console.log('🎉 ENHANCED QA ANALYSIS COMPLETE');
      console.log('='.repeat(50));
      console.log(`📊 Status: ${report.summary.status}`);
      console.log(`📸 Screenshots: ${report.summary.totalScreenshots}`);
      console.log(`⚠️  Issues: ${report.summary.totalIssues}`);
      console.log(`📈 Visual Compliance: ${report.analysis.visualCompliance.score.toFixed(1)}%`);
      console.log(`📝 Content Compliance: ${report.analysis.contentCompliance.score.toFixed(1)}%`);
      console.log(`🔧 Technical Score: ${report.analysis.technicalScore.score}%`);
      console.log('\n📁 Files generated:');
      console.log('  - reports/qa-report.json');
      console.log('  - reports/qa-report.html');
      console.log('  - screenshots/ (all captured images)');
      console.log('\n💡 Open reports/qa-report.html in your browser to view the full report');
      
    } catch (error) {
      console.error('❌ QA Analysis failed:', error);
    } finally {
      await this.cleanup();
    }
  }
}

// Execute the analysis
if (require.main === module) {
  const qa = new EnhancedQAAnalyzer();
  qa.run();
}

module.exports = EnhancedQAAnalyzer;