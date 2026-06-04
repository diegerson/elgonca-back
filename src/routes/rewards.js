const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/connection');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/rewards/:groupId - Listar premios del grupo (aprobados + propuestos)
router.get('/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Premios aprobados (canjeables)
    const [approved] = await pool.query(
      "SELECT * FROM rewards WHERE group_id = ? AND status = 'approved' AND active = TRUE ORDER BY cost ASC",
      [groupId]
    );

    // Premios propuestos (pendientes de votacion)
    const [proposed] = await pool.query(
      `SELECT r.*, u.username as proposed_by,
        (SELECT COUNT(*) FROM reward_votes rv WHERE rv.reward_id = r.id AND rv.vote = 'approve') as approve_count,
        (SELECT COUNT(*) FROM reward_votes rv WHERE rv.reward_id = r.id AND rv.vote = 'reject') as reject_count,
        (SELECT vote FROM reward_votes rv WHERE rv.reward_id = r.id AND rv.user_id = ?) as my_vote
       FROM rewards r
       JOIN users u ON r.created_by = u.id
       WHERE r.group_id = ? AND r.status = 'proposed'
       ORDER BY r.created_at DESC`,
      [userId, groupId]
    );

    // Total de miembros para calcular mayoria
    const [members] = await pool.query(
      'SELECT COUNT(*) as total FROM group_members WHERE group_id = ?',
      [groupId]
    );

    res.json({ approved, proposed, totalMembers: members[0].total });
  } catch (error) {
    console.error('Error obteniendo premios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/rewards/:groupId - Proponer un premio (queda en votacion)
router.post('/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, description, cost } = req.body;
    const userId = req.user.id;

    if (!name || !cost) {
      return res.status(400).json({ error: 'Nombre y costo son obligatorios' });
    }

    const id = uuidv4();
    await pool.query(
      "INSERT INTO rewards (id, group_id, name, description, cost, created_by, status) VALUES (?, ?, ?, ?, ?, ?, 'proposed')",
      [id, groupId, name, description || '', cost, userId]
    );

    // El creador vota automaticamente a favor
    const voteId = uuidv4();
    await pool.query(
      "INSERT INTO reward_votes (id, reward_id, user_id, vote) VALUES (?, ?, ?, 'approve')",
      [voteId, id, userId]
    );

    // Verificar si con un solo voto ya alcanza (grupo de 1 persona)
    await checkRewardApproval(id, groupId);

    res.status(201).json({ id, name, description, cost, status: 'proposed' });
  } catch (error) {
    console.error('Error creando premio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/rewards/:groupId/vote/:rewardId - Votar un premio propuesto
router.post('/:groupId/vote/:rewardId', authMiddleware, async (req, res) => {
  try {
    const { groupId, rewardId } = req.params;
    const { vote } = req.body; // 'approve' o 'reject'
    const userId = req.user.id;

    if (!['approve', 'reject'].includes(vote)) {
      return res.status(400).json({ error: 'Voto invalido' });
    }

    // Verificar que el premio existe y esta propuesto
    const [rewards] = await pool.query(
      "SELECT * FROM rewards WHERE id = ? AND group_id = ? AND status = 'proposed'",
      [rewardId, groupId]
    );

    if (rewards.length === 0) {
      return res.status(404).json({ error: 'Premio no encontrado o ya fue votado' });
    }

    // Registrar voto (upsert)
    const voteId = uuidv4();
    await pool.query(
      'INSERT INTO reward_votes (id, reward_id, user_id, vote) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE vote = ?',
      [voteId, rewardId, userId, vote, vote]
    );

    // Verificar si se alcanzo mayoria
    const result = await checkRewardApproval(rewardId, groupId);

    // Contar votos actuales
    const [votes] = await pool.query(
      'SELECT vote, COUNT(*) as count FROM reward_votes WHERE reward_id = ? GROUP BY vote',
      [rewardId]
    );

    const approves = votes.find(v => v.vote === 'approve')?.count || 0;
    const rejects = votes.find(v => v.vote === 'reject')?.count || 0;

    res.json({
      message: 'Voto registrado',
      approves,
      rejects,
      result, // 'approved', 'rejected', o null (pendiente)
    });
  } catch (error) {
    console.error('Error votando premio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * Verifica si un premio alcanzo mayoria para aprobarse o rechazarse.
 */
async function checkRewardApproval(rewardId, groupId) {
  const [members] = await pool.query(
    'SELECT COUNT(*) as total FROM group_members WHERE group_id = ?',
    [groupId]
  );
  const totalMembers = members[0].total;
  const majority = Math.ceil(totalMembers / 2);

  const [votes] = await pool.query(
    'SELECT vote, COUNT(*) as count FROM reward_votes WHERE reward_id = ? GROUP BY vote',
    [rewardId]
  );

  const approves = votes.find(v => v.vote === 'approve')?.count || 0;
  const rejects = votes.find(v => v.vote === 'reject')?.count || 0;

  if (approves >= majority) {
    await pool.query("UPDATE rewards SET status = 'approved' WHERE id = ?", [rewardId]);
    return 'approved';
  } else if (rejects >= majority) {
    await pool.query("UPDATE rewards SET status = 'rejected' WHERE id = ?", [rewardId]);
    return 'rejected';
  }

  return null;
}

// POST /api/rewards/:groupId/claim/:rewardId - Canjear un premio aprobado
router.post('/:groupId/claim/:rewardId', authMiddleware, async (req, res) => {
  try {
    const { groupId, rewardId } = req.params;
    const userId = req.user.id;

    const [rewards] = await pool.query(
      "SELECT * FROM rewards WHERE id = ? AND group_id = ? AND status = 'approved' AND active = TRUE",
      [rewardId, groupId]
    );

    if (rewards.length === 0) {
      return res.status(404).json({ error: 'Premio no encontrado' });
    }

    const reward = rewards[0];

    const [lp] = await pool.query(
      'SELECT * FROM leader_points WHERE user_id = ? AND group_id = ?',
      [userId, groupId]
    );

    if (lp.length === 0 || lp[0].balance < reward.cost) {
      return res.status(400).json({
        error: 'No tenes suficientes puntos de lider',
        needed: reward.cost,
        have: lp.length > 0 ? lp[0].balance : 0,
      });
    }

    await pool.query(
      'UPDATE leader_points SET balance = balance - ? WHERE user_id = ? AND group_id = ?',
      [reward.cost, userId, groupId]
    );

    const claimId = uuidv4();
    await pool.query(
      'INSERT INTO reward_claims (id, reward_id, user_id, group_id) VALUES (?, ?, ?, ?)',
      [claimId, rewardId, userId, groupId]
    );

    res.json({ message: `Canjeaste: ${reward.name}!`, claim: { id: claimId, reward } });
  } catch (error) {
    console.error('Error canjeando premio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/rewards/:groupId/claims - Ver canjes pendientes
router.get('/:groupId/claims', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;

    const [claims] = await pool.query(
      `SELECT rc.*, r.name as reward_name, r.description as reward_description, r.cost, u.username
       FROM reward_claims rc
       JOIN rewards r ON rc.reward_id = r.id
       JOIN users u ON rc.user_id = u.id
       WHERE rc.group_id = ? AND rc.status = 'pending'
       ORDER BY rc.claimed_at DESC`,
      [groupId]
    );

    res.json(claims);
  } catch (error) {
    console.error('Error obteniendo canjes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/rewards/:groupId/fulfill/:claimId - Marcar canje como cumplido
router.post('/:groupId/fulfill/:claimId', authMiddleware, async (req, res) => {
  try {
    const { claimId } = req.params;
    await pool.query("UPDATE reward_claims SET status = 'fulfilled', fulfilled_at = NOW() WHERE id = ?", [claimId]);
    res.json({ message: 'Premio marcado como cumplido' });
  } catch (error) {
    console.error('Error cumpliendo premio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/rewards/:groupId/leader-points - Mis puntos de lider
router.get('/:groupId/leader-points', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const [lp] = await pool.query(
      'SELECT * FROM leader_points WHERE user_id = ? AND group_id = ?',
      [userId, groupId]
    );

    res.json(lp[0] || { balance: 0, total_earned: 0 });
  } catch (error) {
    console.error('Error obteniendo leader points:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
