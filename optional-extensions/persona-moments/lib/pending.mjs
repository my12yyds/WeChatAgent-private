import fs from 'node:fs';
import path from 'node:path';

const MAX_PENDING = 5;

export function pendingFile(root, accountId) {
  if (typeof accountId !== 'string' || !/^[0-9a-f]{16,128}$/i.test(accountId)) {
    throw new Error('账号作用域无效');
  }
  return path.join(root, 'state', 'persona-moments', 'pending-' + accountId.toLowerCase() + '.json');
}

export function readPending(root, accountId) {
  try {
    const value = JSON.parse(fs.readFileSync(pendingFile(root, accountId), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function writePending(root, accountId, list) {
  const file = pendingFile(root, accountId);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function prunePending(list, now, ttlMs) {
  return list.filter(item => item && typeof item.text === 'string' && typeof item.id === 'string'
    && Number(item.expiresAt) > now);
}

export function pushPending(list, item, max = MAX_PENDING) {
  return [item, ...list].slice(0, max);
}

export function takePending(list, now, id, ttlMs) {
  const valid = prunePending(list, now, ttlMs);
  if (id) {
    const hit = valid.find(item => item.id === id);
    return {item: hit || null, rest: valid.filter(item => item !== hit)};
  }
  return {item: valid[0] || null, rest: valid.slice(1)};
}
