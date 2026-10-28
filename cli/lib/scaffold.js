const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
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
    else out.push(full)
  }
  return out
}
function scaffold({ templateDir, targetDir, names }) {
  if (!fs.existsSync(path.join(templateDir, 'dkit.template.json'))) {
    throw new Error('Template missing dkit.template.json: ' + templateDir)
  }
  const parent = path.dirname(targetDir)
  fs.mkdirSync(parent, { recursive: true })
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
