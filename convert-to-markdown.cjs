#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple .gitignore parser
class GitignoreParser {
  constructor(gitignorePath) {
    this.patterns = [];
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      this.patterns = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(pattern => this.convertToRegex(pattern));
    }
  }

  convertToRegex(pattern) {
    const originalPattern = pattern;

    // Remove leading slash (anchors to root)
    const anchored = pattern.startsWith('/');
    if (anchored) {
      pattern = pattern.substring(1);
    }

    // Escape special regex characters except * and ?
    let regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\+/g, '\\+')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\^/g, '\\^')
      .replace(/\$/g, '\\$');

    // Convert gitignore wildcards to regex
    regex = regex
      .replace(/\*\*/g, '§§DOUBLESTAR§§')
      .replace(/\*/g, '[^/]*')
      .replace(/§§DOUBLESTAR§§/g, '.*')
      .replace(/\?/g, '.');

    // Handle directory-only patterns (ending with /)
    if (pattern.endsWith('/')) {
      regex = anchored ? '^' + regex : '(^|/)' + regex;
    } else {
      // For patterns like *.log, match anywhere in path including subdirectories
      if (anchored) {
        regex = '^' + regex + '($|/)';
      } else {
        regex = '(^|/)' + regex + '($|/)';
      }
    }

    return new RegExp(regex);
  }

  isIgnored(filePath) {
    return this.patterns.some(pattern => pattern.test(filePath));
  }
}

// Language mapping based on file extensions
const extensionToLanguage = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.sh': 'bash',
  '.bash': 'bash',
  '.py': 'python',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.go': 'go',
  '.rs': 'rust',
  '.sql': 'sql',
  '.toml': 'toml',
  '.env': 'bash',
  '.gitignore': 'text',
  '.dockerignore': 'text',
  '.editorconfig': 'ini',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
};

// Always exclude .git directory
const alwaysExclude = ['.git'];

// Binary file extensions to skip
const binaryExtensions = [
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz',
  '.pdf', '.mp4', '.mp3',
];

function getLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  // Check if it's a binary file
  if (binaryExtensions.includes(ext)) {
    return null;
  }

  // Return mapped language or default to text
  return extensionToLanguage[ext] || 'text';
}

function shouldExclude(filePath, rootDir, gitignoreParser, stats, outputDir) {
  const relativePath = path.relative(rootDir, filePath);
  const parts = relativePath.split(path.sep);

  // Always exclude .git
  if (parts.some(part => alwaysExclude.includes(part))) {
    if (stats) stats.skippedGit++;
    return true;
  }

  // Exclude the output directory itself
  if (filePath.startsWith(outputDir)) {
    return true;
  }

  // Check against .gitignore patterns
  if (gitignoreParser && gitignoreParser.isIgnored(relativePath)) {
    if (stats) {
      stats.skippedGitignore++;
      console.log(`Skipping (gitignored): ${relativePath}`);
    }
    return true;
  }

  return false;
}

function convertFileToMarkdown(filePath, outputDir, rootDir, stats) {
  try {
    const language = getLanguage(filePath);
    const relativePath = path.relative(rootDir, filePath);

    // Skip binary files
    if (language === null) {
      if (stats) stats.skippedBinary++;
      console.log(`Skipping (binary): ${relativePath}`);
      return;
    }

    // Read the original file
    const content = fs.readFileSync(filePath, 'utf8');

    // Create markdown content
    const markdownContent = `# ${relativePath}

\`\`\`${language}
${content}
\`\`\`
`;

    // Create output path
    const outputPath = path.join(outputDir, relativePath + '.md');

    // Create directory if it doesn't exist
    const outputDirPath = path.dirname(outputPath);
    if (!fs.existsSync(outputDirPath)) {
      fs.mkdirSync(outputDirPath, { recursive: true });
    }

    // Write markdown file
    fs.writeFileSync(outputPath, markdownContent, 'utf8');
    if (stats) stats.converted++;
    console.log(`Converted: ${relativePath} -> ${relativePath}.md`);
  } catch (error) {
    if (stats) stats.errors++;
    console.error(`Error converting ${filePath}:`, error.message);
  }
}

function walkDirectory(dir, outputDir, rootDir, gitignoreParser, stats) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);

    // Skip excluded files/directories
    if (shouldExclude(filePath, rootDir, gitignoreParser, stats, outputDir)) {
      continue;
    }

    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      walkDirectory(filePath, outputDir, rootDir, gitignoreParser, stats);
    } else if (stat.isFile()) {
      convertFileToMarkdown(filePath, outputDir, rootDir, stats);
    }
  }
}

function main() {
  const rootDir = process.argv[2] || process.cwd();
  const outputDir = process.argv[3] || path.join(rootDir, 'markdown-output');

  console.log(`Converting repository: ${rootDir}`);
  console.log(`Output directory: ${outputDir}`);

  // Parse .gitignore
  const gitignorePath = path.join(rootDir, '.gitignore');
  const gitignoreParser = new GitignoreParser(gitignorePath);

  if (fs.existsSync(gitignorePath)) {
    console.log(`Using .gitignore patterns from: ${gitignorePath}`);
  } else {
    console.log('No .gitignore found, processing all files');
  }

  // Initialize statistics
  const stats = {
    converted: 0,
    skippedGitignore: 0,
    skippedBinary: 0,
    skippedGit: 0,
    errors: 0
  };

  console.log('---');

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Start walking the directory
  walkDirectory(rootDir, outputDir, rootDir, gitignoreParser, stats);

  // Display statistics
  console.log('---');
  console.log('Conversion complete!');
  console.log('');
  console.log('Statistics:');
  console.log(`  Files converted:       ${stats.converted}`);
  console.log(`  Skipped (gitignored):  ${stats.skippedGitignore}`);
  console.log(`  Skipped (binary):      ${stats.skippedBinary}`);
  console.log(`  Skipped (.git):        ${stats.skippedGit}`);
  if (stats.errors > 0) {
    console.log(`  Errors:                ${stats.errors}`);
  }
  console.log(`  Total processed:       ${stats.converted + stats.skippedGitignore + stats.skippedBinary + stats.skippedGit + stats.errors}`);
}

main();
