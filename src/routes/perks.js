const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/connection');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/perks - Listar perks disponibles
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [perks] = await pool.query('SELECT * FROM perks');
    res.json(perks);
  } catch (error) {
    console.error('Error obteniendo perks:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/perks/use - Usar un perk
router.post('/use', authMiddleware, async (req, res) => {
  try {
    const { perkId, targetUserId, groupId } = req.body;
    const userId = req.user.id;

    // Obtener perk
    const [perks] = await pool.query('SELECT * FROM perks WHERE id = ?', [perkId]);
    if (perks.length === 0) {
      return res.status(404).json({ error: 'Perk no encontrado' });
    }
    const perk = perks[0];

    // Verificar balance
    const [wallets] = await pool.query(
      'SELECT * FROM points_wallet WHERE user_id = ? AND group_id = ?',
      [userId, groupId]
    );
    if (wallets.length === 0 || wallets[0].balance < perk.cost) {
      return res.status(400).json({ error: 'No tenés suficientes puntos' });
    }

    // Verificar que el target existe en el grupo (si es ataque)
    if (perk.type === 'attack' && targetUserId) {
      const [targetMember] = await pool.query(
        'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
        [groupId, targetUserId]
      );
      if (targetMember.length === 0) {
        return res.status(400).json({ error: 'El usuario objetivo no está en el grupo' });
      }

      // Verificar protecciones del target
      const [activeWeek] = await pool.query(
        'SELECT id FROM weeks WHERE group_id = ? AND status = ?',
        [groupId, 'active']
      );
      if (activeWeek.length > 0) {
        const [protections] = await pool.query(
          'SELECT * FROM protections WHERE user_id = ? AND group_id = ? AND week_id = ? AND active = TRUE',
          [targetUserId, groupId, activeWeek[0].id]
        );
        if (protections.length > 0) {
          // Consumir la protección
          await pool.query('UPDATE protections SET active = FALSE WHERE id = ?', [protections[0].id]);
          // Devolver puntos al atacante (no se cobra)
          return res.json({ message: 'El objetivo tenía un escudo activo. Tu ataque fue bloqueado y no se te cobraron puntos.' });
        }
      }
    }

    // Descontar puntos (del balance, NO del total_earned)
    await pool.query(
      'UPDATE points_wallet SET balance = balance - ? WHERE user_id = ? AND group_id = ?',
      [perk.cost, userId, groupId]
    );

    // Obtener semana activa
    const [activeWeek] = await pool.query(
      'SELECT id FROM weeks WHERE group_id = ? AND status = ?',
      [groupId, 'active']
    );
    const weekId = activeWeek.length > 0 ? activeWeek[0].id : null;

    // Registrar uso
    const usageId = uuidv4();
    await pool.query(
      'INSERT INTO perk_usage (id, perk_id, user_id, target_user_id, group_id, week_id) VALUES (?, ?, ?, ?, ?, ?)',
      [usageId, perkId, userId, targetUserId || null, groupId, weekId]
    );

    // Aplicar efecto del perk
    const effect = JSON.parse(perk.effect || '{}');

    switch (effect.action) {
      case 'assign_extra_challenge':
        if (targetUserId && weekId) {
          // Asignar reto extra random
          const [randomChallenge] = await pool.query('SELECT id FROM challenges ORDER BY RAND() LIMIT 1');
          if (randomChallenge.length > 0) {
            const dcId = uuidv4();
            const today = new Date().toISOString().split('T')[0];
            await pool.query(
              'INSERT INTO daily_challenges (id, week_id, user_id, challenge_id, group_id, assigned_date) VALUES (?, ?, ?, ?, ?, ?)',
              [dcId, weekId, targetUserId, randomChallenge[0].id, groupId, today]
            );
          }
        }
        break;

      case 'increase_difficulty':
        // Subir dificultad de un reto pendiente del target
        if (targetUserId && weekId) {
          const [pendingChallenges] = await pool.query(
            `SELECT dc.id, dc.challenge_id FROM daily_challenges dc
             JOIN challenges c ON dc.challenge_id = c.id
             WHERE dc.user_id = ? AND dc.week_id = ? AND dc.status = 'pending'
             ORDER BY RAND() LIMIT 1`,
            [targetUserId, weekId]
          );
          if (pendingChallenges.length > 0) {
            // Reemplazar por uno más difícil
            const [harderChallenge] = await pool.query(
              "SELECT id FROM challenges WHERE difficulty IN ('dificil', 'extremo') ORDER BY RAND() LIMIT 1"
            );
            if (harderChallenge.length > 0) {
              await pool.query(
                'UPDATE daily_challenges SET challenge_id = ? WHERE id = ?',
                [harderChallenge[0].id, pendingChallenges[0].id]
              );
            }
          }
        }
        break;

      case 'steal_points':
        if (targetUserId) {
          const amount = effect.amount || 3;
          await pool.query(
            'UPDATE points_wallet SET balance = GREATEST(balance - ?, 0) WHERE user_id = ? AND group_id = ?',
            [amount, targetUserId, groupId]
          );
          await pool.query(
            'UPDATE points_wallet SET balance = balance + ? WHERE user_id = ? AND group_id = ?',
            [amount, userId, groupId]
          );
        }
        break;

      case 'shield_one_attack':
        if (weekId) {
          const protId = uuidv4();
          await pool.query(
            'INSERT INTO protections (id, user_id, group_id, week_id, type) VALUES (?, ?, ?, ?, ?)',
            [protId, userId, groupId, weekId, 'shield']
          );
        }
        break;

      case 'immunity':
        if (weekId) {
          const protId = uuidv4();
          await pool.query(
            'INSERT INTO protections (id, user_id, group_id, week_id, type) VALUES (?, ?, ?, ?, ?)',
            [protId, userId, groupId, weekId, 'immunity']
          );
        }
        break;

      case 'double_points_next':
        if (weekId) {
          const protId = uuidv4();
          await pool.query(
            'INSERT INTO protections (id, user_id, group_id, week_id, type) VALUES (?, ?, ?, ?, ?)',
            [protId, userId, groupId, weekId, 'double_points']
          );
        }
        break;
    }

    res.json({ message: `Perk "${perk.name}" usado exitosamente`, perk });
  } catch (error) {
    console.error('Error usando perk:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/perks/wallet/:groupId - Mi wallet en un grupo
router.get('/wallet/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const [wallets] = await pool.query(
      'SELECT * FROM points_wallet WHERE user_id = ? AND group_id = ?',
      [userId, groupId]
    );

    res.json(wallets[0] || { balance: 0, total_earned: 0 });
  } catch (error) {
    console.error('Error obteniendo wallet:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
