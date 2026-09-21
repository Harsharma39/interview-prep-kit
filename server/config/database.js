const mongoose = require('mongoose');

const connectDB = async () => {
  if (process.env.SKIP_DB === 'true') {
    return null;
  }

  const uri = process.env.MONGODB_URI || (process.env.NODE_ENV === 'production' ? null : 'mongodb://localhost:27017/InterviewPrep');
  if (!uri) throw new Error('MONGODB_URI must be configured in production.');

  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected.');
  } catch (error) {
    console.error('Database connection failed.');
    throw new Error('Database connection failed; verify MONGODB_URI and database network access.');
  }
};

module.exports = connectDB;
