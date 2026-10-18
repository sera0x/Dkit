// Placeholder engine + atomic renderer for the Dkit scaffolder.
// Templates are text-only by convention; binary assets are not supported.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
// Single-pass alternation: a replacement can never be re-substituted.
const PLACEHOLDER = /{{(name|Name|name_snake|NAME)}}/g
function renderText(text, names) {
  return text.replace(PLACEHOLDER, (m, key) => (key in names ? names[key] : m))
}
function renderPath(rel, names) {
  return rel.split(path.sep).map(seg => renderText(seg, names)).join(path.sep)
}
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full) // symlinks treated as files, never followed as dirs
  }
  return out
}
function scaffold({ templateDir, targetDir, names }) {
  if (!fs.existsSync(path.join(templateDir, 'dkit.template.json'))) {
    throw new Error('Template missing dkit.template.json: ' + templateDir)
  }
  const parent = path.dirname(targetDir)
  fs.mkdirSync(parent, { recursive: true })
  // Temp dir lives INSIDE the target's parent: same filesystem, so the
  // final rename is atomic. A crash mid-render leaves no partial project.
  const tmpDir = path.join(parent, '.' + path.basename(targetDir) + '.tmp-' + crypto.randomBytes(4).toString('hex'))
  fs.mkdirSync(tmpDir)
  try {
    for (const file of walk(templateDir)) {
      const rel = path.relative(templateDir, file)
      const outFull = path.join(tmpDir, renderPath(rel, names))
      fs.mkdirSync(path.dirname(outFull), { recursive: true })
      fs.writeFileSync(outFull, renderText(fs.readFileSync(file, 'utf8'), names))
    }
    fs.renameSync(tmpDir, targetDir)
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    throw err
  }
}
module.exports = { scaffold, renderText, renderPath }
