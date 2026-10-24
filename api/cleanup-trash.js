'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 15;

function response(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function collectStoragePaths(product, supabaseUrl, bucket) {
  const origin = new URL(supabaseUrl).origin;
  const prefix = '/storage/v1/object/public/' + bucket + '/';
  const paths = new Set();
  const visit = value => {
    if (typeof value === 'string') {
      if (!/^https?:\/\//i.test(value)) return;
      try {
        const url = new URL(value);
        if (url.origin !== origin || !url.pathname.startsWith(prefix)) return;
        const path = url.pathname.slice(prefix.length).split('/').map(part => {
          try { return decodeURIComponent(part); } catch { return part; }
        }).join('/');
        if (path && !path.split('/').some(part => part === '.' || part === '..')) paths.add(path);
      } catch { /* Ignore malformed or external URLs. */ }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(product);
  return [...paths];
}

function restUrl(base, table, filters = {}) {
  const url = new URL('/rest/v1/' + table, base);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  return url;
}

async function restRequest(base, key, table, options = {}) {
  const url = restUrl(base, table, options.filters || {});
  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    Accept: 'application/json'
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.prefer) headers.Prefer = options.prefer;
  const result = await fetch(url.href, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await result.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!result.ok) {
    const detail = typeof data === 'object' && data ? (data.message || data.details || data.hint || data.code) : data;
    throw new Error(table + ' request failed (' + result.status + '): ' + String(detail || result.statusText));
  }
  return data;
}

async function removeStorageObjects(base, key, bucket, paths) {
  if (!paths.length) return;
  const url = new URL('/storage/v1/object/' + encodeURIComponent(bucket), base);
  const result = await fetch(url.href, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prefixes: paths })
  });
  if (!result.ok) {
    const detail = await result.text();
    throw new Error('Storage deletion failed (' + result.status + '): ' + detail.slice(0, 500));
  }
}

async function enqueueCleanup(base, key, bucket, productId, paths, error) {
  if (!paths.length) return;
  await restRequest(base, key, 'storage_cleanup_queue', {
    method: 'POST',
    filters: { on_conflict: 'bucket,object_path' },
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: paths.map(object_path => ({
      bucket,
      object_path,
      source_product_id: String(productId),
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
      last_error: String(error || 'Storage deletion failed').slice(0, 1000)
    }))
  });
}

