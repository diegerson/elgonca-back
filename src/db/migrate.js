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
  media_type ENUM('foto', 'video') DEFAULT 'foto',
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
  cost INT NOT NULL DEFAULT 0,
  probability DECIMAL(5,2) DEFAULT 0,
  rarity ENUM('comun', 'raro', 'epico', 'legendario') DEFAULT 'comun',
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
INSERT IGNORE INTO challenges (id, title, description, difficulty, points, category, media_type) VALUES
('c1', 'Pedir la cuenta en voz alta', 'En un restaurante, pedi la cuenta levantando la mano y diciendo en voz alta Mozo, la cuenta!', 'facil', 5, 'social', 'foto'),
('c2', 'Gritar PARADA en el colectivo', 'Cuando el colectivero no frena, grita PARADA bien fuerte', 'facil', 5, 'transporte', 'video'),
('c3', 'Preguntar el precio', 'En un local donde no hay precios, pregunta cuanto sale algo', 'facil', 5, 'social', 'foto'),
('c4', 'Hablarle a un desconocido', 'Inicia una conversacion random con alguien que no conoces', 'medio', 8, 'social', 'video'),
('c5', 'Pedir descuento', 'En cualquier comercio, pedi un descuento con cara seria', 'medio', 8, 'social', 'video'),
('c6', 'Cantar en publico', 'Canta al menos 10 segundos de una cancion en un lugar publico', 'dificil', 12, 'performance', 'video'),
('c7', 'Devolver comida en un restaurante', 'Si algo no te gusto, devolvelo educadamente', 'medio', 8, 'social', 'video'),
('c8', 'Pedir wifi y contrasenha', 'En un bar o local, pedi la contrasenha del wifi sin consumir', 'facil', 5, 'social', 'foto'),
('c9', 'Bailar en la calle', 'Baila al menos 15 segundos en la via publica', 'dificil', 12, 'performance', 'video'),
('c10', 'Reclamar un vuelto', 'Si te dieron mal el vuelto (o simula), reclamalo', 'medio', 8, 'social', 'video'),
('c11', 'Pedir probar algo antes de comprar', 'En una heladeria o local de comida, pedi probar antes de elegir', 'facil', 5, 'social', 'video'),
('c12', 'Decir que no', 'Cuando alguien te ofrezca algo, deci que no firmemente', 'facil', 5, 'social', 'video'),
('c13', 'Hacer un reclamo', 'Reclama algo (un servicio, un producto) de forma directa', 'medio', 8, 'social', 'video'),
('c14', 'Saludar al chofer del colectivo', 'Al subir o bajar, saluda al chofer en voz alta', 'facil', 5, 'transporte', 'video'),
('c15', 'Pedir indicaciones a 3 personas', 'Pregunta como llegar a algun lugar a 3 personas distintas', 'medio', 8, 'social', 'video'),
('c16', 'Sentarte en la mesa mas grande solo', 'En un restaurante o food court, sentate en una mesa para 6+ personas estando solo', 'facil', 5, 'social', 'foto'),
('c17', 'Pedir agua gratis', 'En un bar o restaurante, pedi solo un vaso de agua sin consumir nada mas', 'facil', 5, 'social', 'video'),
('c18', 'Usar el ascensor para un piso', 'Subi o baja un solo piso en ascensor con gente mirandote', 'facil', 5, 'cotidiano', 'video'),
('c19', 'Preguntar la hora a alguien con reloj', 'Preguntale la hora a alguien que claramente tiene reloj o celular en la mano', 'facil', 5, 'social', 'video'),
('c20', 'Pedir servilletas extra', 'En cualquier local de comida, pedi un monton de servilletas extra sin razon aparente', 'facil', 5, 'social', 'video'),
('c21', 'Foto con un desconocido', 'Pedile a un desconocido que se saque una foto con vos', 'facil', 5, 'social', 'foto'),
('c22', 'Dejar propina en monedas', 'Deja propina pero toda en monedas, contandolas una por una', 'facil', 5, 'social', 'foto'),
('c23', 'Sentarte en el piso en un lugar publico', 'Sentate en el piso de un shopping, estacion o lugar publico por al menos 30 segundos', 'facil', 5, 'cotidiano', 'foto'),
('c24', 'Regatear en un kiosco', 'Intenta regatear el precio de algo en un kiosco o almacen', 'medio', 8, 'social', 'video'),
('c25', 'Pedir probar un perfume', 'En una perfumeria, pedi probar 3 perfumes y andate sin comprar', 'medio', 8, 'social', 'video'),
('c26', 'Hablar en voz alta por telefono', 'Mantene una conversacion en voz alta (real o falsa) en un lugar publico por 30 segundos', 'medio', 8, 'performance', 'video'),
('c27', 'Pedir cambio sin comprar', 'Entra a un local y pedi cambio de un billete sin comprar nada', 'medio', 8, 'social', 'video'),
('c28', 'Preguntar si aceptan trueque', 'En cualquier comercio, pregunta si podes pagar con un trueque', 'medio', 8, 'social', 'video'),
('c29', 'Pedir el banio en un local sin consumir', 'Entra a un bar o restaurante y pedi usar el banio sin ser cliente', 'medio', 8, 'social', 'video'),
('c30', 'Saludar a todos en un ascensor', 'Al entrar a un ascensor con gente, saluda a cada persona individualmente', 'medio', 8, 'social', 'video'),
('c31', 'Devolver algo sin ticket', 'Intenta devolver algo en un local sin tener el ticket de compra', 'medio', 8, 'social', 'video'),
('c32', 'Pedir una degustacion', 'En una panaderia, fiambreria o similar, pedi probar antes de comprar', 'medio', 8, 'social', 'video'),
('c33', 'Aplaudir solo en publico', 'Aplaudi solo en un lugar publico como si hubieras visto algo increible', 'medio', 8, 'performance', 'video'),
('c34', 'Sentarte en la mesa de un desconocido', 'En un food court o plaza de comidas, pedi sentarte en la mesa de alguien que no conoces', 'medio', 8, 'social', 'foto'),
('c35', 'Pedir un autografo a un random', 'Pedile un autografo a alguien random como si fuera famoso', 'medio', 8, 'social', 'foto'),
('c36', 'Cantar el feliz cumpleanios a un desconocido', 'Cantale el feliz cumpleanios a alguien que no conoces en un lugar publico', 'dificil', 12, 'performance', 'video'),
('c37', 'Hacer una devolucion inventada', 'Intenta devolver un producto que claramente no compraste ahi', 'dificil', 12, 'social', 'video'),
('c38', 'Pedir un descuento por ser tu cumpleanios', 'En cualquier comercio, deci que es tu cumpleanios y pedi descuento', 'dificil', 12, 'social', 'video'),
('c39', 'Hablarle al mozo en otro idioma', 'Pedi algo en un restaurante hablando en un idioma inventado o real que no sea espaniol', 'dificil', 12, 'performance', 'video'),
('c40', 'Hacer una queja inventada', 'Quejate de algo absurdo en un local (ej: la musica esta muy baja)', 'dificil', 12, 'social', 'video'),
('c41', 'Pedir wifi a un vecino', 'Tocale el timbre a un vecino y pedile la contrasenha del wifi', 'dificil', 12, 'social', 'video'),
('c42', 'Gritar lo logre en publico', 'En un lugar publico, grita LO LOGRE con los brazos arriba', 'dificil', 12, 'performance', 'video'),
('c43', 'Intentar pagar con un billete de juguete', 'Saca un billete falso/de juguete e intenta pagar con eso (aclarando despues que es joda)', 'dificil', 12, 'social', 'video'),
('c44', 'Selfie con un guardia de seguridad', 'Pedile una selfie a un guardia de seguridad', 'dificil', 12, 'social', 'foto'),
('c45', 'Foto haciendo yoga en publico', 'Hace una pose de yoga en un lugar publico concurrido', 'dificil', 12, 'performance', 'foto'),
('c46', 'Dar un discurso en publico', 'Para en un lugar publico y da un discurso de al menos 15 segundos sobre cualquier tema', 'extremo', 15, 'performance', 'video'),
('c47', 'Pedir matrimonio falso', 'Arrodillate frente a un desconocido y simula una propuesta de matrimonio', 'extremo', 15, 'performance', 'video'),
('c48', 'Hacer un brindis con desconocidos', 'En un bar, levanta tu vaso y propone un brindis a la mesa de al lado', 'extremo', 15, 'social', 'video'),
('c49', 'Contar un chiste a desconocidos', 'Acercate a un grupo de desconocidos y contales un chiste', 'extremo', 15, 'social', 'video'),
('c50', 'Hacer de estatua viviente', 'Quedarte inmovil como estatua viviente en un lugar publico por al menos 30 segundos', 'extremo', 15, 'performance', 'video');

