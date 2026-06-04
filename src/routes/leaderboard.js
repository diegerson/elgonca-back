const express = require('express');
const pool = require('../db/connection');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/leaderboard/:groupId - Tabla semanal del grupo
router.get('/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Obtener semana activa o en weekend del gonca
    const [weeks] = await pool.query(
      'SELECT * FROM weeks WHERE group_id = ? AND status IN (?, ?) ORDER BY created_at DESC LIMIT 1',
      [groupId, 'active', 'gonca_weekend']
    );

    if (weeks.length === 0) {
      return res.json({ week: null, leaderboard: [] });
    }

    const week = weeks[0];

    // Tabla de puntos GANADOS esta semana (no importa si los gastaron)
    const [leaderboard] = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, COALESCE(wp.points_earned, 0) as points_earned
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       LEFT JOIN weekly_points wp ON wp.user_id = u.id AND wp.group_id = ? AND wp.week_id = ?
       WHERE gm.group_id = ?
       ORDER BY points_earned DESC`,
      [groupId, week.id, groupId]
    );

    // Info del gonca si la semana terminó
    let gonca = null;
    if (week.gonca_user_id) {
      const [goncaUser] = await pool.query(
        'SELECT u.username, c.title as challenge_title, c.description as challenge_description FROM users u LEFT JOIN challenges c ON c.id = ? WHERE u.id = ?',
        [week.gonca_challenge_id, week.gonca_user_id]
      );
      gonca = goncaUser[0] || null;
    }

    res.json({ week, leaderboard, gonca });
  } catch (error) {
    console.error('Error obteniendo leaderboard:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/leaderboard/:groupId/history - Historial de semanas
router.get('/:groupId/history', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;

    const [weeks] = await pool.query(
      `SELECT w.*, u.username as gonca_username
       FROM weeks w
       LEFT JOIN users u ON w.gonca_user_id = u.id
       WHERE w.group_id = ? AND w.status = 'finished'
       ORDER BY w.start_date DESC
       LIMIT 20`,
      [groupId]
    );

    res.json(weeks);
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