async function processRetryQueue(base, key) {
  const rows = await restRequest(base, key, 'storage_cleanup_queue', {
    filters: { select: '*', order: 'created_at.asc', limit: '100' }
  });
  if (!Array.isArray(rows) || !rows.length) return { completed: 0, failed: 0, waiting: 0 };

  let completed = 0;
  let failed = 0;
  let waiting = 0;
  const eligible = [];

  // A queued storage object must not be removed while its product row still
  // exists. This makes database deletion failures recoverable and safe.
  for (const row of rows) {
    if (row.source_product_id) {
      try {
        const product = await restRequest(base, key, 'products', {
          filters: {
            select: 'id',
            id: 'eq.' + String(row.source_product_id),
            limit: '1'
          }
        });
        if (Array.isArray(product) && product.length) {
          waiting++;
          continue;
        }
      } catch (error) {
        failed++;
        try {
          await restRequest(base, key, 'storage_cleanup_queue', {
            method: 'PATCH',
            filters: { id: 'eq.' + row.id },
            prefer: 'return=minimal',
            body: {
              attempts: Number(row.attempts || 0) + 1,
              last_attempt_at: new Date().toISOString(),
              last_error: ('Unable to verify source product; deferring deletion. ' + String(error.message || error)).slice(0, 1000)
            }
          });
        } catch { /* The queue item remains and will be checked again later. */ }
        continue;
      }
    }
    eligible.push(row);
  }

  const byBucket = new Map();
  for (const row of eligible) {
    const bucket = String(row.bucket || 'product-images');
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(row);
  }
  for (const [bucket, bucketRows] of byBucket) {
    try {
      await removeStorageObjects(base, key, bucket, bucketRows.map(row => row.object_path));
      const ids = bucketRows.map(row => row.id).filter(Boolean);
      if (ids.length) {
        await restRequest(base, key, 'storage_cleanup_queue', {
          method: 'DELETE',
          filters: { id: 'in.(' + ids.join(',') + ')' },
          prefer: 'return=minimal'
        });
      }
      completed += bucketRows.length;
    } catch (error) {
      failed += bucketRows.length;
      for (const row of bucketRows) {
        try {
          await restRequest(base, key, 'storage_cleanup_queue', {
            method: 'PATCH',
            filters: { id: 'eq.' + row.id },
            prefer: 'return=minimal',
            body: {
              attempts: Number(row.attempts || 0) + 1,
              last_attempt_at: new Date().toISOString(),
              last_error: String(error.message || error).slice(0, 1000)
            }
          });
        } catch { /* Leave the row for a later retry if its counter cannot update. */ }
      }
    }
  }
  return { completed, failed, waiting };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return response(res, 405, { error: 'Method not allowed' });
  }

  const base = String(process.env.SUPABASE_URL || 'https://uwqnoadelnnplcvqqlyz.supabase.co').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  const secret = String(process.env.CRON_SECRET || '');
  const auth = String(req.headers.authorization || '');
  if (!key || !secret) {
    return response(res, 503, { error: 'Cleanup is not configured. Set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET in Vercel.' });
  }
  if (auth !== 'Bearer ' + secret) return response(res, 401, { error: 'Unauthorized' });

  const bucket = String(process.env.SUPABASE_STORAGE_BUCKET || 'product-images');
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString();
  const summary = { cutoff, retentionDays: RETENTION_DAYS, removedProducts: 0, archivedEvents: 0, queuedImages: 0, queueRetries: null, errors: [] };

  try {
    summary.queueRetries = await processRetryQueue(base, key);
  } catch (error) {
    summary.errors.push('Storage cleanup queue: ' + String(error.message || error));
  }

  let expired;
  try {
    expired = await restRequest(base, key, 'products', {
      filters: {
        select: '*',
        workflow_status: 'eq.trash',
        deleted_at: 'lt.' + cutoff,
        order: 'deleted_at.asc',
        limit: '100'
      }
    });
  } catch (error) {
    return response(res, 500, { ...summary, error: String(error.message || error) });
  }

  for (const product of Array.isArray(expired) ? expired : []) {
    const productId = String(product.id);
    try {
      let events = [];
      try {
        events = await restRequest(base, key, 'catalog_events', {
          filters: { select: '*', product_id: 'eq.' + productId }
        });
      } catch (error) {
        if (!/404|not found|does not exist|PGRST205/i.test(String(error.message || error))) throw error;
      }

      if (Array.isArray(events) && events.length) {
        const archivedAt = new Date().toISOString();
        const archiveRows = events.map(event => ({
          ...event,
          archived_product_name: product.name || 'Producto eliminado',
          archived_catalog_type: product.catalog_type || 'technology',
          archived_at: archivedAt
        }));
        await restRequest(base, key, 'catalog_events_archive', {
          method: 'POST',
          filters: { on_conflict: 'id' },
          prefer: 'resolution=ignore-duplicates,return=minimal',
          body: archiveRows
        });
        summary.archivedEvents += events.length;
        await restRequest(base, key, 'catalog_events', {
          method: 'DELETE',
          filters: { product_id: 'eq.' + productId },
          prefer: 'return=minimal'
        });
      }

      await restRequest(base, key, 'perfume_details', {
        method: 'DELETE',
        filters: { product_id: 'eq.' + productId },
        prefer: 'return=minimal'
      });

      await restRequest(base, key, 'products', {
        method: 'DELETE',
        filters: { id: 'eq.' + productId },
        prefer: 'return=minimal'
      });
      summary.removedProducts += 1;

      const paths = collectStoragePaths(product, base, bucket);
      if (paths.length) {
        try {
          await removeStorageObjects(base, key, bucket, paths);
        } catch (error) {
          await enqueueCleanup(base, key, bucket, productId, paths, error.message || error);
          summary.queuedImages += paths.length;
          summary.errors.push('Product ' + productId + ': images queued for retry (' + String(error.message || error) + ')');
        }
      }
    } catch (error) {
      summary.errors.push('Product ' + productId + ': ' + String(error.message || error));
    }
  }

  return response(res, summary.errors.length ? 207 : 200, summary);
};
