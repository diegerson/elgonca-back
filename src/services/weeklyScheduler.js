const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/connection');
const { notifyGroup, notifyUser } = require('./notifications');

/**
 * SÁBADO 00:05 - Cierre de semana
 * Cierra la semana (lun-vie), determina el gonca y le asigna reto difícil.
 * El gonca tiene sábado y domingo para completarlo.
 */
async function closeWeek() {
  try {
    console.log('🏁 Cerrando semana...');

    const [groups] = await pool.query('SELECT id FROM groups_table');

    for (const group of groups) {
      // Buscar semana activa del grupo
      const [activeWeeks] = await pool.query(
        "SELECT * FROM weeks WHERE group_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
        [group.id]
      );

      if (activeWeeks.length === 0) continue;

      const week = activeWeeks[0];

      // Determinar el gonca (el que menos puntos GANADOS tiene)
      const [rankings] = await pool.query(
        `SELECT user_id, COALESCE(points_earned, 0) as pts
         FROM weekly_points
         WHERE group_id = ? AND week_id = ?
         ORDER BY pts ASC`,
        [group.id, week.id]
      );

      let goncaUserId = null;
      let goncaChallengeId = null;

      if (rankings.length > 0) {
        goncaUserId = rankings[0].user_id;

        // Verificar inmunidad
        const [immunity] = await pool.query(
          "SELECT id FROM protections WHERE user_id = ? AND group_id = ? AND week_id = ? AND type = 'immunity' AND active = TRUE",
          [goncaUserId, group.id, week.id]
        );

        if (immunity.length > 0) {
          // Consumir inmunidad
          await pool.query('UPDATE protections SET active = FALSE WHERE id = ?', [immunity[0].id]);
          // Pasa al siguiente con menos puntos
          goncaUserId = rankings.length > 1 ? rankings[1].user_id : null;
        }

        // Asignar reto difícil al gonca
        if (goncaUserId) {
          const [hardChallenge] = await pool.query(
            "SELECT id FROM challenges WHERE difficulty IN ('dificil', 'extremo') ORDER BY RAND() LIMIT 1"
          );
          if (hardChallenge.length > 0) {
            goncaChallengeId = hardChallenge[0].id;

            // Crear el daily_challenge del gonca para el finde
            const dcId = uuidv4();
            const today = new Date().toISOString().split('T')[0];
            await pool.query(
              'INSERT INTO daily_challenges (id, week_id, user_id, challenge_id, group_id, assigned_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [dcId, week.id, goncaUserId, goncaChallengeId, group.id, today, 'pending']
            );
          }
        }
      }

      // Cambiar estado de la semana a "gonca_weekend" (el gonca tiene el finde)
      await pool.query(
        "UPDATE weeks SET status = 'gonca_weekend', gonca_user_id = ?, gonca_challenge_id = ? WHERE id = ?",
        [goncaUserId, goncaChallengeId, week.id]
      );

      if (goncaUserId) {
        const [goncaUser] = await pool.query('SELECT username FROM users WHERE id = ?', [goncaUserId]);
        console.log(`🫣 Gonca del grupo ${group.id}: ${goncaUser[0]?.username}`);

        // Notificar al grupo quién es el gonca
        await notifyGroup(
          group.id,
          `🫣 ${goncaUser[0]?.username} es el GONCA de la semana!`,
          'El más cagón tiene un reto especial para el finde. ¿Lo va a cumplir?',
          { type: 'gonca_declared', groupId: group.id }
        );

        // Notificar al gonca directamente
        await notifyUser(
          goncaUserId,
          '🫣 Sos el GONCA de la semana!',
          'Te tocó un reto especial. Tenés sábado y domingo para cumplirlo, cagón.',
          { type: 'you_are_gonca', groupId: group.id }
        );
      }
    }

    console.log('✅ Semana cerrada. Los goncas tienen el finde para cumplir.');
  } catch (error) {
    console.error('❌ Error cerrando semana:', error);
  }
}

/**
 * DOMINGO 23:59 - Verificación del gonca
 * Si no completó su reto, no sumará puntos en toda la semana siguiente.
 */
async function checkGoncaChallenge() {
  try {
    console.log('🔍 Verificando retos de goncas...');

    const [weekendWeeks] = await pool.query(
      "SELECT * FROM weeks WHERE status = 'gonca_weekend' AND gonca_user_id IS NOT NULL"
    );

    for (const week of weekendWeeks) {
      // Verificar si el gonca completó su reto
      const [completed] = await pool.query(
        "SELECT id FROM daily_challenges WHERE user_id = ? AND challenge_id = ? AND week_id = ? AND status IN ('completed', 'voted_approved')",
        [week.gonca_user_id, week.gonca_challenge_id, week.id]
      );

      if (completed.length > 0) {
        // Completó el reto
        await pool.query(
          "UPDATE weeks SET gonca_completed = TRUE, status = 'finished' WHERE id = ?",
          [week.id]
        );
        console.log(`✅ Gonca ${week.gonca_user_id} completó su reto.`);
      } else {
        // NO completó - marcar penalización para la próxima semana
        await pool.query(
          "UPDATE weeks SET gonca_completed = FALSE, status = 'finished' WHERE id = ?",
          [week.id]
        );
        console.log(`⚠️ Gonca ${week.gonca_user_id} NO completó su reto. Penalizado la próxima semana.`);
      }
    }
  } catch (error) {
    console.error('❌ Error verificando retos de goncas:', error);
  }
}

