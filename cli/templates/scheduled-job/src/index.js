
async function main() {
  const started = Date.now()
  console.log('{{name}} starting at', new Date().toISOString())


  console.log('{{name}} finished in ' + (Date.now() - started) + 'ms')
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('{{name}} failed:', err)
  process.exit(1)
})