-- Perks con probabilidades para la ruleta
INSERT IGNORE INTO perks (id, name, description, cost, probability, rarity, type, effect) VALUES
('p1', 'Reto Extra', 'Le asignas un reto extra aleatorio a otro integrante', 0, 20.00, 'comun', 'attack', '{"action": "assign_extra_challenge"}'),
('p2', 'Subir Dificultad', 'Le subis la dificultad a un reto random de otro jugador', 0, 15.00, 'comun', 'attack', '{"action": "increase_difficulty"}'),
('p3', 'Robar Puntos (3)', 'Le robas 3 puntos del balance a otro jugador', 0, 12.00, 'raro', 'attack', '{"action": "steal_points", "amount": 3}'),
('p4', 'Escudo 48hs', 'Te protege de cualquier perk de ataque por 48 horas', 0, 5.00, 'epico', 'defense', '{"action": "shield_48h"}'),
('p5', 'Inmunidad Semanal', 'No podes ser declarado gonca esta semana', 0, 3.00, 'epico', 'defense', '{"action": "immunity"}'),
('p6', 'Doble Puntos', 'Tu proximo reto completado vale el doble', 0, 15.00, 'comun', 'modifier', '{"action": "double_points_next"}'),
('p7', 'Kamikaze', 'Te saca TODOS los puntos pero elegis a alguien que cae con vos', 0, 1.00, 'legendario', 'attack', '{"action": "kamikaze"}'),
('p8', 'Espejo', 'El proximo ataque que recibas se refleja al atacante', 0, 4.00, 'epico', 'defense', '{"action": "mirror"}'),
('p9', 'Congelar', 'Congelas los puntos de un rival por 24hs (no puede sumar)', 0, 8.00, 'raro', 'attack', '{"action": "freeze_24h"}'),
('p10', 'Sabotaje', 'El proximo reto que complete un rival no le suma puntos', 0, 6.00, 'raro', 'attack', '{"action": "sabotage"}'),
('p11', 'Robo Grande (5)', 'Le robas 5 puntos a otro jugador', 0, 4.00, 'epico', 'attack', '{"action": "steal_points", "amount": 5}'),
('p12', 'Nada', 'Mejor suerte maniana...', 0, 7.00, 'comun', 'modifier', '{"action": "nothing"}');

