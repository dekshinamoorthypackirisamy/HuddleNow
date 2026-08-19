import { promises as dns } from 'dns';

const name = '_mongodb._tcp.cluster1.axsixxn.mongodb.net';
console.log('resolveSrv', name);
try {
  const records = await dns.resolveSrv(name);
  console.log(JSON.stringify(records, null, 2));
} catch (err) {
  console.error(err.name, err.code, err.message);
  console.error(err.stack);
}