/**
 * LUNES 00:05 - Inicio de nueva semana
 * Crea la nueva semana y asigna los primeros retos del lunes.
 */
async function startNewWeek() {
  try {
    console.log('🗓️ Iniciando nueva semana...');

    const [groups] = await pool.query('SELECT id FROM groups_table');

    for (const group of groups) {
      // Crear nueva semana (lunes a viernes)
      const now = new Date();
      const startDate = now.toISOString().split('T')[0]; // Lunes
      const friday = new Date(now.getTime() + 4 * 86400000);
      const endDate = friday.toISOString().split('T')[0]; // Viernes

      const weekId = uuidv4();
      const weekNumber = getWeekNumber(now);

      await pool.query(
        'INSERT INTO weeks (id, group_id, week_number, year, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [weekId, group.id, weekNumber, now.getFullYear(), startDate, endDate, 'active']
      );

      // Crear registros de weekly_points para todos los miembros
      const [members] = await pool.query(
        'SELECT user_id FROM group_members WHERE group_id = ?',
        [group.id]
      );

      for (const member of members) {
        const wpId = uuidv4();
        await pool.query(
          'INSERT INTO weekly_points (id, user_id, group_id, week_id, points_earned) VALUES (?, ?, ?, ?, 0)',
          [wpId, member.user_id, group.id, weekId]
        );
      }

      // Verificar si algún gonca de la semana anterior no cumplió (penalización)
      const [prevWeek] = await pool.query(
        "SELECT * FROM weeks WHERE group_id = ? AND status = 'finished' AND gonca_completed = FALSE AND gonca_user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        [group.id]
      );

      if (prevWeek.length > 0) {
        // Marcar al gonca penalizado: sus puntos esta semana no cuentan
        // Lo hacemos seteando un flag en weekly_points (points_earned = -1 como marker)
        // Mejor: creamos una protección negativa
        const penaltyId = uuidv4();
        await pool.query(
          'INSERT INTO protections (id, user_id, group_id, week_id, type, active) VALUES (?, ?, ?, ?, ?, TRUE)',
          [penaltyId, prevWeek[0].gonca_user_id, group.id, weekId, 'penalty_no_points']
        );
        console.log(`🚫 ${prevWeek[0].gonca_user_id} penalizado: no suma puntos esta semana.`);
      }
    }

    // Asignar retos del lunes
    await assignDailyChallenges();

    console.log('✅ Nueva semana iniciada.');
  } catch (error) {
    console.error('❌ Error iniciando nueva semana:', error);
  }
}

/**
 * LUNES a VIERNES 00:05 - Asignación de retos diarios
 * Asigna un reto random a cada miembro de cada grupo con semana activa.
 */
async function assignDailyChallenges() {
  try {
    console.log('⏰ Asignando retos diarios...');
    const today = new Date().toISOString().split('T')[0];
    const dayOfWeek = new Date().getDay(); // 0=domingo, 6=sábado

    // Solo asignar de lunes a viernes (1-5)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log('🛌 Fin de semana, no se asignan retos regulares.');
      return;
    }

    // Obtener todas las semanas activas
    const [activeWeeks] = await pool.query("SELECT * FROM weeks WHERE status = 'active'");

    for (const week of activeWeeks) {
      const [members] = await pool.query(
        'SELECT user_id FROM group_members WHERE group_id = ?',
        [week.group_id]
      );

      for (const member of members) {
        // Verificar si ya tiene reto hoy
        const [existing] = await pool.query(
          'SELECT id FROM daily_challenges WHERE user_id = ? AND group_id = ? AND assigned_date = ?',
          [member.user_id, week.group_id, today]
        );

        if (existing.length > 0) continue;

        // Verificar penalización (gonca que no cumplió)
        const [penalty] = await pool.query(
          "SELECT id FROM protections WHERE user_id = ? AND group_id = ? AND week_id = ? AND type = 'penalty_no_points' AND active = TRUE",
          [member.user_id, week.group_id, week.id]
        );

        // Asignar reto random (evitar repetidos de la semana)
        const [usedChallenges] = await pool.query(
          'SELECT challenge_id FROM daily_challenges WHERE user_id = ? AND week_id = ?',
          [member.user_id, week.id]
        );
        const usedIds = usedChallenges.map(c => c.challenge_id);

        let query = 'SELECT id FROM challenges ORDER BY RAND() LIMIT 1';
        let params = [];

        if (usedIds.length > 0) {
          query = `SELECT id FROM challenges WHERE id NOT IN (${usedIds.map(() => '?').join(',')}) ORDER BY RAND() LIMIT 1`;
          params = usedIds;
        }

        const [randomChallenge] = await pool.query(query, params);

        if (randomChallenge.length > 0) {
          const dcId = uuidv4();
          await pool.query(
            'INSERT INTO daily_challenges (id, week_id, user_id, challenge_id, group_id, assigned_date) VALUES (?, ?, ?, ?, ?, ?)',
            [dcId, week.id, member.user_id, randomChallenge[0].id, week.group_id, today]
          );

          // Si tiene penalización, el reto se asigna igual pero no sumará puntos
          // (se controla en el endpoint de complete)
        }
      }
    }

    console.log('✅ Retos diarios asignados.');

    // Enviar push notifications a todos los grupos con semana activa
    for (const week of activeWeeks) {
      await notifyGroup(
        week.group_id,
        '🫣 Dale cagón, tenés un nuevo reto diario!',
        'Entrá a ver qué te tocó hoy. ¿Te animás o sos gonca?',
        { type: 'daily_challenge', groupId: week.group_id }
      );
    }
  } catch (error) {
    console.error('❌ Error asignando retos diarios:', error);
  }
}

