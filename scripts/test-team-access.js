
process.env.NODE_ENV = process.env.NODE_ENV || 'development'
const crypto = require('crypto')
const { pool } = require('../backend/src/db')
const auth = require('../backend/src/auth')
const { projectAccessFor } = require('../backend/src/teamAccess')

const sha256 = (k) => crypto.createHash('sha256').update(k).digest('hex')
let failed = 0
function check(label, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label)
  if (!ok) failed++
}

async function main() {
  const stamp = Date.now()
  const ownerEmail = `owner-${stamp}@team-test.invalid`
  const memberEmail = `member-${stamp}@team-test.invalid`
  const outsiderEmail = `outsider-${stamp}@team-test.invalid`
  const passwordHash = await auth.hashPassword('test-passw0rd-A1')

  const ins = async (email) => (await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, passwordHash]
  )).rows[0].id

  let ownerId, memberId, outsiderId, teamId, sharedPid, ownPid
  try {
    ownerId = await ins(ownerEmail)
    memberId = await ins(memberEmail)
    outsiderId = await ins(outsiderEmail)

    teamId = (await pool.query(
      'INSERT INTO teams (name, owner_id) VALUES ($1, $2) RETURNING id', ['Access Test Team ' + stamp, ownerId]
    )).rows[0].id
    await pool.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)', [teamId, memberId, 'member'])

    const mkProject = async (userId, name) => {
      const key = 'dk_test_' + crypto.randomBytes(18).toString('hex')
      return (await pool.query(
        'INSERT INTO projects (user_id, name, api_key, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, name, key, sha256(key), key.slice(0, 8)]
      )).rows[0].id
    }
    sharedPid = await mkProject(ownerId, 'shared-proj ' + stamp)
    ownPid = await mkProject(ownerId, 'own-only ' + stamp)
    await pool.query('INSERT INTO team_projects (team_id, project_id, added_by) VALUES ($1, $2, $3)', [teamId, sharedPid, ownerId])

    console.log('fixtures created — running checks…')

    check('owner sees own project via projectAccessFor', !!(await projectAccessFor(sharedPid, ownerId)))
    check('member sees shared project via projectAccessFor', !!(await projectAccessFor(sharedPid, memberId)))
    check('member blocked from non-shared project', !(await projectAccessFor(ownPid, memberId)))
    check('outsider blocked from shared project', !(await projectAccessFor(sharedPid, outsiderId)))

    const call = (userId, projectId) => new Promise((resolve) => {
      const req = {
        headers: {
          authorization: 'Bearer ' + auth.generateToken(userId),
          'x-project-id': projectId,
        },
      }
      const res = {
        status(c) { this.statusCode = c; return this },
        json(b) { resolve({ nextCalled: false, statusCode: this.statusCode, body: b }); return this },
      }
      auth.authenticateProject(req, res, () => resolve({ nextCalled: true, project: req.project }))
    })

    const memberRes = await call(memberId, sharedPid)
    check('member JWT passes authenticateProject on shared project', memberRes.nextCalled && memberRes.project && memberRes.project.id === sharedPid)
    check('member JWT blocked from non-shared project (404)', !(await call(memberId, ownPid)).nextCalled)
    check('outsider JWT blocked from shared project (404)', !(await call(outsiderId, sharedPid)).nextCalled)

    const key = (await pool.query('SELECT api_key FROM projects WHERE id = $1', [sharedPid])).rows[0].api_key
    const reqKey = { headers: { 'x-api-key': key } }
    const resKey = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    let keyNext = false
    await auth.authenticateProject(reqKey, resKey, () => { keyNext = true })
    check('API-key path still works unchanged', keyNext && reqKey.project.id === sharedPid)
  } finally {
    for (const id of [ownerId, memberId, outsiderId].filter(Boolean)) {
      await pool.query('DELETE FROM users WHERE id = $1', [id])
    }
    const left = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE email LIKE '%@team-test.invalid'")
    console.log('\ncleanup: leftover test users: ' + left.rows[0].n)
  }

  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })

setTimeout(() => { console.error('TEST TIMEOUT — stuck waiting on DB/middleware'); process.exit(2) }, 45000)
