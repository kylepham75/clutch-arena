const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const svgPath = path.join(__dirname, '..', 'app', 'icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

async function generate() {
  console.log('Generating minimalist PNG brand assets from icon.svg...');

  const targets = [
    { dest: path.join(__dirname, '..', 'public', 'brand-icon.png'), size: 512 },
    { dest: path.join(__dirname, '..', 'public', 'icon.png'), size: 512 },
    { dest: path.join(__dirname, '..', 'app', 'icon.png'), size: 512 },
    { dest: path.join(__dirname, '..', 'icon.png'), size: 512 },
    { dest: path.join(__dirname, '..', 'public', 'logo.png'), size: 512 },
    { dest: path.join(__dirname, '..', 'public', 'apple-icon.png'), size: 180 },
    { dest: path.join(__dirname, '..', 'public', 'apple-touch-icon.png'), size: 180 },
    { dest: path.join(__dirname, '..', 'public', 'icon-192.png'), size: 192 },
    { dest: path.join(__dirname, '..', 'public', 'favicon-32x32.png'), size: 32 },
    { dest: path.join(__dirname, '..', 'public', 'favicon-16x16.png'), size: 16 },
  ];

  for (const { dest, size } of targets) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(dest);
    console.log(`✓ Generated ${path.basename(dest)} (${size}x${size})`);
  }

  // Also write 32x32 to favicon.ico
  const favicon32 = await sharp(svgBuffer).resize(32, 32).png().toBuffer();
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'favicon.ico'), favicon32);
  console.log('✓ Updated public/favicon.ico');

  console.log('All minimalist brand icon assets generated successfully!');
}

generate().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
