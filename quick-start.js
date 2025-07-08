// Quick Start QA Automation Script
// Run this immediately to start testing your Cross Switch website

const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

class QuickQAAnalyzer {
  constructor() {
    this.browser = null;
    this.page = null;
    this.issues = [];
    this.screenshots = [];
    
    // Design specifications based on your Figma
    this.designSpecs = {
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
    console.log('🚀 Starting Quick QA Analysis...');
    
    // Create directories
    await this.createDirectories();
    
    // Launch browser
    this.browser = await chromium.launch({ headless: false });
    this.page = await this.browser.newPage();
    
    // Set viewport to match design
    await this.page.setViewportSize({ width: 1200, height: 800 });
    
    console.log('✅ Browser initialized');
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
    const fullScreenshot = await this.page.screenshot({
      fullPage: true,
      path: 'screenshots/full-page.png'
    });
    
    this.screenshots.push({
      name: 'full-page',
      path: 'screenshots/full-page.png',
      timestamp: new Date().toISOString()
    });
    
    // Analyze viewport sections
    await this.analyzeViewportSections();
    
    // Check responsive behavior
    await this.checkResponsiveDesign();
    
    console.log('✅ Visual analysis complete');
  }

  async analyzeViewportSections() {
    console.log('📐 Analyzing page sections...');
    
    // Define sections to analyze
    const sections = [
      {
        name: 'hero-section',
        selector: 'header, .hero, h1',
        description: 'Main hero section with primary heading'
      },
      {
        name: 'navigation',
        selector: 'nav, .nav, .navigation',
        description: 'Main navigation menu'
      },
      {
        name: 'features',
        selector: '.features, .cards, [class*="feature"]',
        description: 'Feature cards or sections'
      },
      {
        name: 'trust-section',
        selector: '.trust, .partners, .logos',
        description: 'Trust indicators and partner logos'
      },
      {
        name: 'footer',
        selector: 'footer',
        description: 'Footer section'
      }
    ];

    for (const section of sections) {
      try {
        // Try to find the section
        const element = await this.page.locator(section.selector).first();
        
        if (await element.isVisible()) {
          // Take screenshot of the section
          await element.screenshot({
            path: `screenshots/${section.name}.png`
          });
          
          this.screenshots.push({
            name: section.name,
            path: `screenshots/${section.name}.png`,
            description: section.description,
            found: true
          });
          
          console.log(`✅ Found and captured: ${section.name}`);
        } else {
          console.log(`⚠️  Section not visible: ${section.name}`);
          this.issues.push({
            type: 'missing_section',
            section: section.name,
            description: `${section.description} not found or not visible`
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

  async checkResponsiveDesign() {
    console.log('📱 Checking responsive design...');
    
    const viewports = [
      { width: 1920, height: 1080, name: 'desktop-large' },
      { width: 1024, height: 768, name: 'tablet' },
      { width: 375, height: 667, name: 'mobile' }
    ];

    for (const viewport of viewports) {
      await this.page.setViewportSize(viewport);
      await this.page.waitForTimeout(1000); // Allow layout to adjust
      
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
    
    // Extract all text content
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

    // Check for expected content
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

    for (const expectedText of this.designSpecs.expectedTexts) {
      const found = allText.includes(expectedText.toLowerCase());
      
      if (found) {
        console.log(`✅ Found expected text: "${expectedText}"`);
      } else {
        console.log(`❌ Missing expected text: "${expectedText}"`);
        this.issues.push({
          type: 'missing_content',
          expectedText: expectedText,
          description: `Expected text "${expectedText}" not found on page`
        });
      }
    }
  }

  async performTechnicalAnalysis() {
    console.log('🔧 Performing technical analysis...');
    
    // Check page performance
    const performanceMetrics = await this.page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        loadTime: navigation.loadEventEnd - navigation.fetchStart,
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.fetchStart,
        firstPaint: performance.getEntriesByType('paint').find(p => p.name === 'first-paint')?.startTime,
        largestContentfulPaint: performance.getEntriesByType('largest-contentful-paint')[0]?.startTime
      };
    });

    // Check for console errors
    const consoleErrors = [];
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Check accessibility basics
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
    
    // Simple AI analysis based on captured data
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
    const totalSections = this.designSpecs.expectedSections.length;
    const foundSections = this.screenshots.filter(s => s.found !== false).length;
    const complianceScore = (foundSections / totalSections) * 100;
    
    return {
      score: complianceScore,
      status: complianceScore >= 80 ? 'GOOD' : complianceScore >= 60 ? 'FAIR' : 'POOR',
      details: `${foundSections}/${totalSections} expected sections found`
    };
  }

  assessContentCompliance() {
    const totalExpectedTexts = this.designSpecs.expectedTexts.length;
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
    
    // Based on issues found
    if (this.issues.some(i => i.type === 'missing_content')) {
      recommendations.push('Review content alignment with Figma design specifications');
    }
    
    if (this.issues.some(i => i.type === 'missing_section')) {
      recommendations.push('Check for missing or incorrectly structured page sections');
    }
    
    if (this.issues.some(i => i.type === 'analysis_error')) {
      recommendations.push('Review page structure and element selectors');
    }
    
    // Default recommendations
    recommendations.push('Implement automated visual regression testing');
    recommendations.push('Set up continuous monitoring of design consistency');
    recommendations.push('Consider implementing design system documentation');
    
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
      designSpecs: this.designSpecs,
      analysis: await this.generateSimpleAIAnalysis()
    };

    // Save report
    await fs.writeFile('reports/qa-report.json', JSON.stringify(report, null, 2));
    
    // Generate HTML report
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
                    <p>${screenshot.description || 'Screenshot capture'}</p>
                    <img src="../${screenshot.path}" alt="${screenshot.name}" class="screenshot">
                </div>
            `).join('')}
        </div>
        
        ${report.issues.length > 0 ? `
            <h2>Issues Found</h2>
            ${report.issues.map(issue => `
                <div class="issue">
                    <strong>${issue.type}:</strong> ${issue.description || issue.error || 'No description'}
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
      
      // Print summary
      console.log('\n' + '='.repeat(50));
      console.log('🎉 QA ANALYSIS COMPLETE');
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
  const qa = new QuickQAAnalyzer();
  qa.run();
}

module.exports = QuickQAAnalyzer;
//Quick Start QA Script - Copy the content from the artifact above
console.log('Please copy the QuickQAAnalyzer code from the artifact into this file');
console.log('Then run: node quick-start.js');
