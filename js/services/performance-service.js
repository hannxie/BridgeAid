export function createRequestCoordinator() {
  const active = new Map();
  return {
    run(key, task) {
      if (active.has(key)) return active.get(key);
      const request = Promise.resolve()
        .then(task)
        .finally(() => active.delete(key));
      active.set(key, request);
      return request;
    },
    has(key) {
      return active.has(key);
    },
    size() {
      return active.size;
    }
  };
}

export function storedFirstResponse({
  answer,
  enrich = async () => {},
  clock = () => performance.now()
}) {
  const startedAt = clock();
  const response = answer();
  const responseMs = Math.max(0, clock() - startedAt);
  const enrichment = Promise.resolve()
    .then(enrich)
    .catch(error => ({ error }));
  return { response, responseMs, enrichment };
}

export function memoizeByKey(limit = 100) {
  const values = new Map();
  return {
    get(key) {
      return values.get(key);
    },
    set(key, value) {
      if (values.size >= limit && !values.has(key)) values.delete(values.keys().next().value);
      values.set(key, value);
      return value;
    },
    has(key) {
      return values.has(key);
    },
    clear() {
      values.clear();
    }
  };
}