-- Tablas adicionales
CREATE TABLE IF NOT EXISTS daily_spins (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  perk_id VARCHAR(36) NOT NULL,
  spun_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  spin_date DATE NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  FOREIGN KEY (perk_id) REFERENCES perks(id),
  UNIQUE KEY unique_daily_spin (user_id, group_id, spin_date)
);

CREATE TABLE IF NOT EXISTS perk_inventory (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  perk_id VARCHAR(36) NOT NULL,
  obtained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP NULL,
  target_user_id VARCHAR(36) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  FOREIGN KEY (perk_id) REFERENCES perks(id)
);

CREATE TABLE IF NOT EXISTS leader_points (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  balance INT DEFAULT 0,
  total_earned INT DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  UNIQUE KEY unique_leader (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS rewards (
  id VARCHAR(36) PRIMARY KEY,
  group_id VARCHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  cost INT NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  status ENUM('proposed', 'approved', 'rejected') DEFAULT 'proposed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups_table(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reward_votes (
  id VARCHAR(36) PRIMARY KEY,
  reward_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  vote ENUM('approve', 'reject') NOT NULL,
  voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reward_id) REFERENCES rewards(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY unique_reward_vote (reward_id, user_id)
);

CREATE TABLE IF NOT EXISTS reward_claims (
  id VARCHAR(36) PRIMARY KEY,
  reward_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'fulfilled', 'cancelled') DEFAULT 'pending',
  claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fulfilled_at TIMESTAMP,
  FOREIGN KEY (reward_id) REFERENCES rewards(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES groups_table(id)
);
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
