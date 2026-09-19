import { readJson, writeJson } from '../utils/files.js';

let queue = Promise.resolve();

export async function getStore() {
  return readJson('store.json', {
    shifts: [], shiftResidents: [], changeLogs: [], toiletingLogs: [], handovers: [], auditLogs: [], staffMembers: []
  });
}

export async function updateStore(mutator) {
  queue = queue.then(async () => {
    const store = await getStore();
    const result = await mutator(store);
    await writeJson('store.json', store);
    return result;
  });
  return queue;
}

export async function getUsers() {
  return readJson('users.json', []);
}

export async function saveUsers(users) {
  return writeJson('users.json', users);
}
