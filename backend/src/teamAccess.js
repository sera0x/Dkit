const { pool } = require('./db')


async function teamRole(teamId, userId) {
  const r = await pool.query('SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId])
  return r.rows.length > 0 ? r.rows[0].role : null
}

async function isTeamMember(teamId, userId) {
  return (await teamRole(teamId, userId)) !== null
}

async function isTeamWriteable(teamId, userId) {
  const role = await teamRole(teamId, userId)
  return role === 'owner' || role === 'admin'
}

async function sharedTeamIdsForProject(projectId) {
  const r = await pool.query(
    `SELECT t.id, t.name, tp.added_at
     FROM team_projects tp JOIN teams t ON t.id = tp.team_id
     WHERE tp.project_id = $1
     ORDER BY tp.added_at DESC`,
    [projectId]
  )
  return r.rows
}

async function listSharedProjects(userId) {
  const r = await pool.query(
    `SELECT p.id, p.name, p.key_prefix, p.key_rotated_at, p.created_at,
            p.user_id AS owner_id, u.email AS owner_email,
            string_agg(t.name, ', ' ORDER BY t.name) AS team_names,
            MAX(tp.added_at) AS shared_at
     FROM team_projects tp
     JOIN projects p ON p.id = tp.project_id
     JOIN teams t ON t.id = tp.team_id
     JOIN users u ON u.id = p.user_id
     WHERE tp.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
     GROUP BY p.id, u.email
     ORDER BY MAX(tp.added_at) DESC`,
    [userId]
  )
  return r.rows
}

async function projectAccessFor(projectId, userId) {
  const r = await pool.query(
    `SELECT p.* FROM projects p
     WHERE p.id = $1 AND (
       p.user_id = $2
       OR $2::uuid IN (
         SELECT tm.user_id FROM team_members tm
         JOIN team_projects tp ON tp.team_id = tm.team_id
         WHERE tp.project_id = p.id
       )
     )`,
    [projectId, userId]
  )
  return r.rows[0] || null
}

module.exports = { teamRole, isTeamMember, isTeamWriteable, projectAccessFor, sharedTeamIdsForProject, listSharedProjects }
