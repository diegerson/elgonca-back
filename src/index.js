const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const challengeRoutes = require('./routes/challenges');
const perkRoutes = require('./routes/perks');
const leaderboardRoutes = require('./routes/leaderboard');
const spinRoutes = require('./routes/spin');
const rewardsRoutes = require('./routes/rewards');
const { initScheduler } = require('./services/weeklyScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/perks', perkRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/spin', spinRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'El Gonca API', version: '1.0.0' });
});

// Iniciar scheduler
initScheduler();

app.listen(PORT, () => {
  console.log(`🚀 El Gonca API corriendo en puerto ${PORT}`);
});

module.exports = app;
