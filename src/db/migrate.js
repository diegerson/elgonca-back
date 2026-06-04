const mysql = require('mysql2/promise');
require('dotenv').config();

const migration = `
-- Usuarios
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Grupos
CREATE TABLE IF NOT EXISTS groups_table (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(8) UNIQUE NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Miembros del grupo
CREATE TABLE IF NOT EXISTS group_members (
  id VARCHAR(36) PRIMARY KEY,
  group_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY unique_member (group_id, user_id)
);

-- Catálogo de retos
CREATE TABLE IF NOT EXISTS challenges (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  difficulty ENUM('facil', 'medio', 'dificil', 'extremo') DEFAULT 'medio',
  points INT NOT NULL DEFAULT 5,
  category VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Semanas (ciclo lunes a viernes + finde para el gonca)
CREATE TABLE IF NOT EXISTS weeks (
  id VARCHAR(36) PRIMARY KEY,
  group_id VARCHAR(36) NOT NULL,
  week_number INT NOT NULL,
  year INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  gonca_user_id VARCHAR(36),
  gonca_challenge_id VARCHAR(36),
  gonca_completed BOOLEAN DEFAULT FALSE,
  status ENUM('active', 'gonca_weekend', 'finished') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  FOREIGN KEY (gonca_user_id) REFERENCES users(id),
  FOREIGN KEY (gonca_challenge_id) REFERENCES challenges(id)
);

-- Retos asignados diarios a cada usuario
CREATE TABLE IF NOT EXISTS daily_challenges (
  id VARCHAR(36) PRIMARY KEY,
  week_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  challenge_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  assigned_date DATE NOT NULL,
  status ENUM('pending', 'completed', 'failed', 'disputed', 'voted_approved', 'voted_rejected') DEFAULT 'pending',
  photo_url VARCHAR(500),
  photo_taken_at TIMESTAMP,
  ai_validation_result JSON,
  completed_at TIMESTAMP,
  points_earned INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (week_id) REFERENCES weeks(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id),
  FOREIGN KEY (group_id) REFERENCES groups_table(id)
);

-- Votaciones grupales (cuando la IA no puede validar)
CREATE TABLE IF NOT EXISTS votes (
  id VARCHAR(36) PRIMARY KEY,
  daily_challenge_id VARCHAR(36) NOT NULL,
  voter_user_id VARCHAR(36) NOT NULL,
  vote ENUM('approve', 'reject') NOT NULL,
  voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (daily_challenge_id) REFERENCES daily_challenges(id),
  FOREIGN KEY (voter_user_id) REFERENCES users(id),
  UNIQUE KEY unique_vote (daily_challenge_id, voter_user_id)
);

-- Puntos acumulados (wallet de puntos gastables)
CREATE TABLE IF NOT EXISTS points_wallet (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  balance INT DEFAULT 0,
  total_earned INT DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  UNIQUE KEY unique_wallet (user_id, group_id)
);

-- Puntos ganados por semana (para la tabla semanal)
CREATE TABLE IF NOT EXISTS weekly_points (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  week_id VARCHAR(36) NOT NULL,
  points_earned INT DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  FOREIGN KEY (week_id) REFERENCES weeks(id),
  UNIQUE KEY unique_weekly (user_id, group_id, week_id)
);

-- Catálogo de perks
CREATE TABLE IF NOT EXISTS perks (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  cost INT NOT NULL,
  type ENUM('attack', 'defense', 'modifier') NOT NULL,
  effect JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Perks usados
CREATE TABLE IF NOT EXISTS perk_usage (
  id VARCHAR(36) PRIMARY KEY,
  perk_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  target_user_id VARCHAR(36),
  group_id VARCHAR(36) NOT NULL,
  week_id VARCHAR(36) NOT NULL,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (perk_id) REFERENCES perks(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (target_user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  FOREIGN KEY (week_id) REFERENCES weeks(id)
);

-- Protecciones activas
CREATE TABLE IF NOT EXISTS protections (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  week_id VARCHAR(36) NOT NULL,
  type VARCHAR(50) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  FOREIGN KEY (week_id) REFERENCES weeks(id)
);

-- Seed de retos iniciales
INSERT IGNORE INTO challenges (id, title, description, difficulty, points, category) VALUES
('c1', 'Pedir la cuenta en voz alta', 'En un restaurante, pedí la cuenta levantando la mano y diciendo en voz alta "¡Mozo, la cuenta!"', 'facil', 5, 'social'),
('c2', 'Gritar PARADA en el colectivo', 'Cuando el colectivero no frena, gritá "¡PARADA!" bien fuerte', 'facil', 5, 'transporte'),
('c3', 'Preguntar el precio', 'En un local donde no hay precios, preguntá cuánto sale algo', 'facil', 5, 'social'),
('c4', 'Hablarle a un desconocido', 'Iniciá una conversación random con alguien que no conocés', 'medio', 8, 'social'),
('c5', 'Pedir descuento', 'En cualquier comercio, pedí un descuento con cara seria', 'medio', 8, 'social'),
('c6', 'Cantar en público', 'Cantá al menos 10 segundos de una canción en un lugar público', 'dificil', 12, 'performance'),
('c7', 'Devolver comida en un restaurante', 'Si algo no te gustó, devolvelo educadamente', 'medio', 8, 'social'),
('c8', 'Pedir wifi y contraseña', 'En un bar o local, pedí la contraseña del wifi sin consumir', 'facil', 5, 'social'),
('c9', 'Bailar en la calle', 'Bailá al menos 15 segundos en la vía pública', 'dificil', 12, 'performance'),
('c10', 'Reclamar un vuelto', 'Si te dieron mal el vuelto (o simulá), reclamalo', 'medio', 8, 'social'),
('c11', 'Pedir probar algo antes de comprar', 'En una heladería o local de comida, pedí probar antes de elegir', 'facil', 5, 'social'),
('c12', 'Decir que no', 'Cuando alguien te ofrezca algo, decí que no firmemente', 'facil', 5, 'social'),
('c13', 'Hacer un reclamo', 'Reclamá algo (un servicio, un producto) de forma directa', 'medio', 8, 'social'),
('c14', 'Saludar al chofer del colectivo', 'Al subir o bajar, saludá al chofer en voz alta', 'facil', 5, 'transporte'),
('c15', 'Pedir indicaciones a 3 personas', 'Preguntá cómo llegar a algún lugar a 3 personas distintas', 'medio', 8, 'social');

-- Seed de perks iniciales
INSERT IGNORE INTO perks (id, name, description, cost, type, effect) VALUES
('p1', 'Reto Extra', 'Le asignás un reto extra aleatorio a otro integrante del grupo', 10, 'attack', '{"action": "assign_extra_challenge"}'),
('p2', 'Subir Dificultad', 'Le subís la dificultad a un reto random de otro jugador', 15, 'attack', '{"action": "increase_difficulty"}'),
('p3', 'Robar Puntos', 'Le robás 3 puntos a otro jugador (no afecta su tabla semanal)', 12, 'attack', '{"action": "steal_points", "amount": 3}'),
('p4', 'Escudo', 'Te protege de un perk de ataque durante esta semana', 8, 'defense', '{"action": "shield_one_attack"}'),
('p5', 'Inmunidad', 'No podés ser declarado gonca esta semana', 20, 'defense', '{"action": "immunity"}'),
('p6', 'Doble Puntos', 'Tu próximo reto completado vale el doble', 10, 'modifier', '{"action": "double_points_next"}');
`;

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'gonca_user',
    password: process.env.DB_PASSWORD || 'gonca_pass_2024',
    database: process.env.DB_NAME || 'gonca_db',
    multipleStatements: true,
  });

  try {
    console.log('🚀 Ejecutando migración...');
    await connection.query(migration);
    console.log('✅ Migración completada exitosamente');
  } catch (error) {
    console.error('❌ Error en migración:', error.message);
  } finally {
    await connection.end();
  }
}

runMigration();
