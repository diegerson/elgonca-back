const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/connection');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

/**
 * Selecciona un perk basado en probabilidades (ruleta ponderada).
 */
function spinRoulette(perks) {
  const totalProb = perks.reduce((sum, p) => sum + parseFloat(p.probability), 0);
  let random = Math.random() * totalProb;

  for (const perk of perks) {
    random -= parseFloat(perk.probability);
    if (random <= 0) {
      return perk;
    }
  }
  // Fallback al último
  return perks[perks.length - 1];
}

// POST /api/spin/:groupId - Tirar la ruleta diaria
router.post('/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Verificar si ya tiró hoy
    const [existing] = await pool.query(
      'SELECT * FROM daily_spins WHERE user_id = ? AND group_id = ? AND spin_date = ?',
      [userId, groupId, today]
    );

    if (existing.length > 0) {
      // Ya tiró, devolver el resultado anterior
      const [perk] = await pool.query('SELECT * FROM perks WHERE id = ?', [existing[0].perk_id]);
      return res.status(409).json({
        error: 'Ya tiraste la ruleta hoy',
        perk: perk[0],
        alreadySpun: true,
      });
    }

    // Obtener todos los perks con probabilidad
    const [perks] = await pool.query('SELECT * FROM perks WHERE probability > 0');

    if (perks.length === 0) {
      return res.status(500).json({ error: 'No hay perks configurados' });
    }

    // Girar la ruleta
    const wonPerk = spinRoulette(perks);

    // Registrar la tirada
    const spinId = uuidv4();
    await pool.query(
      'INSERT INTO daily_spins (id, user_id, group_id, perk_id, spin_date) VALUES (?, ?, ?, ?, ?)',
      [spinId, userId, groupId, wonPerk.id, today]
    );

    // Si el perk es "Nada", no guardar en inventario
    const effect = typeof wonPerk.effect === 'string' ? JSON.parse(wonPerk.effect) : wonPerk.effect;
    if (effect && effect.action === 'nothing') {
      return res.json({
        perk: wonPerk,
        message: 'Mejor suerte maniana... 🫠',
        requiresTarget: false,
        savedToInventory: false,
      });
    }

    // Guardar en inventario para usar cuando quiera
    const invId = uuidv4();
    await pool.query(
      'INSERT INTO perk_inventory (id, user_id, group_id, perk_id) VALUES (?, ?, ?, ?)',
      [invId, userId, groupId, wonPerk.id]
    );

    // Determinar si requiere elegir un target
    const requiresTarget = wonPerk.type === 'attack';

    res.json({
      perk: wonPerk,
      message: `Sacaste: ${wonPerk.name}! (${wonPerk.rarity})`,
      requiresTarget,
      savedToInventory: true,
      inventoryId: invId,
    });
  } catch (error) {
    console.error('Error en ruleta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/spin/:groupId/use - Usar el perk ganado en la ruleta
router.post('/:groupId/use', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { inventoryId, targetUserId } = req.body;
    const userId = req.user.id;

    // Verificar que el perk está en el inventario y no fue usado
    const [inv] = await pool.query(
      'SELECT * FROM perk_inventory WHERE id = ? AND user_id = ? AND group_id = ? AND used = FALSE',
      [inventoryId, userId, groupId]
    );

    if (inv.length === 0) {
      return res.status(400).json({ error: 'Perk no encontrado en tu inventario' });
    }

    const perkId = inv[0].perk_id;
    const [perks] = await pool.query('SELECT * FROM perks WHERE id = ?', [perkId]);
    const perk = perks[0];
    const effect = typeof perk.effect === 'string' ? JSON.parse(perk.effect) : perk.effect;

    // Obtener semana activa
    const [activeWeek] = await pool.query(
      "SELECT id FROM weeks WHERE group_id = ? AND status = 'active' LIMIT 1",
      [groupId]
    );
    const weekId = activeWeek.length > 0 ? activeWeek[0].id : null;

    // Verificar protecciones del target (escudo/espejo)
    if (perk.type === 'attack' && targetUserId && weekId) {
      // Verificar espejo
      const [mirror] = await pool.query(
        "SELECT id FROM protections WHERE user_id = ? AND group_id = ? AND type = 'mirror' AND active = TRUE",
        [targetUserId, groupId]
      );
      if (mirror.length > 0) {
        await pool.query('UPDATE protections SET active = FALSE WHERE id = ?', [mirror[0].id]);
        // Reflejar: el atacante se convierte en target
        return res.json({ message: `El ataque fue reflejado! ${perk.name} te afecta a vos.`, reflected: true });
      }

      // Verificar escudo
      const [shield] = await pool.query(
        "SELECT id FROM protections WHERE user_id = ? AND group_id = ? AND type IN ('shield_48h', 'shield') AND active = TRUE",
        [targetUserId, groupId]
      );
      if (shield.length > 0) {
        await pool.query('UPDATE protections SET active = FALSE WHERE id = ?', [shield[0].id]);
        return res.json({ message: 'El objetivo tenia un escudo activo. Ataque bloqueado.', blocked: true });
      }
    }

    // Aplicar efecto
    switch (effect.action) {
      case 'assign_extra_challenge':
        if (targetUserId && weekId) {
          const [randomChallenge] = await pool.query('SELECT id FROM challenges ORDER BY RAND() LIMIT 1');
          if (randomChallenge.length > 0) {
            const dcId = uuidv4();
            await pool.query(
              'INSERT INTO daily_challenges (id, week_id, user_id, challenge_id, group_id, assigned_date) VALUES (?, ?, ?, ?, ?, ?)',
              [dcId, weekId, targetUserId, randomChallenge[0].id, groupId, today]
            );
          }
        }
        break;

      case 'increase_difficulty':
        if (targetUserId && weekId) {
          const [pending] = await pool.query(
            "SELECT dc.id FROM daily_challenges dc WHERE dc.user_id = ? AND dc.week_id = ? AND dc.status = 'pending' ORDER BY RAND() LIMIT 1",
            [targetUserId, weekId]
          );
          if (pending.length > 0) {
            const [harder] = await pool.query("SELECT id FROM challenges WHERE difficulty IN ('dificil', 'extremo') ORDER BY RAND() LIMIT 1");
            if (harder.length > 0) {
              await pool.query('UPDATE daily_challenges SET challenge_id = ? WHERE id = ?', [harder[0].id, pending[0].id]);
            }
          }
        }
        break;

      case 'steal_points':
        if (targetUserId) {
          const amount = effect.amount || 3;
          await pool.query('UPDATE points_wallet SET balance = GREATEST(balance - ?, 0) WHERE user_id = ? AND group_id = ?', [amount, targetUserId, groupId]);
          await pool.query('UPDATE points_wallet SET balance = balance + ? WHERE user_id = ? AND group_id = ?', [amount, userId, groupId]);
        }
        break;

      case 'kamikaze':
        if (targetUserId) {
          await pool.query('UPDATE points_wallet SET balance = 0 WHERE user_id = ? AND group_id = ?', [userId, groupId]);
          await pool.query('UPDATE points_wallet SET balance = 0 WHERE user_id = ? AND group_id = ?', [targetUserId, groupId]);
        }
        break;

      case 'freeze_24h':
        if (targetUserId && weekId) {
          const protId = uuidv4();
          await pool.query(
            'INSERT INTO protections (id, user_id, group_id, week_id, type, active) VALUES (?, ?, ?, ?, ?, TRUE)',
            [protId, targetUserId, groupId, weekId, 'frozen']
          );
        }
        break;

      case 'sabotage':
        if (targetUserId && weekId) {
          const protId = uuidv4();
          await pool.query(
            'INSERT INTO protections (id, user_id, group_id, week_id, type, active) VALUES (?, ?, ?, ?, ?, TRUE)',
            [protId, targetUserId, groupId, weekId, 'sabotaged']
          );
        }
        break;

      case 'shield_48h':
        if (weekId) {
          const protId = uuidv4();
          await pool.query(
            'INSERT INTO protections (id, user_id, group_id, week_id, type, active) VALUES (?, ?, ?, ?, ?, TRUE)',
            [protId, userId, groupId, weekId, 'shield_48h']
          );
        }
        break;

      case 'immunity':
        if (weekId) {
          const protId = uuidv4();
          await pool.query(
            'INSERT INTO protections (id, user_id, group_id, week_id, type, active) VALUES (?, ?, ?, ?, ?, TRUE)',
            [protId, userId, groupId, weekId, 'immunity']
          );
        }
        break;

      case 'mirror':
        if (weekId) {
          const protId = uuidv4();
          await pool.query(
            'INSERT INTO protections (id, user_id, group_id, week_id, type, active) VALUES (?, ?, ?, ?, ?, TRUE)',
            [protId, userId, groupId, weekId, 'mirror']
          );
        }
        break;

      case 'double_points_next':
        if (weekId) {
          const protId = uuidv4();
          await pool.query(
            'INSERT INTO protections (id, user_id, group_id, week_id, type, active) VALUES (?, ?, ?, ?, ?, TRUE)',
            [protId, userId, groupId, weekId, 'double_points']
          );
        }
        break;
    }

    // Marcar como usado en inventario
    await pool.query(
      'UPDATE perk_inventory SET used = TRUE, used_at = NOW(), target_user_id = ? WHERE id = ?',
      [targetUserId || null, inventoryId]
    );

    // Registrar uso
    const usageId = uuidv4();
    await pool.query(
      'INSERT INTO perk_usage (id, perk_id, user_id, target_user_id, group_id, week_id) VALUES (?, ?, ?, ?, ?, ?)',
      [usageId, perkId, userId, targetUserId || null, groupId, weekId]
    );

    res.json({ message: `${perk.name} usado exitosamente!`, perk });
  } catch (error) {
    console.error('Error usando perk de ruleta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/spin/:groupId/inventory - Mi inventario de perks
router.get('/:groupId/inventory', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const [inventory] = await pool.query(
      `SELECT pi.id as inventory_id, pi.obtained_at, pi.used, pi.used_at, pi.target_user_id,
              p.id as perk_id, p.name, p.description, p.rarity, p.type,
              tu.username as target_username
       FROM perk_inventory pi
       JOIN perks p ON pi.perk_id = p.id
       LEFT JOIN users tu ON pi.target_user_id = tu.id
       WHERE pi.user_id = ? AND pi.group_id = ?
       ORDER BY pi.used ASC, pi.obtained_at DESC`,
      [userId, groupId]
    );

    const available = inventory.filter(i => !i.used);
    const used = inventory.filter(i => i.used);

    res.json({ available, used, total: inventory.length });
  } catch (error) {
    console.error('Error obteniendo inventario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/spin/:groupId/today - Ver si ya tire hoy
router.get('/:groupId/today', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    const [spin] = await pool.query(
      'SELECT ds.*, p.name, p.description, p.rarity, p.type as perk_type FROM daily_spins ds JOIN perks p ON ds.perk_id = p.id WHERE ds.user_id = ? AND ds.group_id = ? AND ds.spin_date = ?',
      [userId, groupId, today]
    );

    res.json({ spun: spin.length > 0, result: spin[0] || null });
  } catch (error) {
    console.error('Error consultando spin:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
