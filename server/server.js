require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/database');
const { validateProductionConfiguration } = require('./config/runtime');
const { resumeQueuedKits } = require('./controllers/kitControllers');

const PORT = Number(process.env.PORT || 3000);

const listen = () => new Promise((resolve, reject) => {
  const server = app.listen(PORT);
  server.once('error', reject);
  server.once('listening', () => {
    server.removeListener('error', reject);
    console.log(`Server listening on port ${PORT}`);
    resolve(server);
  });
});

const startServer = async () => {
  validateProductionConfiguration();
  await connectDB();
  const server = await listen();

  if (process.env.SKIP_DB !== 'true') {
    try {
      const resumed = await resumeQueuedKits();
      if (resumed) console.log(`Resuming ${resumed} queued kit generation job(s)`);
    } catch (error) {
      // A persisted job can be retried later; it must not take down a healthy API.
      console.error('Unable to resume queued kit generation jobs:', error.message);
    }
  }

  return server;
};

if (require.main === module) {
  startServer()
    .catch((error) => {
      console.error('Unable to start server:', error.message);
      process.exitCode = 1;
    });
}

module.exports = app;
module.exports.validateProductionConfiguration = validateProductionConfiguration;
module.exports.startServer = startServer;
