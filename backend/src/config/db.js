const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // Keep a warm pool of connections so requests don't pay cold-start
      // round-trips. The cluster has high RTT, so reusing live sockets matters.
      maxPoolSize: 20,
      minPoolSize: 5,
      // Fail fast instead of hanging the default 30s when the cluster is
      // briefly unreachable — that 30s hang is what surfaces on mobile as a
      // long wait that ends in an "authentication error".
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
      // Compress traffic over the wire — helps on slow/mobile networks and
      // when the cluster is in a distant region.
      compressors: ['zlib'],
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
