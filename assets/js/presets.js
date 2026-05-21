/**
 * AWK Log Parser — preset definitions (documentation + parser mode).
 * MVP uses JS in the Web Worker; AWK samples are reference for future WASM.
 */
(function (global) {
  'use strict';

  var PRESETS = [
    {
      id: 'apache-access',
      name: 'Apache access log',
      icon: 'server',
      description: 'Parse standard combined Apache access log format.',
      awkSample:
        "awk '{print $1, $4, $7, $9}' access.log | column -t",
      mode: 'parse',
      logType: 'combined',
    },
    {
      id: 'nginx-access',
      name: 'Nginx access log',
      icon: 'layers',
      description: 'Same combined format as Apache; typical Nginx default.',
      awkSample:
        "awk '{print $1, $7, $9, $10}' /var/log/nginx/access.log",
      mode: 'parse',
      logType: 'combined',
    },
    {
      id: 'wordpress-admin-ajax',
      name: 'WordPress admin-ajax',
      icon: 'wordpress',
      description: 'Filter lines hitting wp-admin/admin-ajax.php.',
      awkSample:
        "awk '$7 ~ /admin-ajax\\.php/ {print $1, $4, $7, $9}' access.log",
      mode: 'filter',
      filter: function (row) {
        return row.valid && /admin-ajax\.php/i.test(row.url);
      },
    },
    {
      id: 'status-codes',
      name: 'Status codes',
      icon: 'hash',
      description: 'Distribution of HTTP status codes.',
      awkSample:
        "awk '{print $9}' access.log | sort | uniq -c | sort -rn",
      mode: 'aggregate',
      aggregate: 'status',
    },
    {
      id: 'top-ips',
      name: 'Top IPs',
      icon: 'network',
      description: 'Most frequent client IP addresses.',
      awkSample:
        "awk '{print $1}' access.log | sort | uniq -c | sort -rn | head",
      mode: 'aggregate',
      aggregate: 'ip',
    },
    {
      id: 'top-urls',
      name: 'Top URLs',
      icon: 'link',
      description: 'Most requested paths.',
      awkSample:
        "awk '{print $7}' access.log | sort | uniq -c | sort -rn | head",
      mode: 'aggregate',
      aggregate: 'url',
    },
    {
      id: 'user-agents',
      name: 'User agents',
      icon: 'device',
      description: 'Top User-Agent strings.',
      awkSample:
        'awk -F\\" \'{print $(NF-1)}\' access.log | sort | uniq -c | sort -rn',
      mode: 'aggregate',
      aggregate: 'userAgent',
    },
  ];

  function getPresetById(id) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].id === id) return PRESETS[i];
    }
    return PRESETS[0];
  }

  global.AwkPresets = {
    PRESETS: PRESETS,
    getPresetById: getPresetById,
    defaultId: 'apache-access',
  };
})(typeof self !== 'undefined' ? self : window);