/**
 * TODOS LOS DÍAS 00:00 - Expiración de retos
 * Marca como "failed" los retos de ayer que quedaron pendientes.
 */
async function failExpiredChallenges() {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const [result] = await pool.query(
      "UPDATE daily_challenges SET status = 'failed' WHERE assigned_date = ? AND status = 'pending'",
      [yesterday]
    );

    console.log(`⏰ ${result.affectedRows} retos expirados marcados como fallidos.`);

    // Otorgar leader_points al ganador diario de cada grupo
    await awardDailyLeaderPoints(yesterday);
  } catch (error) {
    console.error('❌ Error marcando retos expirados:', error);
  }
}

/**
 * Otorga leader_points al usuario que mas puntos gano ayer en cada grupo.
 * 1er lugar: 3 leader points, 2do: 2, 3ro: 1
 */
async function awardDailyLeaderPoints(date) {
  try {
    const [activeWeeks] = await pool.query("SELECT * FROM weeks WHERE status = 'active'");

    for (const week of activeWeeks) {
      // Obtener ranking del dia
      const [ranking] = await pool.query(
        `SELECT user_id, SUM(points_earned) as day_points
         FROM daily_challenges
         WHERE group_id = ? AND assigned_date = ? AND status IN ('completed', 'voted_approved')
         GROUP BY user_id
         HAVING day_points > 0
         ORDER BY day_points DESC
         LIMIT 3`,
        [week.group_id, date]
      );

      const prizes = [3, 2, 1]; // 1ro, 2do, 3ro

      for (let i = 0; i < ranking.length; i++) {
        const points = prizes[i] || 0;
        if (points === 0) break;

        await pool.query(
          `INSERT INTO leader_points (id, user_id, group_id, balance, total_earned)
           VALUES (UUID(), ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE balance = balance + ?, total_earned = total_earned + ?`,
          [ranking[i].user_id, week.group_id, points, points, points, points]
        );
      }

      if (ranking.length > 0) {
        console.log(`🏅 Leader points otorgados en grupo ${week.group_id}: ${ranking.map((r, i) => `${i+1}. ${r.user_id} (+${prizes[i]})`).join(', ')}`);
      }
    }
  } catch (error) {
    console.error('❌ Error otorgando leader points:', error);
  }
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function initScheduler() {
  // Todos los días 00:00 - marcar retos expirados
  cron.schedule('0 0 * * *', failExpiredChallenges);

  // Martes a Viernes 00:05 - asignar retos diarios (lunes se asigna en startNewWeek)
  cron.schedule('5 0 * * 2-5', assignDailyChallenges);

  // Sábado 00:05 - cerrar semana y determinar gonca
  cron.schedule('5 0 * * 6', closeWeek);

  // Domingo 23:59 - verificar si el gonca cumplió
  cron.schedule('59 23 * * 0', checkGoncaChallenge);

  // Lunes 00:05 - iniciar nueva semana + asignar retos del lunes
  cron.schedule('5 0 * * 1', startNewWeek);

  console.log('📅 Scheduler inicializado');
  console.log('   - 00:00 diario: expirar retos pendientes');
  console.log('   - 00:05 mar-vie: asignar retos diarios');
  console.log('   - 00:05 sábado: cerrar semana, declarar gonca');
  console.log('   - 23:59 domingo: verificar reto del gonca');
  console.log('   - 00:05 lunes: nueva semana + retos del lunes');
}

module.exports = { initScheduler, assignDailyChallenges, startNewWeek, closeWeek, checkGoncaChallenge };
