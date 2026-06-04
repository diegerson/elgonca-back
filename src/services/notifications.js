const pool = require('../db/connection');

/**
 * Envía push notifications usando Expo Push API.
 * No necesita Firebase ni APNs — Expo lo maneja.
 */
async function sendPushNotification(pushToken, title, body, data = {}) {
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        title,
        body,
        data,
      }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error enviando push:', error.message);
    return null;
  }
}

/**
 * Envía notificación a todos los miembros de un grupo.
 */
async function notifyGroup(groupId, title, body, data = {}) {
  try {
    const [members] = await pool.query(
      `SELECT u.push_token FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ? AND u.push_token IS NOT NULL`,
      [groupId]
    );

    const notifications = members
      .filter(m => m.push_token)
      .map(m => ({
        to: m.push_token,
        sound: 'default',
        title,
        body,
        data,
      }));

    if (notifications.length === 0) return;

    // Expo permite enviar en batch (hasta 100)
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notifications),
    });

    const result = await response.json();
    console.log(`📬 Notificaciones enviadas a ${notifications.length} usuarios del grupo ${groupId}`);
    return result;
  } catch (error) {
    console.error('Error enviando notificaciones al grupo:', error.message);
  }
}

/**
 * Envía notificación a un usuario específico.
 */
async function notifyUser(userId, title, body, data = {}) {
  try {
    const [users] = await pool.query(
      'SELECT push_token FROM users WHERE id = ? AND push_token IS NOT NULL',
      [userId]
    );

    if (users.length === 0 || !users[0].push_token) return;

    return sendPushNotification(users[0].push_token, title, body, data);
  } catch (error) {
    console.error('Error enviando notificación al usuario:', error.message);
  }
}

module.exports = { sendPushNotification, notifyGroup, notifyUser };
