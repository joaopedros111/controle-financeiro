export function settingsLocks() {
 const tails = new Map();
 return { request(name, callback) {
  const run = (tails.get(name) || Promise.resolve()).catch(()=>{}).then(callback);
  tails.set(name, run.catch(()=>{})); return run;
 }};
}
