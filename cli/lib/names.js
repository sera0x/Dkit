function kebab(s) {
  return String(s).trim().toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}
function pascal(s) {
  return kebab(s).split('-').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join('')
}
function snake(s) { return kebab(s).replace(/-/g, '_') }
function validateNpmName(n) {
  if (!n) return 'name is required'
  if (n.length > 214) return 'must be 214 characters or fewer'
  if (!/^[a-z0-9]/.test(n)) return 'must start with a letter or number'
  if (!/^[a-z0-9._-]+$/.test(n)) return 'may only contain lowercase letters, numbers, dots, dashes, underscores'
  return null
}
function deriveNames(master) {
  const k = kebab(master)
  return { name: k, Name: pascal(k), name_snake: snake(k), NAME: snake(k).toUpperCase() }
}
module.exports = { kebab, pascal, snake, validateNpmName, deriveNames }
