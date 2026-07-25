const fs = require('fs');
const path = require('path');

function generateMarkdownReport(ledger) {
  const lines = [`# DIEM Publication Report: ${ledger.date}`, ''];
  
  for (const [category, pub] of Object.entries(ledger.publications)) {
    lines.push(`## ${category.toUpperCase()} (${pub.status})`);
    
    if (pub.candidate) {
      lines.push(`### 📰 Selected Article`);
      lines.push(`- **Title**: ${pub.candidate.title}`);
      lines.push(`- **Target**: ${pub.candidate.target} / **Event**: ${pub.candidate.event}`);
    }
    
    if (pub.editorial?.title) {
      lines.push(`### 📝 Editorial Generation`);
      lines.push(`- **Cover Title**: ${pub.editorial.title.text.replace(/\n/g, ' ')}`);
      lines.push(`- **Caption**: ${pub.editorial.caption.sentences[0]} ...`);
      lines.push(`- **Selection Reason**: ${pub.editorial.title.selectionReason}`);
    }
    
    if (pub.image) {
      lines.push(`### 🎨 Image Selection`);
      lines.push(`- **Source**: ${pub.image.source} (${pub.image.id})`);
      lines.push(`- **Query**: \`${pub.image.query}\``);
      lines.push(`- **Reason**: ${pub.image.selectionReason}`);
    }

    if (pub.audio) {
      lines.push(`### 🎵 Audio`);
      lines.push(`- **Track**: ${pub.audio.trackId || 'silent'}`);
      lines.push(`- **Reason**: ${pub.audio.reason}`);
    }

    if (pub.reel?.permalink) {
      lines.push(`### ✅ Published URL`);
      lines.push(`- [Instagram Reel](${pub.reel.permalink})`);
    }

    lines.push('---');
  }
  return lines.join('\n');
}

function saveMarkdownReport(ledger, jsonPath) {
  try {
    const reportPath = jsonPath.replace(/\.json$/, '.md');
    const md = generateMarkdownReport(ledger);
    fs.writeFileSync(reportPath, md, 'utf8');
  } catch (err) {
    console.error('[DIEM Report] Failed to save markdown report:', err.message);
  }
}

module.exports = {
  generateMarkdownReport,
  saveMarkdownReport,
};
