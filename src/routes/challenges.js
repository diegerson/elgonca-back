const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const pool = require('../db/connection');
const authMiddleware = require('../middleware/auth');
const { validateChallengePhoto } = require('../services/aiValidation');
const { uploadFile } = require('../services/storage');

const router = express.Router();

// Configurar multer para fotos y videos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (para videos cortos)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes o videos'));
    }
  },
});

// GET /api/challenges/disputed-count/:groupId - Cantidad de retos en disputa pendientes de MI voto
router.get('/disputed-count/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Contar retos disputados donde YO no soy el dueño Y todavía no voté
    const [result] = await pool.query(
      `SELECT COUNT(*) as count FROM daily_challenges dc
       WHERE dc.group_id = ? AND dc.status = 'disputed' AND dc.user_id != ?
       AND dc.id NOT IN (SELECT daily_challenge_id FROM votes WHERE voter_user_id = ?)`,
      [groupId, userId, userId]
    );

    res.json({ count: result[0].count });
  } catch (error) {
    console.error('Error contando disputas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/challenges/disputed/:groupId - Retos en disputa del grupo (para votar)
router.get('/disputed/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const [challenges] = await pool.query(
      `SELECT dc.*, c.title, c.description, c.difficulty, c.points, c.category, u.username as challenger_username
       FROM daily_challenges dc
       JOIN challenges c ON dc.challenge_id = c.id
       JOIN users u ON dc.user_id = u.id
       WHERE dc.group_id = ? AND dc.status = 'disputed' AND dc.user_id != ?
       AND dc.id NOT IN (SELECT daily_challenge_id FROM votes WHERE voter_user_id = ?)`,
      [groupId, userId, userId]
    );

    // Construir URL completa para fotos/videos locales
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = challenges.map(ch => ({
      ...ch,
      photo_url: ch.photo_url
        ? (ch.photo_url.startsWith('http') ? ch.photo_url : `${baseUrl}${ch.photo_url}`)
        : null,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error obteniendo retos disputados:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/challenges/daily/:groupId - Retos del día para el usuario
router.get('/daily/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    const [challenges] = await pool.query(
      `SELECT dc.*, c.title, c.description, c.difficulty, c.points, c.category, c.media_type
       FROM daily_challenges dc
       JOIN challenges c ON dc.challenge_id = c.id
       WHERE dc.user_id = ? AND dc.group_id = ? AND dc.assigned_date = ?`,
      [userId, groupId, today]
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = challenges.map(ch => ({
      ...ch,
      photo_url: ch.photo_url
        ? (ch.photo_url.startsWith('http') ? ch.photo_url : `${baseUrl}${ch.photo_url}`)
        : null,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error obteniendo retos diarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/challenges/:id/complete - Completar reto con foto o video
router.post('/:id/complete', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'El archivo es obligatorio' });
    }

    // Verificar que el reto pertenece al usuario
    const [dailyChallenges] = await pool.query(
      `SELECT dc.*, c.title, c.description, c.points, c.media_type
       FROM daily_challenges dc
       JOIN challenges c ON dc.challenge_id = c.id
       WHERE dc.id = ? AND dc.user_id = ?`,
      [id, userId]
    );

    if (dailyChallenges.length === 0) {
      return res.status(404).json({ error: 'Reto no encontrado' });
    }

    const dailyChallenge = dailyChallenges[0];

    if (dailyChallenge.status !== 'pending') {
      return res.status(400).json({ error: 'Este reto ya fue procesado' });
    }

    const isVideo = req.file.mimetype.startsWith('video/');

    // Subir archivo a S3 (o mantener local en dev)
    const photoUrl = await uploadFile(req.file.path, req.file.originalname, req.file.mimetype);
    let newStatus;
    let validationResult = null;

    if (isVideo) {
      // Videos van DIRECTO a votación grupal (no pasan por IA)
      newStatus = 'disputed';
      validationResult = { valid: false, confidence: 0, reason: 'Video: requiere votación grupal', needsVoting: true };

      await pool.query(
        'UPDATE daily_challenges SET status = ?, photo_url = ?, photo_taken_at = NOW(), ai_validation_result = ? WHERE id = ?',
        [newStatus, photoUrl, JSON.stringify(validationResult), id]
      );
    } else {
      // Fotos se validan con IA
      validationResult = await validateChallengePhoto(
        req.file.path,
        dailyChallenge.title,
        dailyChallenge.description
      );

      if (validationResult.valid) {
        newStatus = 'completed';
        const points = dailyChallenge.points;

        const [penalty] = await pool.query(
          "SELECT id FROM protections WHERE user_id = ? AND group_id = ? AND week_id = ? AND type = 'penalty_no_points' AND active = TRUE",
          [userId, dailyChallenge.group_id, dailyChallenge.week_id]
        );

        if (penalty.length === 0) {
          await pool.query(
            `UPDATE points_wallet SET balance = balance + ?, total_earned = total_earned + ?
             WHERE user_id = ? AND group_id = ?`,
            [points, points, userId, dailyChallenge.group_id]
          );

          await pool.query(
            `INSERT INTO weekly_points (id, user_id, group_id, week_id, points_earned)
             VALUES (UUID(), ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE points_earned = points_earned + ?`,
            [userId, dailyChallenge.group_id, dailyChallenge.week_id, points, points]
          );
        }

        await pool.query(
          'UPDATE daily_challenges SET status = ?, photo_url = ?, photo_taken_at = NOW(), ai_validation_result = ?, completed_at = NOW(), points_earned = ? WHERE id = ?',
          [newStatus, photoUrl, JSON.stringify(validationResult), points, id]
        );
      } else if (validationResult.needsVoting) {
        newStatus = 'disputed';
        await pool.query(
          'UPDATE daily_challenges SET status = ?, photo_url = ?, photo_taken_at = NOW(), ai_validation_result = ? WHERE id = ?',
          [newStatus, photoUrl, JSON.stringify(validationResult), id]
        );
      } else {
        newStatus = 'failed';
        await pool.query(
          'UPDATE daily_challenges SET status = ?, photo_url = ?, photo_taken_at = NOW(), ai_validation_result = ? WHERE id = ?',
          [newStatus, photoUrl, JSON.stringify(validationResult), id]
        );
      }
    }

    res.json({
      status: newStatus,
      validation: validationResult,
      message: newStatus === 'completed'
        ? '¡Reto completado! Puntos sumados.'
        : newStatus === 'disputed'
          ? 'La validación no fue concluyente. Pasa a votación grupal.'
          : 'El reto no fue validado. Intentá de nuevo mañana.',
    });
  } catch (error) {
    console.error('Error completando reto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/challenges/:id/vote - Votar un reto disputado
router.post('/:id/vote', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { vote } = req.body; // 'approve' o 'reject'
    const userId = req.user.id;

    if (!['approve', 'reject'].includes(vote)) {
      return res.status(400).json({ error: 'Voto inválido' });
    }

    // Verificar que el reto está en disputa
    const [challenges] = await pool.query(
      'SELECT * FROM daily_challenges WHERE id = ? AND status = ?',
      [id, 'disputed']
    );

    if (challenges.length === 0) {
      return res.status(404).json({ error: 'Reto no encontrado o no está en disputa' });
    }

    const challenge = challenges[0];

    // No puede votar su propio reto
    if (challenge.user_id === userId) {
      return res.status(403).json({ error: 'No podés votar tu propio reto' });
    }

    // Registrar voto
    const voteId = uuidv4();
    await pool.query(
      'INSERT INTO votes (id, daily_challenge_id, voter_user_id, vote) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE vote = ?',
      [voteId, id, userId, vote, vote]
    );

    // Contar votos y verificar si se alcanzó mayoría
    const [members] = await pool.query(
      'SELECT COUNT(*) as total FROM group_members WHERE group_id = ?',
      [challenge.group_id]
    );
    const totalMembers = members[0].total - 1; // Excluir al retado

    const [votes] = await pool.query(
      'SELECT vote, COUNT(*) as count FROM votes WHERE daily_challenge_id = ? GROUP BY vote',
      [id]
    );

    const totalVotes = votes.reduce((sum, v) => sum + v.count, 0);
    const majority = Math.ceil(totalMembers / 2);

    const approveVotes = votes.find(v => v.vote === 'approve')?.count || 0;
    const rejectVotes = votes.find(v => v.vote === 'reject')?.count || 0;

    let result = null;

    if (approveVotes >= majority) {
      // Aprobado por votación
      const [challengeData] = await pool.query(
        'SELECT c.points FROM daily_challenges dc JOIN challenges c ON dc.challenge_id = c.id WHERE dc.id = ?',
        [id]
      );
      const points = challengeData[0].points;

      await pool.query('UPDATE daily_challenges SET status = ?, points_earned = ?, completed_at = NOW() WHERE id = ?', ['voted_approved', points, id]);
      await pool.query('UPDATE points_wallet SET balance = balance + ?, total_earned = total_earned + ? WHERE user_id = ? AND group_id = ?', [points, points, challenge.user_id, challenge.group_id]);
      await pool.query('INSERT INTO weekly_points (id, user_id, group_id, week_id, points_earned) VALUES (UUID(), ?, ?, ?, ?) ON DUPLICATE KEY UPDATE points_earned = points_earned + ?', [challenge.user_id, challenge.group_id, challenge.week_id, points, points]);

      result = 'approved';
    } else if (rejectVotes >= majority) {
      await pool.query('UPDATE daily_challenges SET status = ? WHERE id = ?', ['voted_rejected', id]);
      result = 'rejected';
    }

    res.json({
      message: 'Voto registrado',
      totalVotes,
      needed: majority,
      result,
    });
  } catch (error) {
    console.error('Error votando:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
