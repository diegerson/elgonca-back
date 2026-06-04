const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/connection');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Generar código de grupo aleatorio
function generateGroupCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// POST /api/groups - Crear grupo
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;

    if (!name) {
      return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });
    }

    const id = uuidv4();
    const code = generateGroupCode();

    await pool.query(
      'INSERT INTO groups_table (id, name, code, created_by) VALUES (?, ?, ?, ?)',
      [id, name, code, userId]
    );

    // El creador se une automáticamente
    const memberId = uuidv4();
    await pool.query(
      'INSERT INTO group_members (id, group_id, user_id) VALUES (?, ?, ?)',
      [memberId, id, userId]
    );

    // Crear wallet de puntos
    const walletId = uuidv4();
    await pool.query(
      'INSERT INTO points_wallet (id, user_id, group_id, balance, total_earned) VALUES (?, ?, ?, 0, 0)',
      [walletId, userId, id]
    );

    res.status(201).json({ id, name, code });
  } catch (error) {
    console.error('Error creando grupo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/groups/join - Unirse a grupo
router.post('/join', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    const [groups] = await pool.query('SELECT * FROM groups_table WHERE code = ?', [code]);

    if (groups.length === 0) {
      return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    const group = groups[0];

    // Verificar si ya es miembro
    const [existing] = await pool.query(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [group.id, userId]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ya sos miembro de este grupo' });
    }

    const memberId = uuidv4();
    await pool.query(
      'INSERT INTO group_members (id, group_id, user_id) VALUES (?, ?, ?)',
      [memberId, group.id, userId]
    );

    // Crear wallet de puntos
    const walletId = uuidv4();
    await pool.query(
      'INSERT INTO points_wallet (id, user_id, group_id, balance, total_earned) VALUES (?, ?, ?, 0, 0)',
      [walletId, userId, group.id]
    );

    // Si hay semana activa, crear weekly_points para este usuario
    const [activeWeek] = await pool.query(
      "SELECT id FROM weeks WHERE group_id = ? AND status = 'active' LIMIT 1",
      [group.id]
    );
    if (activeWeek.length > 0) {
      const wpId = uuidv4();
      await pool.query(
        'INSERT INTO weekly_points (id, user_id, group_id, week_id, points_earned) VALUES (?, ?, ?, ?, 0)',
        [wpId, userId, group.id, activeWeek[0].id]
      );
    }

    res.json({ message: 'Te uniste al grupo', group: { id: group.id, name: group.name, code: group.code } });
  } catch (error) {
    console.error('Error uniéndose al grupo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/groups - Mis grupos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const [groups] = await pool.query(
      `SELECT g.*, COUNT(gm2.id) as member_count
       FROM groups_table g
       JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN group_members gm2 ON g.id = gm2.group_id
       WHERE gm.user_id = ?
       GROUP BY g.id`,
      [userId]
    );

    res.json(groups);
  } catch (error) {
    console.error('Error obteniendo grupos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/groups/:id - Detalle del grupo
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const [groups] = await pool.query('SELECT * FROM groups_table WHERE id = ?', [id]);
    if (groups.length === 0) {
      return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    const [members] = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, pw.balance, pw.total_earned
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       LEFT JOIN points_wallet pw ON pw.user_id = u.id AND pw.group_id = ?
       WHERE gm.group_id = ?`,
      [id, id]
    );

    res.json({ ...groups[0], members });
  } catch (error) {
    console.error('Error obteniendo grupo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
