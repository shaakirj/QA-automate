// figma-helper.js
require('dotenv').config();
const figma = require('figma-js');

module.exports = {
  getPageDesigns: async () => {
    const client = figma.Client({ personalAccessToken: process.env.FIGMA_TOKEN });
    const { data } = await client.file(process.env.FIGMA_FILE_ID);
    
    return data.document.children
      .filter(page => page.type === 'CANVAS')
      .map(page => ({
        name: page.name.toLowerCase().replace(/\s+/g, '-'),
        elements: page.children.map(node => ({
          id: node.id,
          name: node.name,
          type: node.type,
          color: node.fills?.[0]?.color,
          width: node.absoluteBoundingBox?.width,
          height: node.absoluteBoundingBox?.height
        }))
      }));
  },
  
  formatColor: ({ r, g, b }) => {
    return `rgb(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)})`;
  }
};