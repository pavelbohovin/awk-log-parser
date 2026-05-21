/**
 * Example AWK scripts for the WASM engine (combined Apache/Nginx field layout).
 * Field numbers assume space-separated log lines; quoted requests may need FS tweaks.
 */
(function (global) {
  'use strict';

  var DEFAULT_SCRIPT = [
    '{',
    '  status = $9',
    '  url = $7',
    '  ip = $1',
    '  count[status]++',
    '}',
    'END {',
    '  for (s in count) {',
    '    print s "," count[s]',
    '  }',
    '}',
  ].join('\n');

  var EXAMPLES = [
    {
      id: 'status-count',
      name: 'Count status codes',
      script: [
        '{',
        '  status = $9',
        '  count[status]++',
        '}',
        'END {',
        '  print "status,count"',
        '  for (s in count) print s "," count[s]',
        '}',
      ].join('\n'),
    },
    {
      id: 'top-ips',
      name: 'Top IPs',
      script: [
        '{',
        '  ip = $1',
        '  count[ip]++',
        '}',
        'END {',
        '  print "ip,count"',
        '  for (i in count) print i "," count[i]',
        '}',
      ].join('\n'),
    },
    {
      id: 'top-urls',
      name: 'Top URLs',
      script: [
        '{',
        '  url = $7',
        '  count[url]++',
        '}',
        'END {',
        '  print "url,count"',
        '  for (u in count) print u "," count[u]',
        '}',
      ].join('\n'),
    },
    {
      id: 'errors-only',
      name: '4xx / 5xx only',
      script: [
        '{',
        '  status = $9 + 0',
        '  if (status >= 400) count[status]++',
        '}',
        'END {',
        '  print "status,count"',
        '  for (s in count) print s "," count[s]',
        '}',
      ].join('\n'),
    },
    {
      id: 'wordpress-ajax',
      name: 'WordPress admin-ajax',
      script: [
        '{',
        '  if ($0 ~ /admin-ajax\\.php/) {',
        '    url = $7',
        '    count[url]++',
        '  }',
        '}',
        'END {',
        '  print "url,count"',
        '  for (u in count) print u "," count[u]',
        '}',
      ].join('\n'),
    },
    {
      id: 'static-dynamic',
      name: 'Static vs dynamic requests',
      script: [
        '{',
        '  url = $7',
        '  if (url ~ /\\.(css|js|jpg|jpeg|png|gif|ico|svg|webp|woff2?)(\\?|$)/) static++',
        '  else dynamic++',
        '}',
        'END {',
        '  print "type,count"',
        '  print "static," static',
        '  print "dynamic," dynamic',
        '}',
      ].join('\n'),
    },
  ];

  global.AwkExamples = {
    DEFAULT_SCRIPT: DEFAULT_SCRIPT,
    EXAMPLES: EXAMPLES,
    getById: function (id) {
      for (var i = 0; i < EXAMPLES.length; i++) {
        if (EXAMPLES[i].id === id) return EXAMPLES[i];
      }
      return null;
    },
  };
})(typeof self !== 'undefined' ? self : window);
