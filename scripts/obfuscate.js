const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'out', 'panel', 'panelProvider.js');
const code = fs.readFileSync(file, 'utf8');

const result = JavaScriptObfuscator.obfuscate(code, {
    target: 'node',
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 1,
    renameGlobals: false,
    selfDefending: false,
});

fs.writeFileSync(file, result.getObfuscatedCode());

// Remove stale source map
const mapFile = file + '.map';
if (fs.existsSync(mapFile)) {
    fs.unlinkSync(mapFile);
}

console.log('Obfuscated: out/panel/panelProvider.js');
