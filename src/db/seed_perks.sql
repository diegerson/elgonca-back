INSERT INTO perks (id, name, description, cost, probability, rarity, type, effect) VALUES
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
