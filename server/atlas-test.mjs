import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
console.log('TEST_URI=', uri);

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('TEST CONNECTED');
  await mongoose.connection.close();
} catch (error) {
  console.error('TEST ERROR', error.name, error.message);
  if (error.stack) console.error(error.stack);
  if (error.reason) console.error('REASON', error.reason);
  process.exit(1);
}
